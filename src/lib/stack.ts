import { CATEGORIES, LISTINGS, getListing, type Listing } from "./catalog";
import { many, newId, one, tx, type Db } from "./db";
import { postedBalance } from "./ledger";
import { PRICE_CARD_VERSION, TYPICAL_MONTH, monthlyEstimateMicros } from "./pricecard";
import { HttpError } from "./session";

// Server side of the planner's tools. Everything is scoped to the session's (user, project): the model passes no
// ids, and every price comes from the catalog or the price card.

export type Scope = { userId: string; projectId: string };
export type Usage = { messages_per_month: number; bookings_per_month: number };
export type StackItem = { slug: string; name: string; type: Listing["type"]; category: string; reason: string; price: string };
export type Proposal = {
  id: string;
  items: StackItem[];
  usage: Usage;
  enforced_micros: number;
  external_paid_micros: number;
  budget_cap_micros: number;
  price_version: string;
  status: "proposed" | "approved" | "superseded";
  created_at: string;
};

const DEFAULT_USAGE: Usage = {
  messages_per_month: TYPICAL_MONTH["booking.message"],
  bookings_per_month: TYPICAL_MONTH["booking.created"],
};

export function searchCatalog(input: { category?: string; query?: string }) {
  const q = input.query?.toLowerCase().trim();
  return LISTINGS.filter((l) => !input.category || l.category === input.category)
    .filter((l) => !q || `${l.name} ${l.category} ${l.tagline} ${l.description}`.toLowerCase().includes(q))
    .map((l) => ({
      slug: l.slug,
      name: l.name,
      category: l.category,
      how_you_pay: l.type === "buy" ? "Buy with PayPal (Kitpier credits, budget enforced)" : l.type === "connect" ? "Connect your own account (billed by the provider, estimate only)" : "Coming soon (cannot be added to a stack)",
      available: l.type !== "soon",
      tagline: l.tagline,
      price: l.priceSummary,
    }));
}

export function estimateCost(usage: Partial<Usage> = {}, slugs?: string[]) {
  const u = { ...DEFAULT_USAGE, ...usage };
  const listings = (slugs ?? LISTINGS.filter((l) => l.type !== "soon").map((l) => l.slug))
    .map(getListing)
    .filter((l): l is Listing => !!l && l.type !== "soon");
  const enforced = listings.some((l) => l.type === "buy")
    ? monthlyEstimateMicros({ "booking.message": u.messages_per_month, "booking.created": u.bookings_per_month })
    : 0;
  const externalPaid = listings.reduce((s, l) => s + (l.type === "connect" ? (l.paidFromMicros ?? 0) : 0), 0);
  return { usage: u, enforced_micros: enforced, external_free_tier_micros: 0, external_paid_from_micros: externalPaid };
}

/** The cap Kitpier enforces on this project's monthly spend: the stated budget, else 1.5x the estimate (min $5). */
export function budgetCap(enforced: number, statedBudgetUsd?: number) {
  if (statedBudgetUsd) return Math.round(statedBudgetUsd * 1_000_000);
  return Math.max(5_000_000, Math.ceil((enforced * 1.5) / 1_000_000) * 1_000_000);
}

