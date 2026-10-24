"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";

type Agent = { id: string; client_name: string; prefix: string; created_at: string; expires_at: string; last_used_at: string | null };

// Agents the owner allowed for this project. Names are self-reported by the agent.
export default function ConnectedAgents({ projectId }: { projectId: string }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () => api<{ agents: Agent[] }>(`/api/projects/${projectId}/agents`).then((r) => setAgents(r.agents), () => {}),
    [projectId],
  );
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function revoke(tokenId: string) {
    setError(null);
    try {
      await api(`/api/projects/${projectId}/agents`, { method: "DELETE", body: { tokenId } });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (agents.length === 0) return null;
  return (
    <section id="agents" className="kp-panel">
      <h2 className="mb-1">Connected agents</h2>
      <p className="mb-4 text-sm text-muted">They can read and propose for this project. They can&apos;t approve or pay.</p>
      <ul className="divide-y divide-line text-sm">
        {agents.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <span>
              {a.client_name} <span className="text-muted">(self-reported) · ka_{a.prefix}…</span>
              <br />
              <span className="text-muted">
                Last used {a.last_used_at ? new Date(a.last_used_at).toLocaleString() : "never"} · expires{" "}
                {new Date(a.expires_at).toLocaleDateString()}
              </span>
            </span>
            <button onClick={() => revoke(a.id)} className="kp-btn-outline kp-btn-xs">
              Disconnect
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </section>
  );
}
