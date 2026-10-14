"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { Job, ProvisionSpec } from "@/lib/provision";

type State = { action: { id: string; status: string; spec: ProvisionSpec } | null; job: Job | null };

const STEPS = [
  { state: "requested", label: "Approved" },
  { state: "creating", label: "Creating your Supabase project" },
  { state: "healthy", label: "Starting up (usually 1–2 minutes)" },
  { state: "schema_ready", label: "Bookings table added" },
];

// Propose → approve → progress. Nothing is created in Supabase before the Approve click.
export default function DatabaseSetup({ projectId, onReady }: { projectId: string; onReady: () => void }) {
  const [st, setSt] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wasRunning = useRef(false);
  const poll = useCallback(async () => {
    try {
      const next = await api<State>(`/api/projects/${projectId}/provision`);
      const nowRunning = !!next.job && !["schema_ready", "failed"].includes(next.job.state);
      if (wasRunning.current && next.job?.state === "schema_ready") onReady(); // let the page show the next step
      wasRunning.current = nowRunning;
      setSt(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId, onReady]);

  const running = !!st?.job && !["schema_ready", "failed"].includes(st.job.state);
  useEffect(() => {
    const t = setTimeout(poll, 0);
    return () => clearTimeout(t);
  }, [poll]);
  // While a job runs, each poll advances it one step on the server.
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(poll, 4000);
    return () => clearTimeout(t);
  }, [poll, running, st]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await poll();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  if (!st) return null;
  const { action, job } = st;
  const pending = action?.status === "pending" ? action : null;
  const showJob = job && !(job.state === "failed" && pending);

  return (
    <div className="space-y-2 rounded-xl border border-line bg-paper p-3 text-sm">
      <p className="font-semibold">Database setup</p>

      {showJob && job.state === "schema_ready" && (
        <p>
          ✓ Ready. Your bookings table lives in{" "}
          <a className="underline" target="_blank" rel="noreferrer" href={`https://supabase.com/dashboard/project/${job.ref}`}>
            your Supabase project
          </a>
          .
        </p>
      )}

      {showJob && running && (
        <ol className="space-y-1">
          {STEPS.map((s, i) => {
            const at = STEPS.findIndex((x) => x.state === job.state);
            const done = i < at || (i === 0 && at >= 0);
            return (
              <li key={s.state} className={done ? "text-muted" : i === at ? "font-semibold" : "text-muted"}>
                {done ? "✓" : i === at ? "…" : "○"} {s.label}
              </li>
            );
          })}
          {job.error && <li className="text-muted">{job.error}</li>}
        </ol>
      )}

      {showJob && job.state === "failed" && <p className="text-danger">{job.error ?? "Setup failed."}</p>}

      {pending && (
        <div className="space-y-2">
          <p>Kitpier asks permission to:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Create a new Supabase project <b>{pending.spec.project_name}</b> in your <b>{pending.spec.org_name}</b>{" "}
              organization (free plan, Americas region).
            </li>
            <li>Add one table, <b>bookings</b> (name, contact, service, time), with row-level security on.</li>
            <li>Keep that project&apos;s server key, encrypted, so the Booking API can save bookings.</li>
          </ul>
          <p className="text-muted">Nothing else in your Supabase account is read or changed.</p>
          <div className="flex gap-3">
            <button
              disabled={busy}
              onClick={() => act(() => api(`/api/actions/${pending.id}/approve`, { body: {} }))}
              className="rounded-xl bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50"
            >
              Approve
            </button>
            <button disabled={busy} onClick={() => act(() => api(`/api/actions/${pending.id}/reject`, { body: {} }))} className="text-muted underline">
              Not now
            </button>
          </div>
        </div>
      )}

      {!pending && (!job || job.state === "failed") && (
        <div className="space-y-2">
          {!job && <p className="text-muted">Your app needs somewhere to store bookings. Kitpier can propose a setup for you to approve.</p>}
          <button
            disabled={busy}
            onClick={() => act(() => api(`/api/projects/${projectId}/provision`, { body: {} }))}
            className="rounded-xl border border-accent px-4 py-2 font-semibold text-accent disabled:opacity-50"
          >
            {busy ? "Checking your Supabase…" : job ? "Propose again" : "Propose a database setup"}
          </button>
        </div>
      )}
      {error && <p className="text-danger">{error}</p>}
    </div>
  );
}
