import { z } from "zod";
import { bookingTurn } from "@/lib/booking";
import { body, route } from "@/lib/http";
import { CustomerIp, caller } from "../api";

const Input = z.object({
  conversationId: z.string().max(64).nullable().optional(),
  requestId: z.string().min(8).max(64), // a retry with the same id returns the first result
  message: z.string().trim().min(1).max(500),
  customerIp: CustomerIp,
});

// One customer message. Same rules as the hosted page: the reply may carry a booking card (pending) for the customer to confirm.
export const POST = route(async (req: Request) => {
  const c = await caller(req);
  const i = await body(req, Input);
  return bookingTurn(c.widgetId, i.conversationId ?? null, i.requestId, i.message, c.ip(i.customerIp));
});
