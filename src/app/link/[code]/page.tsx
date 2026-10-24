import { Suspense } from "react";
import { redirect } from "next/navigation";
import { displayCode, normalizeCode, openLink } from "@/lib/agents";
import { rateLimit } from "@/lib/http";
import { listProjects } from "@/lib/projects";
import { clientIp, currentUser } from "@/lib/session";
import AgentLinkDecision from "@/components/AgentLinkDecision";
import TopBar from "@/components/TopBar";

export const metadata = { title: "Connect an agent · Kitpier" };

async function Link({ params }: { params: Promise<{ code: string }> }) {
  const raw = (await params).code;
  const code = normalizeCode(decodeURIComponent(raw));
  const user = await currentUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(`/link/${code ? displayCode(code) : ""}`)}`);

  let message: string | null = null;
  let link = null;
  try {
    await rateLimit(`agent-link:${user.id}`, 20, 60 * 60_000);
    await rateLimit(`agent-link-ip:${await clientIp()}`, 20, 60 * 60_000);
    link = code ? await openLink(code) : undefined;
    if (!link) message = "This link has expired or was already used. Ask your agent for a new one.";
  } catch {
    message = "Too many tries. Wait a little and open the link again.";
  }

  return (
    <div className="mx-auto grid w-full max-w-lg content-center gap-6 py-10">
      <h1 className="text-4xl" style={{ letterSpacing: "-0.04em" }}>
        Connect an <i>agent</i>
      </h1>
      {link && code ? (
        <AgentLinkDecision
          code={displayCode(code)}
          clientName={link.client_name}
          suggestedName={link.project_name}
          projects={(await listProjects(user)).map((p) => ({ id: p.id, name: p.name }))}
        />
      ) : (
        <p className="text-muted">{message}</p>
      )}
    </div>
  );
}

export default function Page({ params }: { params: Promise<{ code: string }> }) {
  return (
    <main className="lp-hero" style={{ gridTemplateRows: "auto 1fr" }}>
      <TopBar />
      <Suspense fallback={<p className="p-10 text-muted">Loading…</p>}>
        <Link params={params} />
      </Suspense>
    </main>
  );
}
