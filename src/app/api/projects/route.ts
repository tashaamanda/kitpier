import { z } from "zod";
import { body, rateLimit, route } from "@/lib/http";
import { createProject, listProjects } from "@/lib/projects";
import { requireUser } from "@/lib/session";

const Input = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
});

export const GET = route(async () => ({ projects: await listProjects(await requireUser()) }));

export const POST = route(
  async (req: Request) => {
    const user = await requireUser();
    await rateLimit(`project:${user.id}`, 20, 60 * 60_000);
    return { id: await createProject(user, await body(req, Input)) };
  },
  { mutating: true },
);
