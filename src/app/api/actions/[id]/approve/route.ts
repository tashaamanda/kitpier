import { route } from "@/lib/http";
import { decideAction } from "@/lib/provision";
import { requireUser } from "@/lib/session";

// The approval gate (SPEC §8): session + same-origin + the action's owner. No model tool can reach this.
export const POST = route(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const user = await requireUser();
    return decideAction(user.id, (await ctx.params).id, true);
  },
  { mutating: true },
);
