import { getIronSession, type SessionOptions } from "iron-session";
import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import { one, pool } from "./db";

// v = the user's session_version when this cookie was issued; a password reset bumps it, ending older sessions.
export type SessionData = { userId?: string; v?: number };

export type User = { id: string; email: string; name: string; frozen: boolean };

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
    (await one<User>(pool, "SELECT id, email, name, frozen FROM users WHERE id = $1 AND session_version = $2", [
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
  const appUrl = process.env.APP_URL;
  if (!appUrl) throw new Error("APP_URL must be set");
  const origin = (await headers()).get("origin");
  // Compare against the configured public origin, not request headers a proxy could rewrite.
  if (!origin || origin !== new URL(appUrl).origin) {
    throw new HttpError(403, "Bad origin");
  }
}

export async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}
