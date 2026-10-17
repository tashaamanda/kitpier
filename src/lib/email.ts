import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { getCredential } from "./credentials";
import { newId, one, pool } from "./db";
import { captureMail, isDemo } from "./demo";
import { rateLimit } from "./http";
import { HttpError } from "./session";

// Booking emails through the business's own Resend (send-only key). Fixed templates only: escaped values,
// no model-written text, no links. Codes are bound to one booking card and one address.

type Scope = { userId: string; projectId: string };
const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const plain = (v: string) => v.replace(/[\r\n<>"]/g, " ").trim().slice(0, 80);

function codeHash(pendingId: string, email: string, code: string) {
  const key = process.env.CREDENTIALS_MASTER_KEY;
  if (!key) throw new Error("CREDENTIALS_MASTER_KEY must be set");
  return createHmac("sha256", key).update(`${pendingId}|${email.toLowerCase()}|${code}`).digest("hex");
}

const recipientKey = (email: string) => createHmac("sha256", "kitpier-rl").update(email.toLowerCase()).digest("hex").slice(0, 24);

export async function emailConnected(s: Scope) {
  if (await isDemo(pool, s)) return true;
  return !!(await one(pool, "SELECT 1 FROM credentials WHERE user_id = $1 AND project_id = $2 AND kind = 'resend_send_key'", [s.userId, s.projectId]));
}

async function send(s: Scope, conversationId: string, kind: "code" | "confirmation", business: string, to: string, subject: string, text: string) {
  if (await isDemo(pool, s)) {
    const row = await one<{ id: number }>(
      pool,
      "INSERT INTO email_sends (project_id, conversation_id, kind, status) VALUES ($1, $2, $3, 'sent') ON CONFLICT DO NOTHING RETURNING id",
      [s.projectId, conversationId, kind],
    );
    if (!row) return "duplicate" as const;
    await captureMail(s.projectId, conversationId, kind, to, subject, text);
    return "sent" as const;
  }
  const cred = await getCredential(s, "resend_send_key");
  if (!cred) throw new HttpError(409, "This business hasn't set up email yet");
  const domain = (cred.meta as { verified_domains?: string[] }).verified_domains?.[0];
  const from = `${plain(business)} <${domain ? `bookings@${domain}` : "onboarding@resend.dev"}>`;
  const row = await one<{ id: number }>(
    pool,
    "INSERT INTO email_sends (project_id, conversation_id, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id",
    [s.projectId, conversationId, kind],
  );
  if (!row) return "duplicate" as const; // a confirmation for this booking was already sent (or is sending)
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${cred.secret}`, "Content-Type": "application/json", "Idempotency-Key": `kitpier-${kind}-${row.id}` },
    body: JSON.stringify({ from, to: [to], subject, text, html: `<p>${esc(text).replace(/\n/g, "<br>")}</p>` }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  const j = r ? ((await r.json().catch(() => ({}))) as { id?: string }) : {};
  await pool.query("UPDATE email_sends SET status = $2, provider_id = $3 WHERE id = $1", [row.id, r?.ok ? "sent" : "failed", j.id ?? null]);
  if (!r?.ok) {
    // Resend test mode (no verified domain) only delivers to the account owner's address.
    throw new HttpError(422, "We couldn't email that address. You can still book without an email.");
  }
  return "sent" as const;
}

/** Send a one-time code for this booking card. Rate-limited per conversation, address, page and IP. */
export async function sendCode(s: Scope, w: { id: string; business_name: string }, conversationId: string, pending: { id: string; email: string }, ip: string) {
  await rateLimit(`code-conv:${conversationId}`, 3, 60 * 60_000);
  await rateLimit(`code-to:${recipientKey(pending.email)}`, 5, 24 * 60 * 60_000);
  await rateLimit(`code-widget:${w.id}`, 30, 60 * 60_000);
  await rateLimit(`code-ip:${ip}`, 10, 60 * 60_000);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await pool.query("UPDATE email_codes SET used_at = now() WHERE conversation_id = $1 AND used_at IS NULL", [conversationId]); // one live code
  await pool.query(
    `INSERT INTO email_codes (id, conversation_id, pending_id, email, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' minutes')::interval)`,
    [newId("code"), conversationId, pending.id, pending.email.toLowerCase(), codeHash(pending.id, pending.email, code), String(CODE_TTL_MINUTES)],
  );
  await send(s, conversationId, "code", w.business_name, pending.email,
    `Your booking code for ${plain(w.business_name)}`,
    `Your code is ${code}.\nIt expires in ${CODE_TTL_MINUTES} minutes. If you didn't ask for it, you can ignore this email.`);
}

/** Check and consume a code for exactly this card and address. Single use; 5 attempts; 10-minute expiry. */
export async function verifyCode(conversationId: string, pending: { id: string; email: string }, code: string) {
  if (!/^\d{6}$/.test(code)) return false;
  const row = await one<{ id: string; code_hash: string }>(
    pool,
    `UPDATE email_codes SET attempts = attempts + 1
     WHERE id = (SELECT id FROM email_codes WHERE conversation_id = $1 AND pending_id = $2 AND email = $3
                 AND used_at IS NULL AND expires_at > now() AND attempts < $4 ORDER BY created_at DESC LIMIT 1)
     RETURNING id, code_hash`,
    [conversationId, pending.id, pending.email.toLowerCase(), MAX_ATTEMPTS],
  );
  if (!row) return false;
  const a = Buffer.from(row.code_hash, "hex");
  const b = Buffer.from(codeHash(pending.id, pending.email, code), "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  return !!(await one(pool, "UPDATE email_codes SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING 1", [row.id]));
}

/** One confirmation per booking, to the verified address, from the fixed template. */
export async function sendConfirmation(
  s: Scope,
  w: { business_name: string; timezone: string },
  conversationId: string,
  b: { name: string; email: string; service: string; date: string; time: string },
) {
  await rateLimit(`confirm-project:${s.projectId}`, 30, 60 * 60_000);
  await rateLimit(`confirm-to:${recipientKey(b.email)}`, 3, 24 * 60 * 60_000);
  return send(s, conversationId, "confirmation", w.business_name, b.email,
    `Booking confirmed at ${plain(w.business_name)}`,
    `Hi ${plain(b.name)},\nYou're booked at ${plain(w.business_name)}: ${plain(b.service)} on ${b.date} at ${b.time} (${w.timezone}).\nSee you then!`);
}
