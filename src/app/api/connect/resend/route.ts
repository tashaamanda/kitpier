import { z } from "zod";
import { deleteCredential } from "@/lib/credentials";
import { body, rateLimit, route } from "@/lib/http";
import { requireProjectOwner } from "@/lib/projects";
import { connectResend } from "@/lib/resend";
import { requireUser } from "@/lib/session";

const Project = z.object({ projectId: z.string().min(1).max(64) });
const Connect = Project.extend({ apiKey: z.string().trim().regex(/^re_[A-Za-z0-9_-]{10,200}$/, "That doesn't look like a Resend key (it starts with re_)") });

// Paste a full-access key once; Kitpier stores only a send-only key it mints with it.
export const POST = route(
  async (req: Request) => {
    const user = await requireUser();
    await rateLimit(`connect:${user.id}`, 20, 60 * 60_000);
    const input = await body(req, Connect);
    const project = await requireProjectOwner(user, input.projectId);
    return connectResend({ userId: user.id, projectId: project.id }, input.apiKey);
  },
  { mutating: true },
);

// Forget the send-only key. (Deleting it in Resend needs the full key, which Kitpier never kept.)
export const DELETE = route(
  async (req: Request) => {
    const user = await requireUser();
    const project = await requireProjectOwner(user, (await body(req, Project)).projectId);
    await deleteCredential({ userId: user.id, projectId: project.id }, "resend_send_key");
    return { ok: true };
  },
  { mutating: true },
);
