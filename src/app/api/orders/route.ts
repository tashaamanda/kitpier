import { z } from "zod";
import { body, rateLimit, route } from "@/lib/http";
import { startOrder } from "@/lib/orders";
import { PACK_IDS } from "@/lib/packs";
import { requireUser } from "@/lib/session";

const Input = z.object({ projectId: z.string().min(1).max(64), pack: z.enum(PACK_IDS) });

export const POST = route(
  async (req: Request) => {
    const user = await requireUser();
    await rateLimit(`order:${user.id}`, 10, 60 * 60_000);
    const input = await body(req, Input);
    return startOrder(user, input.projectId, input.pack);
  },
  { mutating: true },
);
