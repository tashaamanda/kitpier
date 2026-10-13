import type { Db } from "./db";
import { one } from "./db";

export type LedgerKind = "purchase" | "refund" | "reversal" | "usage" | "adjustment";

/**
 * Posts one ledger entry. `source` is the idempotency key for the external effect
 * (capture:<id>, refund:<id>, reversal:<id>, usage:<reservation>), so replays are no-ops.
 * Returns true if this call created the entry.
 */
export async function post(
  q: Db,
  e: {
    userId: string;
    projectId?: string | null;
    source: string;
    kind: LedgerKind;
    amountMicros: number;
    priceVersion?: string;
  },
): Promise<boolean> {
  const r = await q.query(
    `INSERT INTO ledger_entries (user_id, project_id, source, kind, amount_micros, price_version)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (source) DO NOTHING`,
    [e.userId, e.projectId ?? null, e.source, e.kind, e.amountMicros, e.priceVersion ?? null],
  );
  return r.rowCount === 1;
}

/** Posted balance: everything the ledger says the user owns. Can go negative after a reversal. */
export async function postedBalance(q: Db, userId: string): Promise<number> {
  const r = await one<{ b: number }>(
    q,
    "SELECT COALESCE(SUM(amount_micros), 0)::bigint AS b FROM ledger_entries WHERE user_id = $1",
    [userId],
  );
  return r?.b ?? 0;
}

/** Spendable = posted − open reservations − refunds in flight (SPEC §4.2, §5). */
export async function spendable(q: Db, userId: string): Promise<number> {
  const r = await one<{ s: number }>(
    q,
    `SELECT (
       COALESCE((SELECT SUM(amount_micros) FROM ledger_entries WHERE user_id = $1), 0)
     - COALESCE((SELECT SUM(amount_micros) FROM reservations WHERE user_id = $1 AND state = 'open'), 0)
     - COALESCE((SELECT SUM(amount_micros) FROM refund_requests WHERE user_id = $1 AND state IN ('held','sent')), 0)
     )::bigint AS s`,
    [userId],
  );
  return r?.s ?? 0;
}

/** Row lock that serializes balance-changing work per user (reserve, refund hold). */
export async function lockUserBalance(q: Db, userId: string) {
  await q.query("INSERT INTO user_balances (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);
  await q.query("SELECT 1 FROM user_balances WHERE user_id = $1 FOR UPDATE", [userId]);
}
