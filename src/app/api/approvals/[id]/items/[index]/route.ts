import { z } from "zod";
import { decideLinkItem } from "@/lib/approvals";
import { body, route } from "@/lib/http";
import { HttpError, requireUser } from "@/lib/session";

// The approval gate for agent links: browser session + same origin + owner, and the item must still match what the
// link showed. No agent token reaches this.
export const POST = route(
  async (req: Request, ctx: { params: Promise<{ id: string; index: string }> }) => {
    const user = await requireUser();
    const { id, index } = await ctx.params;
    const { approve } = await body(req, z.object({ approve: z.boolean() }));
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i > 20) throw new HttpError(400, "Nothing to approve here");
    return decideLinkItem(user.id, id, i, approve);
  },
  { mutating: true },
);
