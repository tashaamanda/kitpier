import { z } from "zod";
import { body, rateLimit, route } from "@/lib/http";
import { requireProjectOwner } from "@/lib/projects";
import { requireUser } from "@/lib/session";
import { disconnect, startConnect } from "@/lib/supabase";

const Input = z.object({ projectId: z.string().min(1).max(64) });

// Start OAuth: returns Supabase's consent URL. Connecting creates nothing in Supabase.
export const POST = route(
  async (req: Request) => {
    const user = await requireUser();
    await rateLimit(`connect:${user.id}`, 20, 60 * 60_000);
    const project = await requireProjectOwner(user, (await body(req, Input)).projectId);
    return { url: await startConnect({ userId: user.id, projectId: project.id }) };
  },
  { mutating: true },
);

// Disconnect: revoke at Supabase and delete the stored token.
export const DELETE = route(
  async (req: Request) => {
    const user = await requireUser();
    const project = await requireProjectOwner(user, (await body(req, Input)).projectId);
    await disconnect({ userId: user.id, projectId: project.id });
    return { ok: true };
  },
  { mutating: true },
);
