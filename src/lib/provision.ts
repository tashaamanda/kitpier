import { randomBytes } from "node:crypto";
import { createWidgetTx, WidgetSpec } from "./booking";
import { putCredential } from "./credentials";
import { newId, one, pool, tx } from "./db";
import { HttpError } from "./session";
import { accessToken, call } from "./supabase";
import { BOOKINGS_TEMPLATE, BOOKINGS_V1 } from "./templates";

// Supabase provisioning behind the approval gate (SPEC §7, §8). A pending_action describes exactly what will
// happen; only POST /api/actions/:id/approve starts a job; polls advance it one step at a time.
// Every Management API call on a project ref checks managed_supabase_refs first and fails closed.

type Scope = { userId: string; projectId: string; agentTokenId?: string };
export type ProvisionSpec = { mode: "new"; org_slug: string; org_name: string; project_name: string; region: "americas"; template: string };
export type Job = { id: string; state: string; ref: string | null; error: string | null; updated_at: string };
type Action = { id: string; status: string; spec: ProvisionSpec; created_at: string };

const FREE_PLAN_ACTIVE_LIMIT = 2;
const ACTIVE = (s: string) => !["INACTIVE", "PAUSED", "REMOVED", "GOING_DOWN", "PAUSING"].includes(s);

export async function provisionState(s: Scope) {
  const action = await one<Action>(
    pool,
    `SELECT id, status, spec, created_at FROM pending_actions
     WHERE user_id = $1 AND project_id = $2 AND kind = 'provision_supabase' ORDER BY created_at DESC LIMIT 1`,
    [s.userId, s.projectId],
  );
  const job = await one<Job>(
    pool,
    "SELECT id, state, ref, error, updated_at FROM provision_jobs WHERE user_id = $1 AND project_id = $2",
    [s.userId, s.projectId],
  );
  return { action: action ?? null, job: job ?? null };
}

/** Propose a new Supabase project. Read-only calls only; inserts a pending_action and nothing else. */
export async function proposeProvision(s: Scope) {
  const job = await one<Job>(pool, "SELECT state FROM provision_jobs WHERE user_id = $1 AND project_id = $2", [s.userId, s.projectId]);
  if (job && job.state !== "failed") throw new HttpError(409, "The database is already being set up for this project");

  const token = await accessToken(s);
  const orgs = await call<{ id: string; slug?: string; name: string }[]>(token, "GET", "/v1/organizations");
  const projects = await call<unknown>(token, "GET", "/v1/projects");
  if (!Array.isArray(orgs) || orgs.length === 0 || !Array.isArray(projects))
    throw new HttpError(409, "Kitpier can't read your Supabase organizations. Reconnect Supabase and allow all requested access.");
  const active = (projects as { status: string }[]).filter((p) => ACTIVE(p.status)).length;
  if (active >= FREE_PLAN_ACTIVE_LIMIT)
    throw new HttpError(409, `Your Supabase account already has ${active} active projects, the free-plan limit. Pause one in Supabase, then try again.`, "supabase_cap");

  const org = orgs[0];
  const p = await one<{ name: string }>(pool, "SELECT name FROM projects WHERE id = $1 AND user_id = $2", [s.projectId, s.userId]);
  const slug = (p?.name ?? "app").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "app";
  const spec: ProvisionSpec = {
    mode: "new",
    org_slug: String(org.slug ?? org.id),
    org_name: String(org.name).slice(0, 80),
    project_name: `kitpier-${slug}-${randomBytes(2).toString("hex")}`,
    region: "americas",
    template: BOOKINGS_TEMPLATE,
  };
  const id = newId("act");
  await tx(async (c) => {
    await c.query(
      "UPDATE pending_actions SET status = 'rejected', decided_at = now() WHERE user_id = $1 AND project_id = $2 AND kind = 'provision_supabase' AND status = 'pending'",
      [s.userId, s.projectId],
    );
    await c.query("INSERT INTO pending_actions (id, user_id, project_id, kind, spec, agent_token_id) VALUES ($1, $2, $3, 'provision_supabase', $4, $5)", [
      id,
      s.userId,
      s.projectId,
      JSON.stringify(spec),
      s.agentTokenId ?? null,
    ]);
  });
  return { id, spec };
}

/** The approval gate. Session + origin are checked by the route; ownership here. Idempotent per project. */
export async function decideAction(userId: string, actionId: string, approve: boolean) {
  return tx(async (c) => {
    const a = await one<{ project_id: string; kind: string; spec: unknown }>(
      c,
      `UPDATE pending_actions SET status = $3, decided_at = now()
       WHERE id = $1 AND user_id = $2 AND status = 'pending' RETURNING project_id, kind, spec`,
      [actionId, userId, approve ? "approved" : "rejected"],
    );
    if (!a) throw new HttpError(404, "This request is no longer waiting for approval");
    if (approve && a.kind === "create_widget") {
      const widget = await createWidgetTx(c, { userId, projectId: a.project_id }, WidgetSpec.parse(a.spec));
      await c.query("UPDATE pending_actions SET status = 'done' WHERE id = $1", [actionId]);
      return { project_id: a.project_id, job: null, widget };
    }
    if (!approve || a.kind !== "provision_supabase") return { project_id: a.project_id, job: null };
    const job = await one<Job>(
      c,
      `INSERT INTO provision_jobs (id, user_id, project_id, action_id) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, project_id) DO UPDATE SET state = 'requested', action_id = EXCLUDED.action_id,
         ref = NULL, error = NULL, lock_until = NULL, updated_at = now()
       WHERE provision_jobs.state = 'failed'
       RETURNING id, state, ref, error, updated_at`,
      [newId("job"), userId, a.project_id, actionId],
    );
    if (!job) throw new HttpError(409, "The database is already being set up for this project");
    return { project_id: a.project_id, job };
  });
}

