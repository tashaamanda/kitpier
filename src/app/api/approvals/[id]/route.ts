import { approvalView } from "@/lib/approvals";
import { many, pool } from "@/lib/db";
import { demoConfig } from "@/lib/demo";
import { isDemoAccount } from "@/lib/demo-account";
import { route } from "@/lib/http";
import { requireUser } from "@/lib/session";
import { projectStatus } from "@/lib/stack";

// The person's view of an approval link: owner session only (others get 404).
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const view = await approvalView(user.id, (await ctx.params).id);
  const s = { userId: user.id, projectId: view.project_id };
  const connections = await many(
    pool,
    "SELECT kind, meta, created_at FROM credentials WHERE user_id = $1 AND project_id = $2 AND kind IN ('supabase_oauth', 'resend_send_key')",
    [user.id, view.project_id],
  );
  const stack = await pool.query(
    "SELECT items FROM stack_proposals WHERE user_id = $1 AND project_id = $2 AND status = 'approved' ORDER BY decided_at DESC LIMIT 1",
    [user.id, view.project_id],
  );
  return {
    view,
    status: await projectStatus(pool, s),
    connections,
    approvedStack: (stack.rows[0]?.items as { slug: string }[] | undefined)?.map((i) => i.slug) ?? [],
    demoAvailable: !!demoConfig(),
    demoAccount: isDemoAccount(user.email),
  };
});
