import { many, one, pool } from "@/lib/db";
import { demoConfig } from "@/lib/demo";
import { isDemoAccount } from "@/lib/demo-account";
import { route } from "@/lib/http";
import { requireProjectOwner } from "@/lib/projects";
import { requireUser } from "@/lib/session";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const project = await requireProjectOwner(user, (await ctx.params).id);
  const ledger = await many(
    pool,
    "SELECT source, kind, amount_micros, created_at FROM ledger_entries WHERE user_id = $1 AND project_id = $2 ORDER BY id DESC LIMIT 50",
    [user.id, project.id],
  );
  const orders = await many(
    pool,
    "SELECT id, pack_id, amount_micros, status, created_at FROM orders WHERE user_id = $1 AND project_id = $2 ORDER BY created_at DESC LIMIT 20",
    [user.id, project.id],
  );
  // Status only: kind, display meta and dates. Secrets never leave the server.
  const connections = await many(
    pool,
    "SELECT kind, meta, created_at FROM credentials WHERE user_id = $1 AND project_id = $2 AND kind IN ('supabase_oauth', 'resend_send_key')",
    [user.id, project.id],
  );
  const demo = !!project.demo_connection;
  const databaseReady = demo || !!(await one(
    pool,
    "SELECT 1 FROM provision_jobs WHERE user_id = $1 AND project_id = $2 AND state = 'schema_ready'",
    [user.id, project.id],
  ));
  return { project, ledger, orders, connections, databaseReady, demo, demoAvailable: !!demoConfig(), demoAccount: isDemoAccount(user.email) };
});