async function assertManaged(s: Scope, ref: string) {
  const ok = await one(pool, "SELECT 1 FROM managed_supabase_refs WHERE user_id = $1 AND project_id = $2 AND ref = $3", [
    s.userId,
    s.projectId,
    ref,
  ]);
  if (!ok) throw new HttpError(403, "Kitpier only touches Supabase projects it created for you");
}

async function setJob(id: string, fields: { state?: string; ref?: string; error?: string | null }) {
  await pool.query(
    `UPDATE provision_jobs SET state = COALESCE($2, state), ref = COALESCE($3, ref),
       error = CASE WHEN $5 THEN $4 ELSE error END, updated_at = now() WHERE id = $1`,
    [id, fields.state ?? null, fields.ref ?? null, fields.error ?? null, "error" in fields],
  );
}

/** One step of the job per call; concurrent polls skip while another holds the lock. */
export async function advanceProvision(s: Scope) {
  const job = await one<Job & { action_id: string; stale: boolean }>(
    pool,
    `UPDATE provision_jobs SET lock_until = now() + interval '60 seconds'
     WHERE user_id = $1 AND project_id = $2 AND state IN ('requested','creating','healthy')
       AND (lock_until IS NULL OR lock_until < now())
     RETURNING id, state, ref, error, updated_at, action_id, (updated_at < now() - interval '3 minutes') AS stale`,
    [s.userId, s.projectId],
  );
  if (!job) return;
  try {
    await step(s, job);
  } finally {
    await pool.query("UPDATE provision_jobs SET lock_until = NULL WHERE id = $1", [job.id]);
  }
}

async function step(s: Scope, job: Job & { action_id: string; stale: boolean }) {
  if (job.state === "requested") {
    const a = await one<{ spec: ProvisionSpec }>(pool, "SELECT spec FROM pending_actions WHERE id = $1 AND user_id = $2 AND status = 'approved'", [
      job.action_id,
      s.userId,
    ]);
    if (!a) return setJob(job.id, { state: "failed", error: "The approval for this setup is missing" });
    const token = await accessToken(s);
    // Mark before calling out, so a retry can never create a second project.
    await setJob(job.id, { state: "creating", error: null });
    let made: { ref?: string; id?: string };
    try {
      made = await call(token, "POST", "/v1/projects", {
        name: a.spec.project_name,
        organization_slug: a.spec.org_slug,
        db_pass: randomBytes(24).toString("base64url"), // memory only; reset it in Supabase if you need it
        region_selection: { type: "smartGroup", code: a.spec.region },
      });
    } catch {
      return setJob(job.id, { state: "failed", error: "Supabase couldn't create the project. Your account may be at its free-plan limit." });
    }
    const ref = String(made.ref ?? made.id ?? "");
    if (!/^[a-z0-9]{10,40}$/.test(ref)) return setJob(job.id, { state: "failed", error: "Supabase returned an unexpected project id" });
    await pool.query(
      "INSERT INTO managed_supabase_refs (user_id, project_id, ref, created_by_us) VALUES ($1, $2, $3, true) ON CONFLICT DO NOTHING",
      [s.userId, s.projectId, ref],
    );
    return setJob(job.id, { ref });
  }

  if (job.state === "creating" && !job.ref) {
    if (job.stale) await setJob(job.id, { state: "failed", error: "Setup was interrupted. Check Supabase for a kitpier- project before retrying." });
    return;
  }

  const ref = job.ref!;
  await assertManaged(s, ref);
  const token = await accessToken(s);
  try {
    if (job.state === "creating") {
      const p = await call<{ status: string }>(token, "GET", `/v1/projects/${ref}`);
      if (p.status === "ACTIVE_HEALTHY") await setJob(job.id, { state: "healthy", error: null });
      return;
    }
    if (job.state === "healthy") {
      const keys = await call<{ type?: string; name?: string; api_key?: string }[]>(token, "GET", `/v1/projects/${ref}/api-keys?reveal=true`);
      const secret = keys.find((k) => k.type === "secret")?.api_key ?? keys.find((k) => k.name === "service_role")?.api_key;
      if (!secret) throw new HttpError(502, "Supabase returned no server key yet");
      await putCredential(s, "supabase_secret_key", secret, { ref });
      await call(token, "POST", `/v1/projects/${ref}/database/query`, { query: BOOKINGS_V1 });
      await setJob(job.id, { state: "schema_ready", error: null });
    }
  } catch (e) {
    // Transient: keep the state, show why, the next poll retries.
    await setJob(job.id, { error: e instanceof HttpError ? e.message : "Waiting on Supabase" });
  }
}

