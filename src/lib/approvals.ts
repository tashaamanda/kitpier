import { createHash } from "node:crypto";
import { createKeyTx } from "./apikeys";
import { appOrigin } from "./app-url";
import { WidgetSpec, projectWidget } from "./booking";
import { many, newId, one, pool, tx, type Db } from "./db";
import { envSnippet, handoffPrompt } from "./handoff";
import { PACKS, type PackId } from "./packs";
import { PRICE_CARD_VERSION } from "./pricecard";
import { decideAction } from "./provision";
import { lockProject } from "./projects";
import { HttpError } from "./session";
import { approveStack, type Scope, type StackItem } from "./stack";

// Approval links (docs/agent-scope.md D). An agent gathers everything waiting for the person into one link. Each item is
// a snapshot: what it is, which row, and a fingerprint of the exact details shown. The person can approve an item from
// the link only while the row still matches; anything changed needs a new link. Paying stays in PayPal checkout.

export type ItemKind = "stack" | "setup" | "booking_page" | "api_key" | "top_up";
export type LinkItem = { kind: ItemKind; id: string; fingerprint: string };
export type ItemView = LinkItem & { state: "pending" | "approved" | "rejected" | "stale"; details: Record<string, unknown> };

const LINK_TTL_HOURS = 24;
const fp = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("base64url");

// ---- Key grants -------------------------------------------------------------------------------------------------------

/** The agent asks; nothing is minted until the person approves and the agent collects. Replaces an open request. */
export async function requestKey(s: Scope) {
  // A booking page that's live or waiting for approval: then the page and its key go on one approval link.
  const page =
    (await projectWidget(s)) ??
    (await one(pool, "SELECT 1 FROM pending_actions WHERE user_id = $1 AND project_id = $2 AND kind = 'create_widget' AND status = 'pending'", [s.userId, s.projectId]));
  if (!page) throw new HttpError(409, "Propose the booking page first");
  return tx(async (c) => {
    await c.query("UPDATE key_grants SET status = 'superseded', decided_at = now() WHERE project_id = $1 AND user_id = $2 AND status IN ('pending','approved')", [
      s.projectId,
      s.userId,
    ]);
    const id = newId("kgr");
    await c.query("INSERT INTO key_grants (id, user_id, project_id, agent_token_id) VALUES ($1, $2, $3, $4)", [id, s.userId, s.projectId, s.agentTokenId ?? null]);
    return { id, status: "pending" as const };
  });
}

const KEY_APPROVAL_TTL_MINUTES = 60;

/**
 * The agent that asked collects an approved key exactly once. Under the project lock it re-checks what the person
 * approved: the same agent, still in time, and the same key to replace (or still none). Claim and mint share one
 * transaction, so a browser key change can't slip between the check and the mint.
 */
export async function claimKey(s: Scope) {
  if (!s.agentTokenId) throw new HttpError(403, "Only the agent that asked can collect this key");
  const out = await tx(async (c) => {
    await lockProject(c, s.userId, s.projectId);
    const g = await one<{ id: string; approved_live_prefix: string | null; fresh: boolean }>(
      c,
      `SELECT id, approved_live_prefix, approved_until > now() AS fresh FROM key_grants
       WHERE project_id = $1 AND user_id = $2 AND agent_token_id = $3 AND status = 'approved' FOR UPDATE`,
      [s.projectId, s.userId, s.agentTokenId],
    );
    if (!g) throw new HttpError(409, "No approved key request for this agent. Request one, then send the person an approval link.", "not_approved");
    const live = await one<{ prefix: string }>(c, "SELECT prefix FROM api_keys WHERE user_id = $1 AND project_id = $2 AND revoked_at IS NULL", [s.userId, s.projectId]);
    if (!g.fresh || (live?.prefix ?? null) !== g.approved_live_prefix) {
      await c.query("UPDATE key_grants SET status = 'superseded' WHERE id = $1", [g.id]);
      return null;
    }
    await c.query("UPDATE key_grants SET status = 'claimed', claimed_at = now() WHERE id = $1", [g.id]);
    return createKeyTx(c, s);
  });
  // Outside the transaction, so the superseded mark sticks.
  if (!out) throw new HttpError(409, "The project's keys changed, or the approval expired. Request a new key and send a new approval link.", "stale");
  const w = await projectWidget(s);
  return { ...out, env: envSnippet(appOrigin(), out.key), prompt: handoffPrompt(w!.business_name) };
}

