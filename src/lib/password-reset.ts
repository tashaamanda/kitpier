import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { appOrigin } from "./app-url";
import { one, pool, tx } from "./db";
import { rateLimit } from "./http";
import { sendPlatformMail } from "./mail";
import { HttpError } from "./session";

export const RESET_TTL_MINUTES = 30;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Starts a reset. Callers answer the same way whether or not the account exists: the lookup and the email run in
 * `delivery`, after the response, so neither the reply nor its timing reveals which addresses have accounts.
 */
export async function requestPasswordReset(email: string, ip: string) {
  await rateLimit(`reset-ip:${ip}`, 10, 60 * 60_000);
  await rateLimit(`reset-email:${email}`, 3, 60 * 60_000);
  const delivery = (async () => {
    const user = await one<{ id: string }>(pool, "SELECT id FROM users WHERE email = $1", [email]);
    if (!user) return;
    const origin = appOrigin();
    const token = randomBytes(32).toString("base64url");
    await tx(async (c) => {
      await c.query("DELETE FROM password_resets WHERE user_id = $1", [user.id]);
      await c.query(
        `INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '${RESET_TTL_MINUTES} minutes')`,
        [hashToken(token), user.id],
      );
    });
    // Link from the configured origin, never the request's Host. Token in the fragment: browsers don't send it to servers.
    const link = `${origin}/reset#token=${token}`;
    await sendPlatformMail(
      email,
      "Reset your Kitpier password",
      `Someone asked to reset the password for your Kitpier account.\n\nChoose a new password here (the link works once, for ${RESET_TTL_MINUTES} minutes):\n${link}\n\nIf it wasn't you, ignore this email. Your password stays the same.`,
    );
  })().catch((e) => console.error("Password reset delivery failed", e));
  return { delivery };
}

/** Sets a new password from a reset link. Signs out every other session. Returns who to sign in on this device. */
export async function resetPassword(token: string, password: string, ip: string) {
  await rateLimit(`reset-use:${ip}`, 20, 60 * 60_000);
  const passwordHash = await bcrypt.hash(password, 12); // before the transaction: bcrypt is slow
  const user = await tx(async (c) => {
    const row = await one<{ user_id: string }>(
      c,
      "SELECT user_id FROM password_resets WHERE token_hash = $1 AND expires_at > now() FOR UPDATE",
      [hashToken(token)],
    );
    if (!row) return null;
    const u = await one<{ id: string; session_version: number }>(
      c,
      "UPDATE users SET password_hash = $2, session_version = session_version + 1 WHERE id = $1 RETURNING id, session_version",
      [row.user_id, passwordHash],
    );
    await c.query("DELETE FROM password_resets WHERE user_id = $1", [row.user_id]);
    // A reset also ends agent access granted before it: live tokens, connections allowed but not yet collected, and open
    // key requests. The users row above is locked first, the same order pollLink takes, so a redemption can't slip past.
    await c.query("UPDATE agent_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [row.user_id]);
    await c.query("UPDATE agent_links SET state = 'revoked' WHERE user_id = $1 AND state IN ('pending','approved')", [row.user_id]);
    await c.query("UPDATE key_grants SET status = 'superseded', decided_at = now() WHERE user_id = $1 AND status IN ('pending','approved')", [row.user_id]);
    return u ?? null;
  });
  if (!user) throw new HttpError(400, "This reset link is invalid or has expired. Ask for a new one.");
  return { userId: user.id, sessionVersion: user.session_version };
}
