import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { pool } from "./db";
import { HttpError, assertSameOrigin } from "./session";

/** Wraps a route handler: maps known errors to JSON responses, hides internals. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<unknown>, opts: { mutating?: boolean } = {}) {
  return async (...args: A) => {
    try {
      if (opts.mutating) await assertSameOrigin();
      const out = await fn(...args);
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
      if (e instanceof ZodError)
        return NextResponse.json({ error: "Invalid input", issues: e.issues }, { status: 400 });
      console.error(e);
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
  };
}

export async function body<T>(req: Request, schema: ZodType<T>): Promise<T> {
  const json = await req.json().catch(() => {
    throw new HttpError(400, "Expected JSON body");
  });
  return schema.parse(json);
}

/** Fixed-window limiter in Postgres, so limits hold across instances and restarts (SPEC §11). */
export async function rateLimit(key: string, max: number, windowMs: number) {
  const { rows } = await pool.query<{ count: number }>(
    `INSERT INTO rate_limits (key, count, reset_at) VALUES ($1, 1, now() + ($2 || ' milliseconds')::interval)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.reset_at < now() THEN 1 ELSE rate_limits.count + 1 END,
       reset_at = CASE WHEN rate_limits.reset_at < now() THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END
     RETURNING count`,
    [key, String(windowMs)],
  );
  if (rows[0].count > max) throw new HttpError(429, "Too many requests, slow down a little");
}
