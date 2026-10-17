import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { projectWidget } from "./booking";
import { newId, one, pool, tx } from "./db";
import { HttpError } from "./session";
import type { Scope } from "./stack";

// Booking API keys for the builder's own server (SPEC §6). Shown once, never stored in plain text, never sent to a
// browser by Kitpier. The key only reaches the booking endpoints of its own project's booking page.

const KEY = /^mk_([0-9a-f]{10})_([A-Za-z0-9_-]{43})$/;
const hash = (secret: string) => createHash("sha256").update(secret).digest();

/** Mint a key for this project's booking page. The previous key stops working. Returns the full key once. */
export async function createKey(s: Scope) {
  const w = await projectWidget(s);
  if (!w) throw new HttpError(409, "Publish your booking page first");
  const prefix = randomBytes(5).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  await tx(async (c) => {
    await c.query("UPDATE api_keys SET revoked_at = now() WHERE user_id = $1 AND project_id = $2 AND revoked_at IS NULL", [s.userId, s.projectId]);
    await c.query(
      "INSERT INTO api_keys (id, user_id, project_id, widget_id, prefix, secret_hash) VALUES ($1, $2, $3, $4, $5, $6)",
      [newId("key"), s.userId, s.projectId, w.id, prefix, hash(secret)],
    );
  });
  return { key: `mk_${prefix}_${secret}`, prefix };
}

export async function revokeKeys(s: Scope) {
  await pool.query("UPDATE api_keys SET revoked_at = now() WHERE user_id = $1 AND project_id = $2 AND revoked_at IS NULL", [s.userId, s.projectId]);
}

/** Display only: the prefix and dates, never the secret. */
export function liveKey(s: Scope) {
  return one<{ prefix: string; created_at: string; last_used_at: string | null }>(
    pool,
    "SELECT prefix, created_at, last_used_at FROM api_keys WHERE user_id = $1 AND project_id = $2 AND revoked_at IS NULL",
    [s.userId, s.projectId],
  );
}

/** Authorization: Bearer mk_… → the key's id and booking page. Anything else is a 401 with the same message. */
export async function requireApiKey(req: Request) {
  const denied = new HttpError(401, "Missing or invalid API key", "unauthorized");
  const m = KEY.exec(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "");
  if (!m) throw denied;
  const row = await one<{ id: string; widget_id: string; secret_hash: Buffer }>(
    pool,
    `SELECT k.id, k.widget_id, k.secret_hash FROM api_keys k JOIN widgets w ON w.id = k.widget_id
     WHERE k.prefix = $1 AND k.revoked_at IS NULL AND w.active`,
    [m[1]],
  );
  if (!row || !timingSafeEqual(hash(m[2]), row.secret_hash)) throw denied;
  await pool.query("UPDATE api_keys SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')", [row.id]);
  return { keyId: row.id, widgetId: row.widget_id };
}
