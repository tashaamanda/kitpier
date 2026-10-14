import { z } from "zod";
import { requestBookingCode } from "@/lib/booking";
import { body, route } from "@/lib/http";
import { clientIp } from "@/lib/session";

const Input = z.object({ conversationId: z.string().min(1).max(64), pendingId: z.string().min(1).max(64) });

// Send a one-time code to the address on the current booking card (rate-limited; no booking happens here).
export const POST = route(
  async (req: Request, ctx: { params: Promise<{ widgetId: string }> }) => {
    const i = await body(req, Input);
    return requestBookingCode((await ctx.params).widgetId, i.conversationId, i.pendingId, await clientIp());
  },
  { mutating: true },
);
