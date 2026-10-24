import { newId, one, pool, tx, type Db } from "./db";
import { lockUserBalance, post, spendable } from "./ledger";
import { costMicros, lockDays } from "./platform";
import { PRICE_CARD_VERSION, PRICES } from "./pricecard";
import { HttpError } from "./session";

// Per-turn billing for the Booking API (SPEC §5). A turn reserves the most it can cost the customer
// (one message + one booking, from the price card) and, separately, the worst-case model cost against the
// platform's daily cap. Settle charges exactly once: the message, plus the booking only if one was made.

type Scope = { userId: string; projectId: string };
const today = () => new Date().toISOString().slice(0, 10);
export const TURN_MAX_MICROS = PRICES["booking.message"].micros + PRICES["booking.created"].micros;

/**
 * What a settled reservation costs the customer. Unrecorded usage is never charged, and a booking only once its write
 * is confirmed: a claim whose outcome we never learned (the process stopped mid-write) is not evidence of a booking.
 */
function charge(r: { events: number; booking_state: string | null }) {
  return (r.events > 0 ? PRICES["booking.message"].micros : 0) + (r.booking_state === "confirmed" ? PRICES["booking.created"].micros : 0);
}

function dailyCap() {
  const cap = Number(process.env.PLATFORM_DAILY_AI_CAP_MICROS);
  if (!Number.isInteger(cap) || cap <= 0) throw new Error("PLATFORM_DAILY_AI_CAP_MICROS must be set");
  return cap;
}

type ProjectLimits = { budget_micros: number | null; daily_cap_micros: number; frozen: boolean };
/** Why a turn costing `amount` can't run, or null. One rule set for reserveTurn and the owner's status. */
export type PauseReason = "on_hold" | "credits" | "budget" | "daily_limit";

async function pauseReason(c: Db, s: Scope, project: ProjectLimits, amount: number): Promise<PauseReason | null> {
  if (project.frozen) return "on_hold";
  if ((await spendable(c, s.userId)) < amount) return "credits";
  // Project spend = posted usage debits + what open reservations could still charge.
  const spent = await one<{ month: number; day: number }>(
    c,
    `SELECT
       (COALESCE((SELECT -SUM(amount_micros) FROM ledger_entries WHERE project_id = $1 AND kind = 'usage'
          AND created_at >= date_trunc('month', now())), 0)
        + COALESCE((SELECT SUM(amount_micros) FROM reservations WHERE project_id = $1 AND state = 'open'), 0))::bigint AS month,
       (COALESCE((SELECT -SUM(amount_micros) FROM ledger_entries WHERE project_id = $1 AND kind = 'usage'
          AND created_at >= date_trunc('day', now())), 0)
        + COALESCE((SELECT SUM(amount_micros) FROM reservations WHERE project_id = $1 AND state = 'open'), 0))::bigint AS day`,
    [s.projectId],
  );
  if (project.budget_micros != null && (spent?.month ?? 0) + amount > project.budget_micros) return "budget";
  if ((spent?.day ?? 0) + amount > project.daily_cap_micros) return "daily_limit";
  return null;
}

/** Owner-facing: would the next booking turn be refused, and why. Read-only, no locks. */
export async function bookingPause(q: Db, s: Scope) {
  const project = await one<ProjectLimits>(
    q,
    `SELECT p.budget_micros, p.daily_cap_micros, u.frozen FROM projects p JOIN users u ON u.id = p.user_id
     WHERE p.id = $1 AND p.user_id = $2`,
    [s.projectId, s.userId],
  );
  return project ? pauseReason(q, s, project, TURN_MAX_MICROS) : null;
}

/**
 * Tx1. Lock order: platform day → user balance → project (fixed, so no deadlocks). With `request`, the customer's
 * request row is bound to this reservation in the same transaction, so a charge can never exist without the record
 * that makes retries of that request safe.
 */
export async function reserveTurn(
  s: Scope,
  conversationId: string,
  platformMicros: number,
  amount = TURN_MAX_MICROS,
  request?: { widgetId: string; requestId: string },
) {
  const day = today();
  return tx(async (c) => {
    await c.query("INSERT INTO platform_daily_spend (day) VALUES ($1) ON CONFLICT DO NOTHING", [day]);
    await c.query("SELECT 1 FROM platform_daily_spend WHERE day = $1 FOR UPDATE", [day]);
    await sweepExpired(c);
    const p = await one<{ used: number }>(
      c,
      "SELECT (reserved_micros + committed_micros + exposure_micros)::bigint AS used FROM platform_daily_spend WHERE day = $1",
      [day],
    );
    if ((p?.used ?? 0) + platformMicros > dailyCap()) throw new HttpError(503, "Booking is busy right now. Please try again later.", "ai_capacity");

    await lockUserBalance(c, s.userId);
    const project = await one<ProjectLimits>(
      c,
      `SELECT p.budget_micros, p.daily_cap_micros, u.frozen FROM projects p JOIN users u ON u.id = p.user_id
       WHERE p.id = $1 AND p.user_id = $2 FOR UPDATE OF p`,
      [s.projectId, s.userId],
    );
    if (!project) throw new HttpError(404, "Not found");
    if (await pauseReason(c, s, project, amount))
      throw new HttpError(402, "Online booking is paused for this business right now.", "budget_exhausted");

    const id = newId("res");
    await c.query(
      `INSERT INTO reservations (id, user_id, project_id, day, amount_micros, expires_at, platform_reserved_micros, conversation_id)
       VALUES ($1, $2, $3, $4, $5, now() + interval '120 seconds', $6, $7)`,
      [id, s.userId, s.projectId, day, amount, platformMicros, conversationId],
    );
    await c.query("UPDATE platform_daily_spend SET reserved_micros = reserved_micros + $2 WHERE day = $1", [day, platformMicros]);
    if (request)
      await c.query("UPDATE turn_requests SET reservation_id = $3 WHERE widget_id = $1 AND request_id = $2", [request.widgetId, request.requestId, id]);
    return { id, platformReserved: platformMicros };
  });
}

