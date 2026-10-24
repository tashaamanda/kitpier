import type pg from "pg";
import { newId, one, pool, tx } from "./db";
import { HttpError } from "./session";

// Platform-paid model usage (the free planner, SPEC §5 guardrails). Counts against PLATFORM_DAILY_AI_CAP_MICROS,
// never against the user's credits. Reserve → record per model response → settle exactly once.

// Conservative list prices in micro-USD per token, used for caps and metering. Overestimating is the safe side.
// Check against Anthropic's pricing page before launch.
export const MODEL_PRICES: Record<string, { in: number; out: number }> = {
  "claude-haiku-5-5": { in: 1, out: 5 },
  "claude-sonnet-5-5": { in: 3, out: 15 },
};

export function costMicros(model: string, input: number, output: number) {
  const p = MODEL_PRICES[model];
  if (!p) throw new Error(`No price for model ${model}`);
  return Math.ceil(input * p.in + output * p.out);
}

const today = () => new Date().toISOString().slice(0, 10);

function dailyCap() {
  const cap = Number(process.env.PLATFORM_DAILY_AI_CAP_MICROS);
  if (!Number.isInteger(cap) || cap <= 0) throw new Error("PLATFORM_DAILY_AI_CAP_MICROS must be set");
  return cap;
}

/**
 * Locks platform day rows in ascending order. Every path takes day rows before reservation or usage rows (R4-3);
 * the sweeps (here and billing.ts) call this after locking today's row, for the older days they will settle.
 */
export async function lockDays(c: pg.PoolClient, days: string[]) {
  await c.query("SELECT 1 FROM platform_daily_spend WHERE day = ANY($1::date[]) ORDER BY day FOR UPDATE", [[...new Set(days)]]);
}

/** Tx1: lock today's platform row, sweep expired runs, check the global cap, reserve. */
export async function reservePlatform(userId: string, projectId: string, amount: number) {
  const day = today();
  return tx(async (c) => {
    await c.query("INSERT INTO platform_daily_spend (day) VALUES ($1) ON CONFLICT DO NOTHING", [day]);
    await c.query("SELECT 1 FROM platform_daily_spend WHERE day = $1 FOR UPDATE", [day]);
    // Runs that never settled, from any day (one stranded before midnight would otherwise stay open): charge what was
    // recorded, count the unrecorded remainder as exposure, each against its own day's row. Bounded batch. Day rows
    // are locked before the usage rows (R4-3), the same order settlePlatform uses.
    const { rows: stale } = await c.query<{ id: string; day: string }>(
      "SELECT id, to_char(day, 'YYYY-MM-DD') AS day FROM platform_usage WHERE state = 'open' AND expires_at < now() ORDER BY expires_at LIMIT 50",
    );
    if (stale.length > 0) {
      await lockDays(c, stale.map((r) => r.day));
      await c.query(
        `WITH x AS (
           UPDATE platform_usage SET state = 'expired_settled'
           WHERE id = ANY($1::text[]) AND state = 'open'
           RETURNING day, reserved_micros, cost_micros),
         per_day AS (
           SELECT day, SUM(reserved_micros) AS reserved, SUM(cost_micros) AS cost,
                  SUM(GREATEST(reserved_micros - cost_micros, 0)) AS exposure
           FROM x GROUP BY day)
         UPDATE platform_daily_spend d SET
           reserved_micros  = d.reserved_micros  - per_day.reserved,
           committed_micros = d.committed_micros + per_day.cost,
           exposure_micros  = d.exposure_micros  + per_day.exposure
         FROM per_day WHERE d.day = per_day.day`,
        [stale.map((r) => r.id)],
      );
    }
    const d = await one<{ used: number }>(
      c,
      "SELECT (reserved_micros + committed_micros + exposure_micros)::bigint AS used FROM platform_daily_spend WHERE day = $1",
      [day],
    );
    if ((d?.used ?? 0) + amount > dailyCap()) throw new HttpError(503, "The assistant is at capacity today. Please try again tomorrow.", "ai_capacity");
    const id = newId("pu");
    await c.query(
      `INSERT INTO platform_usage (id, user_id, project_id, purpose, day, reserved_micros, expires_at)
       VALUES ($1, $2, $3, 'planner', $4, $5, now() + interval '120 seconds')`,
      [id, userId, projectId, day, amount],
    );
    await c.query("UPDATE platform_daily_spend SET reserved_micros = reserved_micros + $2 WHERE day = $1", [day, amount]);
    return { id, reserved: amount };
  });
}

/** Persist one model response's usage immediately, before its tools run. Returns cost so far. */
export async function recordPlatformUsage(id: string, model: string, input: number, output: number) {
  const r = await one<{ cost_micros: number }>(
    pool,
    `UPDATE platform_usage SET cost_micros = cost_micros + $2, input_tokens = input_tokens + $3,
       output_tokens = output_tokens + $4, iterations = iterations + 1
     WHERE id = $1 AND state = 'open' RETURNING cost_micros`,
    [id, costMicros(model, input, output), input, output],
  );
  return r?.cost_micros ?? Infinity;
}

/** Tx2: exactly once (state guard). Moves reserved → committed and releases the rest. */
export async function settlePlatform(id: string) {
  await tx(async (c) => {
    const u = await one<{ day: string; reserved_micros: number; cost_micros: number }>(
      c,
      "SELECT to_char(day, 'YYYY-MM-DD') AS day, reserved_micros, cost_micros FROM platform_usage WHERE id = $1",
      [id],
    );
    if (!u) return;
    await c.query("SELECT 1 FROM platform_daily_spend WHERE day = $1 FOR UPDATE", [u.day]);
    const r = await c.query("UPDATE platform_usage SET state = 'settled' WHERE id = $1 AND state = 'open'", [id]);
    if (r.rowCount !== 1) return;
    await c.query(
      `UPDATE platform_daily_spend SET reserved_micros = reserved_micros - $2, committed_micros = committed_micros + $3
       WHERE day = $1`,
      [u.day, u.reserved_micros, u.cost_micros],
    );
  });
}
