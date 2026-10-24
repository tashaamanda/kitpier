"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";

type Props = {
  code: string;
  clientName: string;
  suggestedName: string | null;
  projects: { id: string; name: string }[];
};

const NEW = "__new__";

// The person's side of agent access: what the agent will and won't be able to do, one project, Allow or Deny.
export default function AgentLinkDecision({ code, clientName, suggestedName, projects }: Props) {
  // No default: the person picks the project on purpose, so a link can't quietly attach an agent to one.
  const [choice, setChoice] = useState("");
  const [newName, setNewName] = useState(suggestedName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ allowed: boolean; projectId: string | null } | null>(null);

  async function decide(allow: boolean) {
    setBusy(true);
    setError(null);
    try {
      const body = !allow ? { allow } : choice === NEW ? { allow, newProjectName: newName } : { allow, projectId: choice };
      setDone(await api<{ allowed: boolean; projectId: string | null }>(`/api/agent-links/${encodeURIComponent(code)}`, { body }));
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  if (done)
    return done.allowed ? (
      <div className="kp-panel kp-panel-active space-y-3">
        <p className="font-semibold">✓ Connected. You can go back to your agent.</p>
        <p className="text-sm text-muted">
          You&apos;ll see this agent on the project page, where you can disconnect it at any time.{" "}
          {done.projectId && (
            <Link href={`/projects/${done.projectId}`} className="underline">
              Open the project
            </Link>
          )}
        </p>
      </div>
    ) : (
      <p className="kp-note">Not connected. The agent can&apos;t use your account.</p>
    );

  const input = "w-full border-0 border-b border-line bg-transparent px-0 py-3 outline-none focus:border-ink";

  return (
    <div className="grid gap-6">
      <div className="kp-panel space-y-4">
        <p>
          An agent that calls itself <span className="font-semibold">{clientName}</span> wants to use Kitpier for one of your projects.
        </p>
        <p className="text-sm text-danger">
          Only continue if you started this yourself, from your own agent, just now. If someone sent you this link, close the page.
        </p>
        <p className="text-sm text-muted">
          The name comes from the agent and isn&apos;t verified. Your agent should be showing the code{" "}
          <span className="font-semibold text-ink">{code}</span>.
        </p>
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <p className="font-display">It will be able to</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>Read the project&apos;s status, budget and credits</li>
              <li>Plan a stack and propose setups</li>
              <li>Ask you to approve things, with a link</li>
              <li>Use the free planner (part of your daily quota)</li>
            </ul>
          </div>
          <div>
            <p className="font-display">It won&apos;t be able to</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>Approve anything or pay</li>
              <li>Connect your Supabase or Resend</li>
              <li>Get an API key that spends credits, unless you approve it</li>
              <li>See your other projects</li>
            </ul>
          </div>
        </div>
      </div>

      <label className="grid gap-2">
        <span className="micro text-muted">Project</span>
        <select value={choice} onChange={(e) => setChoice(e.target.value)} className={input}>
          <option value="" disabled>
            Choose a project…
          </option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value={NEW}>New project…</option>
        </select>
      </label>
      {choice === NEW && (
        <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80} placeholder="Project name" className={input} />
      )}

      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <button aria-busy={busy} disabled={busy || !choice || (choice === NEW && !newName.trim())} onClick={() => decide(true)} className="kp-btn">
          Allow
        </button>
        <button disabled={busy} onClick={() => decide(false)} className="kp-btn-outline">
          Deny
        </button>
      </div>
    </div>
  );
}
