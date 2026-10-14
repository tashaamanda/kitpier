import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { one, pool } from "@/lib/db";
import { currentUser } from "@/lib/session";
import ProjectView from "@/components/ProjectView";

async function Project({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/");
  // Same ownership rule as requireProjectOwner: not yours → 404.
  const p = await one<{ id: string; name: string; description: string }>(
    pool,
    "SELECT id, name, description FROM projects WHERE id = $1 AND user_id = $2",
    [(await params).id, user.id],
  );
  if (!p) notFound();
  return <ProjectView projectId={p.id} name={p.name} description={p.description} />;
}

export default function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  return (
    <Suspense fallback={<main className="p-10 text-muted">Loading…</main>}>
      <Project params={params} />
    </Suspense>
  );
}
