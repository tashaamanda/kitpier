import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { LIVE_ACCOUNT } from "./account-expiry";
import { appOrigin } from "./app-url";
import { many, newId, one, pool, tx } from "./db";
import { createProject } from "./projects";
import { HttpError, type User } from "./session";

// Agent access (docs/agent-scope.md B). An agent asks for a link; the signed-in owner allows it for one project; the
// agent's poll redeems it once for a ka_ token. The token can read, plan and propose. It can never approve, pay,
// connect accounts or issue keys: those routes take only a browser session.

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O, 1/I/L lookalikes; 31^8 ≈ 2^39.6
const CODE_LEN = 8;
const LINK_TTL_MS = 10 * 60_000;
const POLL_INTERVAL_S = 5;
const TOKEN_TTL_DAYS = 30;
const TOKEN = /^ka_([0-9a-f]{10})_([A-Za-z0-9_-]{43})$/;

const sha = (s: string) => createHash("sha256").update(s).digest();

/** Uppercase, drop dashes/spaces; anything else makes it not a code. */
export function normalizeCode(raw: string) {
  const c = raw.toUpperCase().replace(/[\s-]/g, "");
  return c.length === CODE_LEN && [...c].every((ch) => ALPHABET.includes(ch)) ? c : null;
}

export const displayCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;

/** Self-reported names are shown to people: printable text only, short. */
export function cleanName(s: string, max: number) {
  return s.replace(/\s+/g, " ").replace(/[\p{C}]/gu, "").replace(/ +/g, " ").trim().slice(0, max);
}

/**
 * New agent connections are off in production until AGENT_CONNECT_ENABLED=1, which is set only after the client-IP
 * header has been verified on the deployment (the per-IP limits depend on it). Always on in dev and tests.
 */
export function agentConnectOpen(env: Record<string, string | undefined> = process.env) {
  return env.NODE_ENV !== "production" || env.AGENT_CONNECT_ENABLED === "1";
}