// ---- What is waiting, and its fingerprint ------------------------------------------------------------------------------

type Current = { id: string; state: ItemView["state"]; fingerprint: string; details: Record<string, unknown> };

async function current(q: Db, s: Scope, kind: ItemKind, id?: string): Promise<Current | undefined> {
  const by = id ? "AND id = $3" : "";
  const args = id ? [s.userId, s.projectId, id] : [s.userId, s.projectId];
  if (kind === "stack") {
    const r = await one<{ id: string; status: string; items: StackItem[]; usage: unknown; enforced_micros: number; external_paid_micros: number; budget_cap_micros: number; price_version: string }>(
      q,
      `SELECT id, status, items, usage, enforced_micros, external_paid_micros, budget_cap_micros, price_version FROM stack_proposals
       WHERE user_id = $1 AND project_id = $2 ${by || "AND status = 'proposed'"} ORDER BY created_at DESC LIMIT 1`,
      args,
    );
    if (!r) return;
    const details = { items: r.items, usage: r.usage, enforced_micros: r.enforced_micros, external_paid_micros: r.external_paid_micros, budget_cap_micros: r.budget_cap_micros, price_version: r.price_version };
    const state = r.status === "proposed" ? (r.price_version === PRICE_CARD_VERSION ? "pending" : "stale") : r.status === "approved" ? "approved" : "stale";
    return { id: r.id, state, fingerprint: fp(details), details };
  }
  if (kind === "setup" || kind === "booking_page") {
    const k = kind === "setup" ? "provision_supabase" : "create_widget";
    const r = await one<{ id: string; status: string; spec: unknown }>(
      q,
      `SELECT id, status, spec FROM pending_actions WHERE user_id = $1 AND project_id = $2 AND kind = '${k}' ${by || "AND status = 'pending'"}
       ORDER BY created_at DESC LIMIT 1`,
      args,
    );
    if (!r) return;
    const state = r.status === "pending" ? "pending" : r.status === "rejected" ? "rejected" : "approved";
    const details = kind === "booking_page" ? WidgetSpec.parse(r.spec) : r.spec;
    return { id: r.id, state, fingerprint: fp(details), details: details as Record<string, unknown> };
  }
  if (kind === "api_key") {
    const r = await one<{ id: string; status: string; agent_token_id: string | null; client_name: string | null }>(
      q,
      `SELECT g.id, g.status, g.agent_token_id, t.client_name FROM key_grants g LEFT JOIN agent_tokens t ON t.id = g.agent_token_id
       WHERE g.user_id = $1 AND g.project_id = $2 ${id ? "AND g.id = $3" : "AND g.status = 'pending'"} ORDER BY g.created_at DESC LIMIT 1`,
      args,
    );
    if (!r) return;
    const p = await one<{ budget_micros: number | null }>(q, "SELECT budget_micros FROM projects WHERE id = $2 AND user_id = $1", [s.userId, s.projectId]);
    const live = await one<{ prefix: string }>(q, "SELECT prefix FROM api_keys WHERE user_id = $1 AND project_id = $2 AND revoked_at IS NULL", [s.userId, s.projectId]);
    // Bound to the agent that asked and the key it would replace. The budget is shown live, not fingerprinted: the cap
    // in force always applies.
    const bound = { agent_token_id: r.agent_token_id, replaces_key: live ? `mk_${live.prefix}` : null };
    const state = r.status === "pending" ? "pending" : r.status === "rejected" ? "rejected" : r.status === "superseded" ? "stale" : "approved";
    return {
      id: r.id,
      state,
      fingerprint: fp(bound),
      details: { replaces_key: bound.replaces_key, requested_by: r.client_name, monthly_budget_micros: p?.budget_micros ?? null },
    };
  }
  const r = await one<{ id: string; status: string; pack_id: PackId; budget: number | null }>(
    q,
    `SELECT t.id, t.status, t.pack_id, p.budget_micros AS budget FROM top_up_proposals t JOIN projects p ON p.id = t.project_id
     WHERE t.user_id = $1 AND t.project_id = $2 ${id ? "AND t.id = $3" : "AND t.status = 'proposed'"} ORDER BY t.created_at DESC LIMIT 1`,
    args,
  );
  if (!r) return;
  // Paying a top-up also raises the monthly cap (orders.ts), so the card states both and is bound to both: if the
  // budget changes after the link was made, the item goes stale instead of silently raising a different cap.
  const amount = PACKS[r.pack_id].amountMicros;
  const details = {
    pack: r.pack_id,
    amount_micros: amount,
    budget_before_micros: r.budget,
    budget_after_micros: r.budget == null ? null : r.budget + amount,
  };
  return { id: r.id, state: r.status === "proposed" ? "pending" : r.status === "paid" ? "approved" : "stale", fingerprint: fp(details), details };
}

