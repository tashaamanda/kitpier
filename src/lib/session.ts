import { isIP } from "node:net";
import { getIronSession, type SessionOptions } from "iron-session";
import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import { appOrigin } from "./app-url";
import { one, pool } from "./db";

// v = the user's session_version when this cookie was issued; a password reset bumps it, ending older sessions.
export type SessionData = { userId?: string; v?: number };

/** session_version: the password-reset generation this session was issued under (see SessionData.v). */
export type User = { id: string; email: string; name: string; frozen: boolean; session_version?: number };

function options(): SessionOptions {
  const password = process.env.SESSION_SECRET;
  if (!password || password.length < 32) {
    // Fail closed: no secret, no sessions.
    throw new Error("SESSION_SECRET must be set (32+ chars)");
  }
  return {
    password,
    cookieName: "kitpier_session",
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
    },
  };
}

export async function getSession() {
  await connection(); // session checks expiry against the clock: always request-time (Cache Components)
  return getIronSession<SessionData>(await cookies(), options());
}

export async function currentUser(): Promise<User | null> {
  const session = await getSession();
  if (!session.userId) return null;
  return (
    (await one<User>(pool, "SELECT id, email, name, frozen, session_version FROM users WHERE id = $1 AND session_version = $2", [
      session.userId,
      session.v ?? 0,
    ])) ?? null
  );
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Not signed in");
  return user;
}

/** Reject cross-site state-changing requests (defense in depth on top of SameSite=lax). */
export async function assertSameOrigin() {
  const origin = (await headers()).get("origin");
  // Compare against the configured public origin, not request headers a proxy could rewrite.
  if (!origin || origin !== appOrigin()) {
    throw new HttpError(403, "Bad origin");
  }
}

// Which header holds the real client address depends on the edge in front of the app, so it's configured, not guessed:
//   CLIENT_IP_SOURCE = cf-connecting-ip | x-real-ip | xff-last | xff-first
// Only pick a header the edge overwrites; a caller can put anything in a header the edge merely passes along. Verify on
// the deployment with a forged header before relying on it (docs/agent-review-brief.md). Production must set it
// explicitly; an unknown value fails closed instead of falling back. Anything that isn't an IP address (net.isIP) counts
// as "unknown", so junk can't mint fresh rate-limit buckets.
export const IP_SOURCES = ["cf-connecting-ip", "x-real-ip", "xff-last", "xff-first"] as const;
type IpSource = (typeof IP_SOURCES)[number];

export function ipSource(env: Record<string, string | undefined> = process.env): IpSource {
  const v = env.CLIENT_IP_SOURCE;
  if (v === undefined || v === "") {
    if (env.NODE_ENV === "production") throw new Error("CLIENT_IP_SOURCE must be set in production");
    return "xff-first"; // local dev and tests: no edge in front
  }
  if (!(IP_SOURCES as readonly string[]).includes(v)) throw new Error(`CLIENT_IP_SOURCE "${v}" is not one of ${IP_SOURCES.join(", ")}`);
  return v as IpSource;
}

export function pickClientIp(h: Headers, source: IpSource = ipSource()) {
  const xff = (h.get("x-forwarded-for") ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  const raw =
    source === "cf-connecting-ip" ? h.get("cf-connecting-ip")
    : source === "x-real-ip" ? h.get("x-real-ip")
    : source === "xff-last" ? xff.at(-1)
    : xff[0];
  if (!raw) return "local";
  const ip = raw.trim();
  return isIP(ip) ? ip : "unknown";
}

export async function clientIp() {
  return pickClientIp(await headers());
}