export async function proposeStack(
  s: Scope,
  input: { items: { slug: string; reason: string }[]; usage?: Partial<Usage>; monthly_budget_usd?: number },
) {
  const seen = new Set<string>();
  const items: StackItem[] = [];
  for (const it of input.items) {
    const l = getListing(it.slug);
    if (!l) throw new HttpError(400, `Unknown listing "${it.slug}". Use search_catalog for valid slugs.`);
    if (l.type === "soon") throw new HttpError(400, `${l.name} is coming soon and can't be added yet.`);
    if (seen.has(l.slug)) continue;
    seen.add(l.slug);
    items.push({ slug: l.slug, name: l.name, type: l.type, category: l.category, reason: it.reason.slice(0, 200), price: l.priceSummary });
  }
  if (items.length === 0) throw new HttpError(400, "A stack needs at least one available listing.");
  const est = estimateCost(input.usage, items.map((i) => i.slug));
  const cap = budgetCap(est.enforced_micros, input.monthly_budget_usd);
  const id = newId("stk");
  await tx(async (c) => {
    await c.query("UPDATE stack_proposals SET status = 'superseded' WHERE user_id = $1 AND project_id = $2 AND status = 'proposed'", [s.userId, s.projectId]);
    await c.query(
      `INSERT INTO stack_proposals (id, user_id, project_id, items, usage, enforced_micros, external_paid_micros, budget_cap_micros, price_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, s.userId, s.projectId, JSON.stringify(items), JSON.stringify(est.usage), est.enforced_micros, est.external_paid_from_micros, cap, PRICE_CARD_VERSION],
    );
  });
  return { id, items, ...est, budget_cap_micros: cap, over_budget: est.enforced_micros > cap };
}

export function listProposals(q: Db, s: Scope) {
  return many<Proposal>(
    q,
    `SELECT id, items, usage, enforced_micros, external_paid_micros, budget_cap_micros, price_version, status, created_at
     FROM stack_proposals WHERE user_id = $1 AND project_id = $2 AND status <> 'superseded' ORDER BY created_at`,
    [s.userId, s.projectId],
  );
}

/** User approval (session + origin checked by the route). Sets the project's enforced monthly budget. */
export async function approveStack(s: Scope, proposalId: string) {
  return tx(async (c) => {
    const p = await one<{ budget_cap_micros: number }>(
      c,
      `UPDATE stack_proposals SET status = 'approved', decided_at = now()
       WHERE id = $1 AND user_id = $2 AND project_id = $3 AND status = 'proposed' RETURNING budget_cap_micros`,
      [proposalId, s.userId, s.projectId],
    );
    if (!p) throw new HttpError(404, "This plan is no longer waiting for approval");
    await c.query(
      "UPDATE stack_proposals SET status = 'superseded' WHERE user_id = $1 AND project_id = $2 AND status = 'approved' AND id <> $3",
      [s.userId, s.projectId, proposalId],
    );
    await c.query("UPDATE projects SET budget_micros = $3 WHERE id = $1 AND user_id = $2", [s.projectId, s.userId, p.budget_cap_micros]);
    return { budget_micros: p.budget_cap_micros };
  });
}

/** Counts and states only: never free text (SPEC §8). */
export async function projectStatus(q: Db, s: Scope) {
  const r = await one<{ supabase: boolean; resend: boolean; db: boolean; budget: number | null; stack: string | null }>(
    q,
    `SELECT EXISTS (SELECT 1 FROM credentials WHERE user_id = $1 AND project_id = $2 AND kind = 'supabase_oauth') AS supabase,
            EXISTS (SELECT 1 FROM credentials WHERE user_id = $1 AND project_id = $2 AND kind = 'resend_send_key') AS resend,
            EXISTS (SELECT 1 FROM provision_jobs WHERE user_id = $1 AND project_id = $2 AND state = 'schema_ready') AS db,
            (SELECT budget_micros FROM projects WHERE id = $2 AND user_id = $1) AS budget,
            (SELECT status FROM stack_proposals WHERE user_id = $1 AND project_id = $2 AND status <> 'superseded'
              ORDER BY (status = 'approved') DESC, created_at DESC LIMIT 1) AS stack`,
    [s.userId, s.projectId],
  );
  return {
    credits_usd: (await postedBalance(q, s.userId)) / 1_000_000,
    supabase_connected: !!r?.supabase,
    resend_connected: !!r?.resend,
    database_ready: !!r?.db,
    stack: r?.stack ?? "none",
    monthly_budget_usd: r?.budget == null ? null : r.budget / 1_000_000,
  };
}

export { CATEGORIES };
