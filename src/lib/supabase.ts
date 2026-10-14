import { createHash, randomBytes } from "node:crypto";
import { one, pool } from "./db";
import { deleteCredential, getCredential, putCredential } from "./credentials";
import { HttpError } from "./session";

// Supabase Management API over OAuth + PKCE (SPEC §7). Connecting stores a token and creates nothing:
// provider changes happen only after the user approves a pending action.

const API = "https://api.supabase.com";
type Scope = { userId: string; projectId: string };
type Tokens = { access_token: string; refresh_token: string; expires_at: number };

function client() {
  const id = process.env.SUPABASE_OAUTH_CLIENT_ID;
  const secret = process.env.SUPABASE_OAUTH_CLIENT_SECRET;
  if (!id || !secret) throw new HttpError(503, "Supabase connect is not configured");
  return { id, secret, basic: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64") };
}

export function redirectUri() {
  const appUrl = process.env.APP_URL;
  if (!appUrl) throw new Error("APP_URL must be set");
  return new URL("/api/connect/supabase/callback", appUrl).toString();
}

/** Step 1: remember a single-use state + PKCE verifier for this user/project, return the consent URL. */
export async function startConnect(s: Scope) {
  const { id } = client();
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  await pool.query("DELETE FROM oauth_states WHERE expires_at < now()");
  await pool.query(
    `INSERT INTO oauth_states (state, user_id, project_id, provider, verifier, expires_at)
     VALUES ($1, $2, $3, 'supabase', $4, now() + interval '10 minutes')`,
    [state, s.userId, s.projectId, verifier],
  );
  const url = new URL(`${API}/v1/oauth/authorize`);
  url.search = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri(),
    response_type: "code",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

/** Consume the state: must exist, be unexpired and belong to the signed-in user. Single use either way. */
export async function claimState(userId: string, state: string) {
  const row = await one<{ project_id: string; verifier: string; ok: boolean }>(
    pool,
    `DELETE FROM oauth_states WHERE state = $1 AND provider = 'supabase'
     RETURNING project_id, verifier, (user_id = $2 AND expires_at > now()) AS ok`,
    [state, userId],
  );
  if (!row?.ok) throw new HttpError(400, "This connect link expired. Please try again.");
  return { projectId: row.project_id, verifier: row.verifier };
}

async function tokenRequest(params: Record<string, string>): Promise<Tokens> {
  const { basic } = client();
  const r = await fetch(`${API}/v1/oauth/token`, {
    method: "POST",
    headers: { Authorization: basic, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params),
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number };
  // Never echo the provider body: it can contain tokens.
  if (!r.ok || !j.access_token || !j.refresh_token) throw new HttpError(502, `Supabase token request failed (${r.status})`);
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: Date.now() + (j.expires_in ?? 3600) * 1000,
  };
}

/** Step 2: exchange the code, confirm the token works, store it encrypted. Nothing is created in Supabase. */
export async function finishConnect(s: Scope, code: string, verifier: string) {
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri(), code_verifier: verifier });
  const orgs = await call<{ name: string }[]>(t.access_token, "GET", "/v1/organizations");
  await putCredential(s, "supabase_oauth", JSON.stringify(t), {
    orgs: orgs.map((o) => String(o.name).slice(0, 80)).slice(0, 10),
  });
}

export async function call<T>(access: string, method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new HttpError(r.status === 401 ? 409 : 502, `Supabase request failed (${r.status})`, "supabase");
  return (await r.json()) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A valid access token for this user/project. Refresh tokens rotate on every use, so only one request may
 * refresh at a time: it claims refresh_lock_until, refreshes outside any transaction, stores the new pair.
 */
export async function accessToken(s: Scope): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const cred = await getCredential(s, "supabase_oauth");
    if (!cred) throw new HttpError(409, "Supabase is not connected", "not_connected");
    const t = JSON.parse(cred.secret) as Tokens;
    if (t.expires_at - Date.now() > 60_000) return t.access_token;

    const claimed = await one(
      pool,
      `UPDATE credentials SET refresh_lock_until = now() + interval '30 seconds'
       WHERE id = $1 AND user_id = $2 AND (refresh_lock_until IS NULL OR refresh_lock_until < now()) RETURNING id`,
      [cred.id, s.userId],
    );
    if (!claimed) {
      await sleep(500); // someone else is refreshing; re-read their result
      continue;
    }
    let next: Tokens;
    try {
      next = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token });
    } catch (e) {
      await pool.query("UPDATE credentials SET refresh_lock_until = NULL WHERE id = $1", [cred.id]);
      throw e;
    }
    await putCredential(s, "supabase_oauth", JSON.stringify(next), cred.meta as object);
    return next.access_token;
  }
  throw new HttpError(503, "Supabase is busy, try again");
}

/** Revoke at Supabase (best effort) and forget the token. */
export async function disconnect(s: Scope) {
  const cred = await getCredential(s, "supabase_oauth");
  if (!cred) return;
  const { id, secret } = client();
  const t = JSON.parse(cred.secret) as Tokens;
  await fetch(`${API}/v1/oauth/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: id, client_secret: secret, refresh_token: t.refresh_token }),
  }).catch(() => {});
  await deleteCredential(s, "supabase_oauth");
}

