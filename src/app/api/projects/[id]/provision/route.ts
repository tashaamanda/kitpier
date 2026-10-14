import { rateLimit, route } from "@/lib/http";
import { requireProjectOwner } from "@/lib/projects";
import { advanceProvision, proposeProvision, provisionState } from "@/lib/provision";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

async function scope(ctx: Ctx) {
  const user = await requireUser();
  const project = await requireProjectOwner(user, (await ctx.params).id);
  return { userId: user.id, projectId: project.id };
}

// Poll: advances an already-approved job by at most one step, then returns the state.
export const GET = route(async (_req: Request, ctx: Ctx) => {
  const s = await scope(ctx);
  await advanceProvision(s);
  return provisionState(s);
});

// Propose a setup. Creates a pending_action only; nothing happens in Supabase until it is approved.
export const POST = route(
  async (_req: Request, ctx: Ctx) => {
    const s = await scope(ctx);
    await rateLimit(`provision:${s.userId}`, 10, 60 * 60_000);
    await proposeProvision(s);
    return provisionState(s);
  },
  { mutating: true },
);
