import { z } from "zod";
import { demoInbox, setDemo } from "@/lib/demo";
import { isDemoAccount } from "@/lib/demo-account";
import { body, route } from "@/lib/http";
import { requireProjectOwner } from "@/lib/projects";
import { HttpError, requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

async function scope(ctx: Ctx) {
  const user = await requireUser();
  const project = await requireProjectOwner(user, (await ctx.params).id);
  return { userId: user.id, projectId: project.id, email: user.email };
}

// Demo inbox: this project's demo bookings and captured emails.
export const GET = route(async (_req: Request, ctx: Ctx) => {
  const { userId, projectId } = await scope(ctx);
  return demoInbox({ userId, projectId });
});

export const POST = route(
  async (req: Request, ctx: Ctx) => {
    const { userId, projectId, email } = await scope(ctx);
    const { on } = await body(req, z.object({ on: z.boolean() }));
    if (!on && isDemoAccount(email)) throw new HttpError(403, "Demo projects stay on the demo connection.");
    await setDemo({ userId, projectId }, on);
    return { on };
  },
  { mutating: true },
);
