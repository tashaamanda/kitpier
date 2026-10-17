import { z } from "zod";
import { requestBookingCode } from "@/lib/booking";
import { body, route } from "@/lib/http";
import { CustomerIp, caller } from "../api";

const Input = z.object({ conversationId: z.string().min(1).max(64), pendingId: z.string().min(1).max(64), customerIp: CustomerIp });

// Optional: email a one-time code to the address on the current booking card, for a confirmation email.
export const POST = route(async (req: Request) => {
  const c = await caller(req);
  const i = await body(req, Input);
  return requestBookingCode(c.widgetId, i.conversationId, i.pendingId, c.ip(i.customerIp));
});
