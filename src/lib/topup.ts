import { many, newId, one, tx, type Db } from "./db";
import { PACKS, type PackId } from "./packs";
import { HttpError } from "./session";
import type { Scope } from "./stack";

// Agent-proposed top-up (SPEC §3.6). The planner can only create this card. Paying happens in PayPal checkout,
// and the pack amount and budget raise come from the server, applied once when the capture is credited.

export type TopUp = { id: string; pack_id: PackId; amount_micros: number; budget_raise_micros: number; status: "proposed" | "paid"; created_at: string };

/** A project with a monthly budget gets the pack amount added to it, so the paid credits can be spent this month. */
function raiseFor(budget: number | null, packId: PackId) {
  return budget == null ? 0 : PACKS[packId].amountMicros;
}

export async function proposeTopUp(s: Scope, packId: PackId) {
  return tx(async (c) => {
    const p = await one<{ budget_micros: number | null }>(c, "SELECT budget_micros FROM projects WHERE id = $1 AND user_id = $2", [s.projectId, s.userId]);
    if (!p) throw new HttpError(404, "Not found");
    await c.query("UPDATE top_up_proposals SET status = 'superseded', decided_at = now() WHERE user_id = $1 AND project_id = $2 AND status = 'proposed'", [s.userId, s.projectId]);
    const id = newId("top");
    await c.query("INSERT INTO top_up_proposals (id, user_id, project_id, pack_id) VALUES ($1, $2, $3, $4)", [id, s.userId, s.projectId, packId]);
    const raise = raiseFor(p.budget_micros, packId);
    return { id, amount_micros: PACKS[packId].amountMicros, budget_raise_micros: raise, new_budget_micros: p.budget_micros == null ? null : p.budget_micros + raise };
  });
}

export async function listTopUps(q: Db, s: Scope): Promise<TopUp[]> {
  const rows = await many<{ id: string; pack_id: PackId; status: "proposed" | "paid"; created_at: string; budget: number | null }>(
    q,
    `SELECT t.id, t.pack_id, t.status, t.created_at, p.budget_micros AS budget FROM top_up_proposals t JOIN projects p ON p.id = t.project_id
     WHERE t.user_id = $1 AND t.project_id = $2 AND t.status <> 'superseded' ORDER BY t.created_at`,
    [s.userId, s.projectId],
  );
  return rows.map((r) => ({
    id: r.id,
    pack_id: r.pack_id,
    status: r.status,
    created_at: r.created_at,
    amount_micros: PACKS[r.pack_id].amountMicros,
    budget_raise_micros: raiseFor(r.budget, r.pack_id),
  }));
}

/** For order creation: the card must be this user's, this project's, still open, and for this pack. */
export async function claimTopUpForOrder(q: Db, s: Scope, topUpId: string, packId: PackId) {
  const r = await one<{ pack_id: PackId; budget: number | null }>(
    q,
    `SELECT t.pack_id, p.budget_micros AS budget FROM top_up_proposals t JOIN projects p ON p.id = t.project_id
     WHERE t.id = $1 AND t.user_id = $2 AND t.project_id = $3 AND t.status = 'proposed'`,
    [topUpId, s.userId, s.projectId],
  );
  if (!r || r.pack_id !== packId) throw new HttpError(409, "This top-up is no longer available. Ask the assistant again.");
  return { budgetRaiseMicros: raiseFor(r.budget, packId) };
}
