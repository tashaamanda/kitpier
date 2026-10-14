import { body, route } from "@/lib/http";
import { WidgetSpec, proposeWidget, widgetState } from "@/lib/booking";
import { requireProjectOwner } from "@/lib/projects";
import { HttpError, requireUser } from "@/lib/session";
import { isValidTimeZone } from "@/lib/slots";

type Ctx = { params: Promise<{ id: string }> };

async function scope(ctx: Ctx) {
  const user = await requireUser();
  const project = await requireProjectOwner(user, (await ctx.params).id);
  return { userId: user.id, projectId: project.id };
}

export const GET = route(async (_req: Request, ctx: Ctx) => widgetState(await scope(ctx)));

// Propose a booking page. It goes live only after the owner approves it.
export const POST = route(
  async (req: Request, ctx: Ctx) => {
    const s = await scope(ctx);
    const spec = await body(req, WidgetSpec);
    if (!isValidTimeZone(spec.timezone)) throw new HttpError(400, "Unknown timezone");
    await proposeWidget(s, spec);
    return widgetState(s);
  },
  { mutating: true },
);
