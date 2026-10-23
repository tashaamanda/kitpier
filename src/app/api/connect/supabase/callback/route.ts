import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/app-url";
import { requireProjectOwner } from "@/lib/projects";
import { HttpError, currentUser } from "@/lib/session";
import { claimState, finishConnect } from "@/lib/supabase";

// Supabase redirects the browser here after consent. Always lands back on a page, never shows provider errors.
export async function GET(req: Request) {
  const appUrl = appOrigin();
  const q = new URL(req.url).searchParams;
  const back = (path: string, params: Record<string, string>) =>
    NextResponse.redirect(new URL(`${path}?${new URLSearchParams(params)}`, appUrl), 303);

  const user = await currentUser();
  if (!user) return back("/", { connect_error: "Sign in, then connect Supabase again." });
  const state = q.get("state") ?? "";
  let projectId: string | undefined;
  try {
    const claimed = await claimState(user.id, state);
    projectId = (await requireProjectOwner(user, claimed.projectId)).id;
    if (q.get("error")) return back(`/projects/${projectId}`, { connect_error: "Supabase access was not granted." });
    const code = q.get("code");
    if (!code) throw new HttpError(400, "Missing code");
    await finishConnect({ userId: user.id, projectId }, code, claimed.verifier);
    return back(`/projects/${projectId}`, { connected: "supabase" });
  } catch (e) {
    if (!(e instanceof HttpError)) console.error("supabase callback failed", (e as Error).name);
    const message = e instanceof HttpError && e.status < 500 ? e.message : "Couldn't connect Supabase. Please try again.";
    return back(projectId ? `/projects/${projectId}` : "/", { connect_error: message });
  }
}
