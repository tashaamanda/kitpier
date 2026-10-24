import { approvalState } from "@/lib/agent-actions";
import { route } from "@/lib/http";
import { agentScope } from "../../caller";

// Poll one approval link: each item is pending, approved, rejected or stale (changed → make a new link).
export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  approvalState(await agentScope(req), (await ctx.params).id),
);
