import { rateLimit, route } from "@/lib/http";
import { settleClosedCheckout } from "@/lib/orders";
import { requireUser } from "@/lib/session";

// The PayPal window closed without onApprove. Shares the capture rate limit: it can end in a capture.
export const POST = route(
  async (_req: Request, ctx: { params: Promise<{ paypalOrderId: string }> }) => {
    const user = await requireUser();
    await rateLimit(`capture:${user.id}`, 20, 60 * 60_000);
    return settleClosedCheckout(user, (await ctx.params).paypalOrderId);
  },
  { mutating: true },
);
