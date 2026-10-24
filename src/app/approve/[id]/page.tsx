import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { one, pool } from "@/lib/db";
import { currentUser } from "@/lib/session";
import ApprovalFlow from "@/components/ApprovalFlow";
import TopBar from "@/components/TopBar";

export const metadata = { title: "Approve · Kitpier" };

async function Approve({ params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const user = await currentUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(`/approve/${id}`)}`);
  // Owner only: anyone else gets a 404 (don't reveal that the link exists).
  const link = await one<{ project_id: string; name: string }>(
    pool,
    "SELECT a.project_id, p.name FROM approval_links a JOIN projects p ON p.id = a.project_id WHERE a.id = $1 AND a.user_id = $2",
    [id, user.id],
  );
  if (!link) notFound();
  return <ApprovalFlow approvalId={id} projectId={link.project_id} projectName={link.name} />;
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="app-page">
      <TopBar />
      <Suspense fallback={<p className="p-10 text-muted">Loading…</p>}>
        <Approve params={params} />
      </Suspense>
    </main>
  );
}
