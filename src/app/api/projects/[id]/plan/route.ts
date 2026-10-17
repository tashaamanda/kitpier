import { z } from "zod";
import { pool } from "@/lib/db";
import { body, rateLimit, route } from "@/lib/http";
import { listPlanMessages, runPlanner } from "@/lib/planner";
import { requireProjectOwner } from "@/lib/projects";
import { requireUser } from "@/lib/session";
import { listProposals, projectStatus, type Scope } from "@/lib/stack";
import { listTopUps } from "@/lib/topup";

type Ctx = { params: Promise<{ id: string }> };
const Input = z.object({ message: z.string().trim().min(1).max(2000) });

async function scope(ctx: Ctx): Promise<Scope> {
  const user = await requireUser();
  const project = await requireProjectOwner(user, (await ctx.params).id);
  return { userId: user.id, projectId: project.id };
}

async function view(s: Scope) {
  return {
    messages: await listPlanMessages(s),
    proposals: await listProposals(pool, s),
    topUps: await listTopUps(pool, s),
    status: await projectStatus(pool, s),
  };
}

export const GET = route(async (_req: Request, ctx: Ctx) => view(await scope(ctx)));

export const POST = route(
  async (req: Request, ctx: Ctx) => {
    const s = await scope(ctx);
    const { message } = await body(req, Input);
    await rateLimit(`plan:${s.userId}`, 20, 24 * 60 * 60_000); // free planner quota (SPEC §5)
    await runPlanner(s, message);
    return view(s);
  },
  { mutating: true },
);