const ORDER: ItemKind[] = ["stack", "top_up", "setup", "booking_page", "api_key"];

/** Everything currently waiting for the person, as a link. 409 if there's nothing to approve. */
export async function createApprovalLink(s: Scope) {
  const items: LinkItem[] = [];
  for (const kind of ORDER) {
    const c = await current(pool, s, kind);
    if (c?.state === "pending") items.push({ kind, id: c.id, fingerprint: c.fingerprint });
  }
  if (items.length === 0) throw new HttpError(409, "Nothing is waiting for approval", "nothing_pending");
  const id = newId("apr");
  await pool.query(
    `INSERT INTO approval_links (id, user_id, project_id, agent_token_id, items, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' hours')::interval)`,
    [id, s.userId, s.projectId, s.agentTokenId ?? null, JSON.stringify(items), String(LINK_TTL_HOURS)],
  );
  return { approval_id: id, url: `${appOrigin()}/approve/${id}`, items: items.map((i) => i.kind) };
}

type LinkRow = { id: string; user_id: string; project_id: string; items: LinkItem[]; expired: boolean };

async function loadLink(q: Db, userId: string, linkId: string, projectId?: string) {
  const l = await one<LinkRow>(
    q,
    `SELECT id, user_id, project_id, items, expires_at <= now() AS expired FROM approval_links
     WHERE id = $1 AND user_id = $2 ${projectId ? "AND project_id = $3" : ""}`,
    projectId ? [linkId, userId, projectId] : [linkId, userId],
  );
  if (!l) throw new HttpError(404, "Approval not found");
  return l;
}

/** Each item's state now. An item whose row changed since the link was made is "stale". */
export async function approvalView(userId: string, linkId: string, projectId?: string) {
  const l = await loadLink(pool, userId, linkId, projectId);
  const s = { userId, projectId: l.project_id };
  const items: ItemView[] = [];
  for (const it of l.items) {
    const c = await current(pool, s, it.kind, it.id);
    // Decided items keep their outcome; only a still-pending item can go stale (changed, or the link expired).
    const state = !c ? "stale" : c.state !== "pending" ? c.state : c.fingerprint !== it.fingerprint || l.expired ? "stale" : "pending";
    items.push({ ...it, state, details: c?.details ?? {} });
  }
  return { id: l.id, project_id: l.project_id, expired: l.expired, items };
}

