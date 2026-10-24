import { liveKey } from "./apikeys";
import { appOrigin } from "./app-url";
import { approvalView, claimKey, createApprovalLink, listOpenApprovals, requestKey } from "./approvals";
import { WidgetSpec, proposeWidget, widgetState } from "./booking";
import { pool } from "./db";
import { demoInbox } from "./demo";
import { rateLimit } from "./http";
import { listPlanMessages, runPlanner } from "./planner";
import { advanceProvision, proposeProvision, provisionState } from "./provision";
import { HttpError } from "./session";
import { isValidTimeZone } from "./slots";
import { listProposals, projectStatus, searchCatalog, type Scope } from "./stack";
import { listTopUps } from "./topup";

// What an agent can do, shared by the REST API (/v1/agent/*) and the MCP server (/mcp) so the two can't drift.
// Every action reads or proposes for the token's one project; approving and paying happen only in the person's browser.

/** Everything the agent needs to decide its next step. Read-only. */
export async function projectView(s: Scope) {
  const project = await pool.query("SELECT id, name FROM projects WHERE id = $1 AND user_id = $2", [s.projectId, s.userId]);
  const w = await widgetState(s);
  const key = await liveKey(s);
  const grant = await pool.query("SELECT status FROM key_grants WHERE project_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1", [
    s.projectId,
    s.userId,
  ]);
  const messages = await listPlanMessages(s);
  return {
    project: project.rows[0],
    status: await projectStatus(pool, s),
    proposals: await listProposals(pool, s),
    top_ups: await listTopUps(pool, s),
    setup: await provisionState(s),
    booking_page: { proposed: w.action, live: w.widget ? { ...w.widget, url: `${appOrigin()}/r/${w.widget.id}` } : null },
    api_key: { live_prefix: key ? `mk_${key.prefix}` : null, request: grant.rows[0]?.status ?? null },
    approvals: await listOpenApprovals(s),
    planner: messages.slice(-6),
  };
}

/** Message Kitpier's planner (shared free quota). A stack it proposes still needs the person's approval. */
export async function plan(s: Scope, message: string) {
  await rateLimit(`plan:${s.userId}`, 20, 24 * 60 * 60_000);
  await runPlanner(s, message);
  const messages = await listPlanMessages(s);
  return { reply: messages.at(-1)?.body ?? "", proposals: await listProposals(pool, s) };
}

export async function proposeBookingPage(s: Scope, input: unknown) {
  const spec = WidgetSpec.parse(input);
  if (!isValidTimeZone(spec.timezone)) throw new HttpError(400, "Unknown timezone");
  await proposeWidget(s, spec);
  return widgetState(s);
}

export async function proposeSetup(s: Scope) {
  await rateLimit(`provision:${s.userId}`, 10, 60 * 60_000);
  await proposeProvision(s);
  return provisionState(s);
}

/** Runs the next step of a setup the person already approved; nothing otherwise. */
export async function advanceSetup(s: Scope) {
  await rateLimit(`provision-advance:${s.projectId}`, 120, 60 * 60_000);
  await advanceProvision(s);
  return provisionState(s);
}

export async function askForKey(s: Scope) {
  await rateLimit(`key-request:${s.userId}`, 10, 24 * 60 * 60_000);
  return requestKey(s);
}

export async function approvalLink(s: Scope) {
  await rateLimit(`approval-link:${s.projectId}`, 30, 60 * 60_000);
  return createApprovalLink(s);
}

export async function approvalState(s: Scope, approvalId: string) {
  const v = await approvalView(s.userId, approvalId, s.projectId);
  return { approval_id: v.id, expired: v.expired, items: v.items.map((i) => ({ kind: i.kind, state: i.state })) };
}

export const collectKey = claimKey;
export const catalog = searchCatalog;
export const demo = demoInbox;
