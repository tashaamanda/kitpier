import { randomBytes } from "node:crypto";
import pg from "pg";

// int8 (bigint) columns hold micro-USD; parse to number (safe below 2^53 ≈ $9B).
pg.types.setTypeParser(20, (v) => Number(v));

const g = globalThis as unknown as { __kitpierPool?: pg.Pool };

export const pool =
  g.__kitpierPool ??
  new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    ssl: process.env.DATABASE_SSL === "require" ? { rejectUnauthorized: true } : undefined,
  });
if (process.env.NODE_ENV !== "production") g.__kitpierPool = pool;

export type Db = pg.Pool | pg.PoolClient;

export async function one<T>(q: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await q.query(sql, params)).rows[0] as T | undefined;
}

export async function many<T>(q: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await q.query(sql, params)).rows as T[];
}

/** Runs fn in a transaction; rolls back on throw. Keep external calls (PayPal, Claude) OUT of fn. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export function newId(prefix: string) {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}
