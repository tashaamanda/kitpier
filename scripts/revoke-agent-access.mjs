// Containment for agent access: revokes every pending/approved connection, live agent token and open key grant.
// Usage: MIGRATE_URL=<database url> node scripts/revoke-agent-access.mjs   (SQL and reasoning in revoke-agent-access.sql)
import { readFileSync } from "node:fs";
import pg from "pg";

const url = process.env.MIGRATE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("MIGRATE_URL or DATABASE_URL must be set");
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(readFileSync(new URL("./revoke-agent-access.sql", import.meta.url), "utf8"));
  const left = await client.query(
    "SELECT (SELECT count(*) FROM agent_tokens WHERE revoked_at IS NULL) AS tokens, (SELECT count(*) FROM agent_links WHERE state IN ('pending','approved')) AS links",
  );
  console.log("agent access revoked; still live:", left.rows[0]);
} finally {
  await client.end();
}
