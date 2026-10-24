import { createKey, liveKey, revokeKeys } from "@/lib/apikeys";
import { noStore, rateLimit, route } from "@/lib/http";
import { requireProjectOwner } from "@/lib/projects";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

async function scope(ctx: Ctx) {
  const user = await requireUser();
  const project = await requireProjectOwner(user, (await ctx.params).id);
  return { userId: user.id, projectId: project.id };
}

export const GET = route(async (_req: Request, ctx: Ctx) => ({ key: (await liveKey(await scope(ctx))) ?? null }));

// New key, shown once in this response. The previous key stops working.
export const POST = route(
  async (_req: Request, ctx: Ctx) => {
    const s = await scope(ctx);
    await rateLimit(`key-issue:${s.userId}`, 10, 24 * 60 * 60_000);
    return noStore(await createKey(s));
  },
  { mutating: true },
);

export const DELETE = route(
  async (_req: Request, ctx: Ctx) => {
    await revokeKeys(await scope(ctx));
    return { ok: true };
  },
  { mutating: true },
);
