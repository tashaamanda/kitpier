import { rateLimit, route } from "@/lib/http";
import { captureForUser } from "@/lib/orders";
import { requireUser } from "@/lib/session";

export const POST = route(
  async (_req: Request, ctx: { params: Promise<{ paypalOrderId: string }> }) => {
    const user = await requireUser();
    await rateLimit(`capture:${user.id}`, 20, 60 * 60_000);
    return captureForUser(user, (await ctx.params).paypalOrderId);
  },
  { mutating: true },
);
