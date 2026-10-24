// Applies migrations/*.sql in order, once each, inside a transaction per file.
// Usage: node --env-file=.env.local scripts/migrate.mjs [DATABASE_URL override via MIGRATE_URL]
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const url = process.env.MIGRATE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");
const dir = fileURLToPath(new URL("../migrations/", import.meta.url));
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const done = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    await client.query("BEGIN");
    try {
      // DDL waits for table locks. Fail fast instead of queueing behind a long transaction (and blocking every query
      // queued behind us); rerun the script to retry. Override with MIGRATE_LOCK_TIMEOUT (e.g. "15s").
      await client.query(`SET LOCAL lock_timeout = '${/^\d+(ms|s)$/.test(process.env.MIGRATE_LOCK_TIMEOUT ?? "") ? process.env.MIGRATE_LOCK_TIMEOUT : "5s"}'`);
      await client.query(readFileSync(dir + file, "utf8"));
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`applied ${file}`);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  }
} finally {
  await client.end();
}
