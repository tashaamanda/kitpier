import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { newId, one, pool, tx, type Db } from "./db";

// Third-party secrets at rest (SPEC §7): AES-256-GCM, AAD = id|user_id|project_id|kind, key_version per row.
// Decrypt only inside the server-side code that calls the provider. Never log, return or send plaintext to the model.

export type CredentialKind = "supabase_oauth" | "supabase_secret_key" | "resend_send_key";
type Scope = { userId: string; projectId: string };
type Row = { id: string; key_version: number; iv: Buffer; ciphertext: Buffer; tag: Buffer; meta: unknown };

const KEY_VERSION = 1;

function masterKey(version: number) {
  if (version !== KEY_VERSION) throw new Error(`Unknown credentials key version ${version}`);
  const k = Buffer.from(process.env.CREDENTIALS_MASTER_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("CREDENTIALS_MASTER_KEY must be 32 bytes, base64");
  return k;
}

const aad = (id: string, s: Scope, kind: CredentialKind) => Buffer.from(`${id}|${s.userId}|${s.projectId}|${kind}`);

export function seal(id: string, s: Scope, kind: CredentialKind, plaintext: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", masterKey(KEY_VERSION), iv);
  c.setAAD(aad(id, s, kind));
  const ciphertext = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return { key_version: KEY_VERSION, iv, ciphertext, tag: c.getAuthTag() };
}

export function open(id: string, s: Scope, kind: CredentialKind, r: Omit<Row, "id" | "meta">) {
  const d = createDecipheriv("aes-256-gcm", masterKey(r.key_version), r.iv);
  d.setAAD(aad(id, s, kind));
  d.setAuthTag(r.tag);
  return Buffer.concat([d.update(r.ciphertext), d.final()]).toString("utf8");
}

/** Insert or replace the credential of this kind for the project. Returns its id. */
/**
 * Stores (or replaces) one credential. The row id is part of the ciphertext's AAD, so two first writes racing must
 * agree on it: a transaction-scoped advisory lock per (project, kind) serializes them, and each writer reads the
 * persisted id under that lock before sealing. With a caller's client (`q`), the caller's transaction holds the lock.
 */
export async function putCredential(s: Scope, kind: CredentialKind, plaintext: string, meta: object = {}, q?: Db) {
  const write = async (c: Db) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`credential:${s.projectId}:${kind}`]);
    const existing = await one<{ id: string }>(c, "SELECT id FROM credentials WHERE project_id = $1 AND kind = $2", [s.projectId, kind]);
    const id = existing?.id ?? newId("cred");
    const e = seal(id, s, kind, plaintext);
    const r = await c.query(
      `INSERT INTO credentials (id, user_id, project_id, kind, key_version, iv, ciphertext, tag, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (project_id, kind) DO UPDATE SET key_version = EXCLUDED.key_version, iv = EXCLUDED.iv,
         ciphertext = EXCLUDED.ciphertext, tag = EXCLUDED.tag, meta = EXCLUDED.meta,
         refresh_lock_until = NULL, updated_at = now()
       WHERE credentials.user_id = EXCLUDED.user_id AND credentials.id = EXCLUDED.id`,
      [id, s.userId, s.projectId, kind, e.key_version, e.iv, e.ciphertext, e.tag, JSON.stringify(meta)],
    );
    // Not written: another user's row, or (can't happen under the lock) a row whose id differs from the AAD we sealed.
    if (r.rowCount !== 1) throw new Error("Credential write conflict");
    return id;
  };
  return q ? write(q) : tx(write);
}

/** Decrypted secret for (user, project, kind), or undefined. The user_id filter is the ownership check. */
export async function getCredential(s: Scope, kind: CredentialKind, q: Db = pool) {
  const r = await one<Row>(
    q,
    "SELECT id, key_version, iv, ciphertext, tag, meta FROM credentials WHERE user_id = $1 AND project_id = $2 AND kind = $3",
    [s.userId, s.projectId, kind],
  );
  if (!r) return undefined;
  return { id: r.id, secret: open(r.id, s, kind, r), meta: r.meta };
}

export async function deleteCredential(s: Scope, kind: CredentialKind, q: Db = pool) {
  await q.query("DELETE FROM credentials WHERE user_id = $1 AND project_id = $2 AND kind = $3", [
    s.userId,
    s.projectId,
    kind,
  ]);
}
