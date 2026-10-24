import { z } from "zod";
import { body, rateLimit, route } from "@/lib/http";
import { startOrder } from "@/lib/orders";
import { PACK_IDS } from "@/lib/packs";
import { requireUser } from "@/lib/session";

// A top-up checkout carries what the owner consented to (R4-1): the monthly budget shown next to it, and the approval
// link it was paid from, if any. The server re-checks both before creating the order.
const Input = z
  .object({
    projectId: z.string().min(1).max(64),
    pack: z.enum(PACK_IDS),
    topUpId: z.string().min(1).max(64).optional(),
    budgetSeenMicros: z.number().int().nonnegative().nullable().optional(),
    approvalId: z.string().min(1).max(64).optional(),
  })
  .refine((i) => !i.topUpId || i.budgetSeenMicros !== undefined, { message: "budgetSeenMicros is required with topUpId" });

export const POST = route(
  async (req: Request) => {
    const user = await requireUser();
    await rateLimit(`order:${user.id}`, 10, 60 * 60_000);
    const input = await body(req, Input);
    const topUp = input.topUpId
      ? { id: input.topUpId, budgetSeenMicros: input.budgetSeenMicros ?? null, approvalId: input.approvalId }
      : undefined;
    return startOrder(user, input.projectId, input.pack, topUp);
  },
  { mutating: true },
);
