import { z } from "zod";
import { demoInbox, setDemo } from "@/lib/demo";
import { body, route } from "@/lib/http";
import { requireProjectOwner } from "@/lib/projects";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

async function scope(ctx: Ctx) {
  const user = await requireUser();
  const project = await requireProjectOwner(user, (await ctx.params).id);
  return { userId: user.id, projectId: project.id };
}

// Demo inbox: this project's demo bookings and captured emails.
export const GET = route(async (_req: Request, ctx: Ctx) => demoInbox(await scope(ctx)));

export const POST = route(
  async (req: Request, ctx: Ctx) => {
    const s = await scope(ctx);
    const { on } = await body(req, z.object({ on: z.boolean() }));
    await setDemo(s, on);
    return { on };
  },
  { mutating: true },
);