/** Persist one model response right away, before its tools run. Returns model cost so far. */
export async function recordTurnUsage(reservationId: string, iteration: number, model: string, input: number, output: number) {
  await pool.query(
    `INSERT INTO usage_events (reservation_id, iteration, model, input_tokens, output_tokens, cost_micros)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
    [reservationId, iteration, model, input, output, costMicros(model, input, output)],
  );
  const r = await one<{ c: number }>(pool, "SELECT COALESCE(SUM(cost_micros), 0)::bigint AS c FROM usage_events WHERE reservation_id = $1", [reservationId]);
  return r?.c ?? 0;
}

/** Before a booking write: false if the reservation already expired or settled. A claim alone is never charged. */
export async function claimBooking(reservationId: string) {
  return !!(await one(pool, "UPDATE reservations SET booking_state = 'claimed' WHERE id = $1 AND state = 'open' RETURNING 1", [reservationId]));
}

/** After the write succeeded: now the booking is chargeable. False if the reservation expired meanwhile (not charged). */
export async function confirmBookingWrite(reservationId: string) {
  return !!(await one(
    pool,
    "UPDATE reservations SET booking_state = 'confirmed' WHERE id = $1 AND state = 'open' AND booking_state = 'claimed' RETURNING 1",
    [reservationId],
  ));
}

export async function releaseBooking(reservationId: string) {
  await pool.query("UPDATE reservations SET booking_state = NULL WHERE id = $1 AND state = 'open'", [reservationId]);
}

/** Tx2, exactly once (state guard + UNIQUE ledger source). */
export async function settleTurn(reservationId: string) {
  await tx(async (c) => {
    const r = await one<{ day: string }>(c, "SELECT to_char(day, 'YYYY-MM-DD') AS day FROM reservations WHERE id = $1", [reservationId]);
    if (!r) return;
    await c.query("SELECT 1 FROM platform_daily_spend WHERE day = $1 FOR UPDATE", [r.day]);
    await settle(c, reservationId, "settled");
  });
}

type C = Parameters<Parameters<typeof tx>[0]>[0];

async function settle(c: C, reservationId: string, to: "settled" | "expired_settled") {
  const r = await one<{ user_id: string; project_id: string; day: string; booking_state: string | null; platform_reserved_micros: number; events: number; model_cost: number }>(
    c,
    `UPDATE reservations SET state = $2 WHERE id = $1 AND state = 'open'
     RETURNING user_id, project_id, to_char(day, 'YYYY-MM-DD') AS day, booking_state, platform_reserved_micros,
       (SELECT count(*) FROM usage_events WHERE reservation_id = $1)::int AS events,
       (SELECT COALESCE(SUM(cost_micros), 0) FROM usage_events WHERE reservation_id = $1)::bigint AS model_cost`,
    [reservationId, to],
  );
  if (!r) return;
  const amount = charge(r);
  if (amount > 0)
    await post(c, { userId: r.user_id, projectId: r.project_id, source: `usage:${reservationId}`, kind: "usage", amountMicros: -amount, priceVersion: PRICE_CARD_VERSION });
  await c.query(
    `UPDATE platform_daily_spend SET reserved_micros = reserved_micros - $2, committed_micros = committed_micros + $3,
       exposure_micros = exposure_micros + $4 WHERE day = $1`,
    [r.day, r.platform_reserved_micros, r.model_cost, to === "expired_settled" ? Math.max(r.platform_reserved_micros - r.model_cost, 0) : 0],
  );
}

/**
 * Reconciler: expired open reservations settle on recorded usage only; the unknown remainder is exposure. Looks
 * across every day, oldest first, in bounded batches: one stranded before midnight would otherwise hold the user's
 * credits forever (spendable subtracts every open reservation).
 *
 * Lock order (R4-3): platform day rows before reservation rows, everywhere. settleTurn locks its day, then its
 * reservation; so the sweep locks every day row it will touch (ascending, after today's, which the caller holds)
 * before settling any reservation. The batch is fixed first; one that another transaction settles meanwhile is
 * skipped by settle's state guard.
 */
async function sweepExpired(c: C) {
  const { rows } = await c.query<{ id: string; day: string }>(
    "SELECT id, to_char(day, 'YYYY-MM-DD') AS day FROM reservations WHERE state = 'open' AND expires_at < now() ORDER BY expires_at LIMIT 50",
  );
  if (rows.length === 0) return;
  await lockDays(c, rows.map((r) => r.day));
  for (const { id } of rows) await settle(c, id, "expired_settled");
}
