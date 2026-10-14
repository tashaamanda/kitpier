import { z } from "zod";
import { confirmBooking } from "@/lib/booking";
import { body, route } from "@/lib/http";
import { clientIp } from "@/lib/session";

const Input = z.object({ conversationId: z.string().min(1).max(64), pendingId: z.string().min(1).max(64), requestId: z.string().min(8).max(64) });

// The customer's Confirm press: the only way a booking is written. No model involved.
export const POST = route(
  async (req: Request, ctx: { params: Promise<{ widgetId: string }> }) => {
    const i = await body(req, Input);
    return confirmBooking((await ctx.params).widgetId, i.conversationId, i.pendingId, i.requestId, await clientIp());
  },
  { mutating: true },
);