export async function startLink(input: { clientName: string; projectName?: string }) {
  const clientName = cleanName(input.clientName, 60);
  if (!clientName) throw new HttpError(400, "client_name is required");
  const projectName = input.projectName ? cleanName(input.projectName, 80) || null : null;
  const code = Array.from({ length: CODE_LEN }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  const pollToken = randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO agent_links (id, code_hash, poll_hash, client_name, project_name, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' milliseconds')::interval)`,
    [newId("lnk"), sha(code), sha(pollToken), clientName, projectName, String(LINK_TTL_MS)],
  );
  return {
    code: displayCode(code),
    url: `${appOrigin()}/link/${displayCode(code)}`,
    poll_token: pollToken,
    interval: POLL_INTERVAL_S,
    expires_in: LINK_TTL_MS / 1000,
  };
}

export type PendingLink = { id: string; client_name: string; project_name: string | null };

/** A link the signed-in person may still decide on, or null (unknown, expired, already decided). */
export function openLink(code: string) {
  const c = normalizeCode(code);
  if (!c) return Promise.resolve(undefined);
  return one<PendingLink>(
    pool,
    "SELECT id, client_name, project_name FROM agent_links WHERE code_hash = $1 AND state = 'pending' AND expires_at > now()",
    [sha(c)],
  );
}

/**
 * The owner's decision. Allow binds the link to one of their projects (or a new one) and gives the agent 10 minutes
 * to collect the token. Only pending, unexpired links change, and only once.
 */
export async function decideLink(
  user: User,
  code: string,
  d: { allow: false } | { allow: true; projectId: string } | { allow: true; newProjectName: string },
) {
  const link = await openLink(code);
  if (!link) throw new HttpError(404, "This link has expired or was already used. Ask your agent for a new one.");
  let projectId: string | null = null;
  if (d.allow) {
    if ("projectId" in d) {
      const p = await one(pool, "SELECT 1 FROM projects WHERE id = $1 AND user_id = $2", [d.projectId, user.id]);
      if (!p) throw new HttpError(404, "Project not found");
      projectId = d.projectId;
    } else {
      const name = cleanName(d.newProjectName, 80);
      if (!name) throw new HttpError(400, "Name the new project");
      projectId = await createProject(user, { name });
    }
  }
  // Bound to the session's password-reset generation: if a reset happened since this session signed in, nothing changes.
  const r = await pool.query(
    `UPDATE agent_links SET state = $2, user_id = $3, project_id = $4, decided_at = now(), user_version = u.session_version,
       expires_at = CASE WHEN $2 = 'approved' THEN now() + ($5 || ' milliseconds')::interval ELSE expires_at END
     FROM users u
     WHERE agent_links.id = $1 AND agent_links.state = 'pending' AND agent_links.expires_at > now()
       AND u.id = $3 AND u.session_version = $6`,
    [link.id, d.allow ? "approved" : "denied", user.id, projectId, String(LINK_TTL_MS), user.session_version ?? 0],
  );
  if (r.rowCount !== 1) throw new HttpError(409, "This link was already used. Ask your agent for a new one.");
  return { allowed: d.allow, projectId };
}

export type PollResult =
  | { status: "pending" | "slow_down" | "denied" | "expired" }
  | { status: "approved"; token: string; project_id: string; expires_at: string };

/**
 * The agent's poll. At most one call per interval; an approved link is redeemed exactly once, atomically, and only while
 * the user's session version still matches the one it was allowed under. Lock order is user row, then link, the same
 * order a password reset takes, so a reset and a redemption can't interleave.
 */
export async function pollLink(pollToken: string): Promise<PollResult> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(pollToken)) return { status: "expired" };
  const pre = await one<{ user_id: string | null }>(pool, "SELECT user_id FROM agent_links WHERE poll_hash = $1", [sha(pollToken)]);
  if (!pre) return { status: "expired" };
  return tx(async (c) => {
    const owner = pre.user_id
      ? await one<{ session_version: number }>(c, "SELECT session_version FROM users WHERE id = $1 FOR SHARE", [pre.user_id])
      : undefined;
    const link = await one<{ id: string; state: string; user_id: string | null; user_version: number | null; expired: boolean; too_soon: boolean }>(
      c,
      `SELECT id, state, user_id, user_version, expires_at <= now() AS expired,
              coalesce(last_poll_at > now() - ($2 || ' seconds')::interval, false) AS too_soon
       FROM agent_links WHERE poll_hash = $1 FOR UPDATE`,
      [sha(pollToken), String(POLL_INTERVAL_S - 1)],
    );
    if (!link || link.state === "redeemed" || link.state === "revoked") return { status: "expired" };
    // Decided between the two reads: we don't hold the owner's row yet, so answer pending and redeem on the next poll.
    if (link.user_id !== pre.user_id) return { status: "pending" };
    if (link.too_soon) return { status: "slow_down" };
    await c.query("UPDATE agent_links SET last_poll_at = now() WHERE id = $1", [link.id]);
    if (link.state === "denied") return { status: "denied" };
    if (link.expired) return { status: "expired" };
    if (link.state === "pending") return { status: "pending" };
    if (!owner || link.user_version !== owner.session_version) {
      await c.query("UPDATE agent_links SET state = 'revoked' WHERE id = $1", [link.id]);
      return { status: "expired" };
    }

    const won = await one<{ user_id: string; project_id: string; client_name: string }>(
      c,
      "UPDATE agent_links SET state = 'redeemed' WHERE id = $1 AND state = 'approved' RETURNING user_id, project_id, client_name",
      [link.id],
    );
    if (!won) return { status: "expired" };
    const prefix = randomBytes(5).toString("hex");
    const secret = randomBytes(32).toString("base64url");
    const t = await one<{ expires_at: string }>(
      c,
      `INSERT INTO agent_tokens (id, link_id, user_id, project_id, client_name, prefix, secret_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() + ($8 || ' days')::interval) RETURNING expires_at`,
      [newId("agt"), link.id, won.user_id, won.project_id, won.client_name, prefix, sha(secret), String(TOKEN_TTL_DAYS)],
    );
    return { status: "approved", token: `ka_${prefix}_${secret}`, project_id: won.project_id, expires_at: t!.expires_at };
  });
}

export type AgentCaller = { tokenId: string; userId: string; projectId: string };

/** Authorization: Bearer ka_… → its one user and project. Anything else is a 401 with the same message. */
export async function requireAgentToken(req: Request): Promise<AgentCaller> {
  const denied = new HttpError(401, "Missing or invalid agent token", "unauthorized");
  const m = TOKEN.exec(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "");
  if (!m) throw denied;
  const row = await one<{ id: string; user_id: string; project_id: string; secret_hash: Buffer }>(
    pool,
    `SELECT t.id, t.user_id, t.project_id, t.secret_hash FROM agent_tokens t JOIN users u ON u.id = t.user_id
     WHERE t.prefix = $1 AND t.revoked_at IS NULL AND t.expires_at > now()
       AND (t.last_used_at IS NOT NULL OR t.created_at > now() - interval '24 hours') AND ${LIVE_ACCOUNT}`,
    [m[1]],
  );
  if (!row || !timingSafeEqual(sha(m[2]), row.secret_hash)) throw denied;
  await pool.query(
    "UPDATE agent_tokens SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')",
    [row.id],
  );
  return { tokenId: row.id, userId: row.user_id, projectId: row.project_id };
}

export type AgentTokenView = {
  id: string;
  client_name: string;
  prefix: string;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
};

/** Owner view of a project's live agent tokens (never the secret). */
export function listAgentTokens(userId: string, projectId: string) {
  return many<AgentTokenView>(
    pool,
    `SELECT id, client_name, prefix, created_at, expires_at, last_used_at FROM agent_tokens
     WHERE user_id = $1 AND project_id = $2 AND revoked_at IS NULL AND expires_at > now()
       AND (last_used_at IS NOT NULL OR created_at > now() - interval '24 hours')
     ORDER BY created_at DESC`,
    [userId, projectId],
  );
}

export async function revokeAgentToken(userId: string, projectId: string, tokenId: string) {
  const r = await pool.query(
    "UPDATE agent_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND project_id = $3 AND revoked_at IS NULL",
    [tokenId, userId, projectId],
  );
  if (r.rowCount !== 1) throw new HttpError(404, "Agent not found");
}
