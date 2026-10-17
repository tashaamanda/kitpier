import { z } from "zod";
import { confirmBooking } from "@/lib/booking";
import { body, route } from "@/lib/http";
import { CustomerIp, caller } from "../api";

const Input = z.object({
  conversationId: z.string().min(1).max(64),
  pendingId: z.string().min(1).max(64),
  requestId: z.string().min(8).max(64),
  code: z.string().max(10).optional(),
  customerIp: CustomerIp,
});

// The customer pressed Confirm on the booking card. The only way a booking is written; no model involved.
export const POST = route(async (req: Request) => {
  const c = await caller(req);
  const i = await body(req, Input);
  return confirmBooking(c.widgetId, i.conversationId, i.pendingId, i.requestId, c.ip(i.customerIp), i.code);
});
