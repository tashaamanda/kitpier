import { z } from "zod";
import { decideLink } from "@/lib/agents";
import { body, rateLimit, route } from "@/lib/http";
import { clientIp, requireUser } from "@/lib/session";

const Input = z.union([
  z.object({ allow: z.literal(false) }),
  z.object({ allow: z.literal(true), projectId: z.string().min(1).max(64) }),
  z.object({ allow: z.literal(true), newProjectName: z.string().min(1).max(200) }),
]);

// Step 2: the signed-in owner allows (for one project) or denies. Browser session + same origin only.
export const POST = route(
  async (req: Request, ctx: { params: Promise<{ code: string }> }) => {
    const user = await requireUser();
    await rateLimit(`agent-link:${user.id}`, 20, 60 * 60_000);
    await rateLimit(`agent-link-ip:${await clientIp()}`, 20, 60 * 60_000);
    return decideLink(user, (await ctx.params).code, await body(req, Input));
  },
  { mutating: true },
);
