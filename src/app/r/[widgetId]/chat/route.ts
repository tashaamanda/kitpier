import { z } from "zod";
import { bookingTurn } from "@/lib/booking";
import { body, route } from "@/lib/http";
import { clientIp } from "@/lib/session";

const Input = z.object({ conversationId: z.string().max(64).nullable(), message: z.string().trim().min(1).max(500) });

// Public, same-origin only (the hosted page). The widget id maps to its owner server-side; no keys in the browser.
export const POST = route(
  async (req: Request, ctx: { params: Promise<{ widgetId: string }> }) => {
    const { conversationId, message } = await body(req, Input);
    return bookingTurn((await ctx.params).widgetId, conversationId, message, await clientIp());
  },
  { mutating: true },
);