/**
 * Checkout started from an approval link (R4-1): the link must be live and its top-up still exactly what the page
 * showed (pack, amount, budget before and after). A page left open after the budget changed can't start checkout.
 */
export async function requireTopUpOnLink(q: Db, userId: string, linkId: string, projectId: string, topUpId: string) {
  const l = await loadLink(q, userId, linkId, projectId);
  const it = l.items.find((i) => i.kind === "top_up" && i.id === topUpId);
  if (!it) throw new HttpError(404, "Approval not found");
  if (l.expired) throw new HttpError(409, "This link has expired. Ask your agent for a new one.", "stale");
  const c = await current(q, { userId, projectId }, "top_up", topUpId);
  if (!c || c.state !== "pending" || c.fingerprint !== it.fingerprint)
    throw new HttpError(409, "This changed since the link was made. Ask your agent for a new link.", "stale");
}

/**
 * The person approves (or rejects) one item from the link. Browser session + same origin are checked by the route.
 * Re-reads the row and its fingerprint first, so only what was shown can be approved. Top-ups are paid, not approved.
 */
export async function decideLinkItem(userId: string, linkId: string, index: number, approve: boolean) {
  const l = await loadLink(pool, userId, linkId);
  const it = l.items[index];
  if (!it || it.kind === "top_up") throw new HttpError(400, "Nothing to approve here");
  if (l.expired) throw new HttpError(409, "This link has expired. Ask your agent for a new one.", "stale");
  const s = { userId, projectId: l.project_id };
  const c = await current(pool, s, it.kind, it.id);
  if (!c || c.fingerprint !== it.fingerprint || c.state !== "pending")
    throw new HttpError(409, "This changed since the link was made. Ask your agent for a new link.", "stale");

  if (it.kind === "stack") {
    if (!approve) {
      await pool.query("UPDATE stack_proposals SET status = 'superseded', decided_at = now() WHERE id = $1 AND user_id = $2 AND status = 'proposed'", [it.id, userId]);
      return { ok: true };
    }
    return approveStack(s, it.id);
  }
  if (it.kind === "setup" || it.kind === "booking_page") return decideAction(userId, it.id, approve);
  // api_key: re-check under the project lock, then record exactly what was approved (the key it replaces, and until
  // when it can be collected). claimKey checks both again before minting.
  return tx(async (cx) => {
    await lockProject(cx, userId, l.project_id);
    const now = await current(cx, s, it.kind, it.id);
    if (!now || now.fingerprint !== it.fingerprint || now.state !== "pending")
      throw new HttpError(409, "This changed since the link was made. Ask your agent for a new link.", "stale");
    const live = await one<{ prefix: string }>(cx, "SELECT prefix FROM api_keys WHERE user_id = $1 AND project_id = $2 AND revoked_at IS NULL", [userId, l.project_id]);
    await cx.query(
      `UPDATE key_grants SET status = $3, decided_at = now(), approved_live_prefix = $4,
         approved_until = CASE WHEN $3 = 'approved' THEN now() + ($5 || ' minutes')::interval END
       WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
      [it.id, userId, approve ? "approved" : "rejected", live?.prefix ?? null, String(KEY_APPROVAL_TTL_MINUTES)],
    );
    return { ok: true };
  });
}

/** Open approval links for a project (agent view): ids and per-item state only. */
export async function listOpenApprovals(s: Scope) {
  const rows = await many<{ id: string }>(
    pool,
    "SELECT id FROM approval_links WHERE user_id = $1 AND project_id = $2 AND expires_at > now() ORDER BY created_at DESC LIMIT 5",
    [s.userId, s.projectId],
  );
  const out = [];
  for (const r of rows) {
    const v = await approvalView(s.userId, r.id, s.projectId);
    out.push({ approval_id: v.id, url: `${appOrigin()}/approve/${v.id}`, items: v.items.map((i) => ({ kind: i.kind, state: i.state })) });
  }
  return out;
}
