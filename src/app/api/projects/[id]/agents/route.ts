import { z } from "zod";
import { listAgentTokens, revokeAgentToken } from "@/lib/agents";
import { body, route } from "@/lib/http";
import { requireProjectOwner } from "@/lib/projects";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

async function scope(ctx: Ctx) {
  const user = await requireUser();
  const project = await requireProjectOwner(user, (await ctx.params).id);
  return { userId: user.id, projectId: project.id };
}

export const GET = route(async (_req: Request, ctx: Ctx) => {
  const s = await scope(ctx);
  return { agents: await listAgentTokens(s.userId, s.projectId) };
});

export const DELETE = route(
  async (req: Request, ctx: Ctx) => {
    const s = await scope(ctx);
    const { tokenId } = await body(req, z.object({ tokenId: z.string().min(1).max(64) }));
    await revokeAgentToken(s.userId, s.projectId, tokenId);
    return { ok: true };
  },
  { mutating: true },
);
