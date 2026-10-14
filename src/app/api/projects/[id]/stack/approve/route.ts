import { z } from "zod";
import { body, route } from "@/lib/http";
import { requireProjectOwner } from "@/lib/projects";
import { requireUser } from "@/lib/session";
import { approveStack } from "@/lib/stack";

const Input = z.object({ proposalId: z.string().min(1).max(64) });

// Only a signed-in owner, same-origin, can approve. The planner has no tool that reaches this.
export const POST = route(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const user = await requireUser();
    const project = await requireProjectOwner(user, (await ctx.params).id);
    const { proposalId } = await body(req, Input);
    return approveStack({ userId: user.id, projectId: project.id }, proposalId);
  },
  { mutating: true },
);
