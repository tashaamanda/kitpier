import bcrypt from "bcryptjs";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { DEMO_DAYS, DEMO_DOMAIN, LIVE_ACCOUNT } from "./account-expiry";
import { appOrigin } from "./app-url";
import { newId, one, pool } from "./db";
import { proposeWidget } from "./booking";
import { demoConfig, setDemo } from "./demo";
import { rateLimit } from "./http";
import { createProject } from "./projects";
import { decideAction } from "./provision";
import { HttpError, type User } from "./session";
import { approveStack, proposeStack } from "./stack";

// "Try the demo" on /judges: one click gives this browser its own throwaway account with Sam's Barbershop already
// planned and set up on the demo connection. Judges never share a login, an inbox, a project or a limit.
// The account has no usable password. It lives in this browser's session cookie (7 days); a private resume link brings it
// back after that, or on another device, until the account expires (DEMO_DAYS). Setup is deterministic (no model call),
// so starting a demo spends nothing.

export { DEMO_DAYS, DEMO_DOMAIN };
// perDay bounds total sign-ups if many addresses are used; it's generous because a demo costs only a few rows (model use
// stays under the platform's daily cap). perIpPerDay keeps one address from using up much of it.
export const DEMO_LIMITS = { perIpPerHour: 5, perIpPerDay: 20, perDay: 1000 };

export const isDemoAccount = (email: string) => email.endsWith(`@${DEMO_DOMAIN}`);

/** Demo accounts stay on the demo connection: no one's real Supabase or Resend account is ever attached to one. */
export function refuseDemoAccount(user: { email: string }) {
  if (isDemoAccount(user.email))
    throw new HttpError(403, "Demo projects use the demo connection. Create your own account to connect Supabase or Resend.");
}

/** Someone signed in to their own account keeps it: the demo would silently sign them out of it. */
export function refuseOwnAccount(user: User | null) {
  if (user && !isDemoAccount(user.email))
    throw new HttpError(
      409,
      "You're signed in to your own account. Open your projects there, or sign out first to start a separate demo.",
      "signed_in",
    );
}

const PROJECT = {
  name: "Sam's Barbershop",
  description: "A booking page for my barbershop that emails customers a confirmation. Budget $30 a month.",
};
const STACK = [
  { slug: "booking-api", reason: "Takes bookings in a chat and prepares each appointment." },
  { slug: "supabase", reason: "Stores the bookings." },
  { slug: "resend", reason: "Sends the confirmation emails." },
];
const WIDGET = { business_name: "Sam's Barbershop", services: ["Haircut", "Beard trim"], timezone: "America/Los_Angeles" };

async function limit(key: string, max: number, windowMs: number, message: string) {
  try {
    await rateLimit(key, max, windowMs);
  } catch (e) {
    throw e instanceof HttpError && e.status === 429 ? new HttpError(429, message, "demo_limit") : e;
  }
}

const AGAIN = "Many demos were started from this network recently. Open yours with its private link, or try again later.";

/** Creates the account and its ready project. The caller signs the browser in. */
export async function startDemo(ip: string) {
  if (!demoConfig()) throw new HttpError(503, "The demo isn't available right now. Create your own account instead.");
  await limit(`demo:${ip}`, DEMO_LIMITS.perIpPerHour, 60 * 60_000, AGAIN);
  await limit(`demo-day:${ip}`, DEMO_LIMITS.perIpPerDay, 24 * 60 * 60_000, AGAIN);
  await limit("demo:all", DEMO_LIMITS.perDay, 24 * 60 * 60_000, "No more demos can start today. Create your own account instead, it takes a minute.");

  const user = { id: newId("usr"), email: `judge-${randomBytes(8).toString("hex")}@${DEMO_DOMAIN}`, name: "Demo judge", frozen: false };
  await pool.query("INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)", [
    user.id,
    user.email,
    user.name,
    await bcrypt.hash(randomBytes(32).toString("base64"), 10),
  ]);
  // Each step commits on its own, so a failure part-way removes the account (and, by cascade, all it made): no
  // half-built demo is left that nobody can open. Setup creates no orders or ledger rows, so nothing blocks the delete.
  try {
    const s = { userId: user.id, projectId: await createProject(user, PROJECT) };
    await setDemo(s, true);
    const plan = await proposeStack(s, { items: STACK, monthly_budget_usd: 30 });
    await approveStack(s, plan.id);
    const { widget } = await decideAction(user.id, await proposeWidget(s, WIDGET), true);
    return { userId: user.id, projectId: s.projectId, widgetId: widget as string };
  } catch (e) {
    await pool.query("DELETE FROM users WHERE id = $1", [user.id]).catch(() => {});
    throw e;
  }
}

// The resume link signs in like a password, so it is limited three ways:
// - it expires with the account, DEMO_DAYS after the demo started (account-expiry.ts; the daily purge then deletes it:
//   demo-purge.ts);
// - its HMAC covers the account's session_version, so "Make a new link" (rotateDemoLink) kills every older link and
//   every other signed-in browser of that demo;
// - it lives in the URL fragment, so it never appears in a request URL, an access log or a Referer header. The browser
//   does send it in the body of POST /api/judges/resume, which the app doesn't log.
// It is derived, not stored, so the same link can be shown again until it's rotated.
type DemoRow = { id: string; email: string; session_version: number; created_at: Date };

function resumeMac(userId: string, version: number) {
  const key = process.env.CREDENTIALS_MASTER_KEY;
  if (!key) throw new Error("CREDENTIALS_MASTER_KEY must be set");
  return createHmac("sha256", key).update(`demo-resume|${userId}|${version}`).digest("base64url");
}

const expiresAt = (u: DemoRow) => new Date(u.created_at.getTime() + DEMO_DAYS * 24 * 60 * 60_000);

async function demoRow(userId: string) {
  const u = await one<DemoRow>(pool, `SELECT u.id, u.email, u.session_version, u.created_at FROM users u WHERE u.id = $1 AND ${LIVE_ACCOUNT}`, [userId]);
  return u && isDemoAccount(u.email) ? u : null;
}

/** The signed-in demo account's current link and when it (and the account) expires. */
export async function demoResumeLink(userId: string) {
  const u = await demoRow(userId);
  if (!u) throw new HttpError(404, "Not found");
  return { resumeUrl: `${appOrigin()}/judges/resume#${u.id}.${resumeMac(u.id, u.session_version)}`, expiresAt: expiresAt(u) };
}

/** Revokes every earlier link and every other signed-in browser of this demo. Returns the new session_version. */
export async function rotateDemoLink(userId: string) {
  if (!(await demoRow(userId))) throw new HttpError(404, "Not found");
  const r = await one<{ session_version: number }>(
    pool,
    "UPDATE users SET session_version = session_version + 1 WHERE id = $1 RETURNING session_version",
    [userId],
  );
  return r!.session_version;
}

/** The demo account and project a resume key opens. Anything else (a real account, expired, revoked) is a 404. */
export async function resumeDemo(key: string) {
  const invalid = new HttpError(404, "This demo link isn't valid any more. Start a new demo instead.");
  const [userId, mac] = key.split(".");
  const u = userId ? await demoRow(userId) : null;
  if (!u) throw invalid;
  const want = Buffer.from(resumeMac(u.id, u.session_version));
  const got = Buffer.from(mac ?? "");
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw invalid;
  const project = await one<{ id: string }>(pool, "SELECT id FROM projects WHERE user_id = $1 ORDER BY created_at LIMIT 1", [u.id]);
  if (!project) throw invalid;
  return { userId: u.id, projectId: project.id, version: u.session_version };
}
