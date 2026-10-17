import { many, newId, one, pool, type Db } from "./db";
import { HttpError, type User } from "./session";

export type Project = {
  id: string;
  user_id: string;
  name: string;
  description: string;
  budget_micros: number | null;
  daily_cap_micros: number;
  demo_connection: boolean;
  created_at: string;
};

/** Every project-scoped read/write goes through here. Not yours → 404 (don't reveal existence). */
export async function requireProjectOwner(user: User, projectId: string, q: Db = pool): Promise<Project> {
  const p = await one<Project>(q, "SELECT * FROM projects WHERE id = $1 AND user_id = $2", [projectId, user.id]);
  if (!p) throw new HttpError(404, "Project not found");
  return p;
}

export function listProjects(user: User) {
  return many<Project>(pool, "SELECT * FROM projects WHERE user_id = $1 ORDER BY created_at DESC", [user.id]);
}

export async function createProject(user: User, input: { name: string; description?: string }) {
  const id = newId("prj");
  await pool.query("INSERT INTO projects (id, user_id, name, description) VALUES ($1, $2, $3, $4)", [
    id,
    user.id,
    input.name,
    input.description ?? "",
  ]);
  return id;
}
