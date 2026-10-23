"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";

type Inbox = {
  bookings: { name: string; contact: string; service: string; starts_at: string }[];
  mail: { id: number; kind: string; to_address: string; subject: string; body: string; created_at: string }[];
};

// For judges without Supabase or Resend accounts: one switch instead of two connections.
export function DemoSwitch({ projectId, on, available, onChange }: { projectId: string; on: boolean; available: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!available && !on) return null;

  async function set(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/projects/${projectId}/demo`, { body: { on: next } });
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <div className={`space-y-2 text-sm ${on ? "kp-panel kp-panel-active" : "kp-note"}`}>
      {on ? (
        <>
          <p>
            <span className="font-semibold">✓ Using the demo connection.</span> Bookings go to Kitpier&apos;s demo database and emails
            appear in the Demo inbox below instead of being sent. Demo bookings are removed after 48 hours.
          </p>
          <button aria-busy={busy} disabled={busy} onClick={() => set(false)} className="text-muted underline">
            Switch off and use my own accounts
          </button>
        </>
      ) : (
        <>
          <p>
            <span className="font-semibold">No Supabase or Resend account?</span> Try everything with Kitpier&apos;s demo connection
            instead. Nothing is created in your accounts.
          </p>
          <button aria-busy={busy} disabled={busy} onClick={() => set(true)} className="kp-btn-outline">
            Use demo connection
          </button>
        </>
      )}
      {error && <p className="text-danger">{error}</p>}
    </div>
  );
}

export function DemoInbox({ projectId }: { projectId: string }) {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const load = useCallback(() => api<Inbox>(`/api/projects/${projectId}/demo`).then(setInbox, () => {}), [projectId]);
  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, 5000); // a judge books in another tab; keep this fresh
    return () => (clearTimeout(first), clearInterval(t));
  }, [load]);

  return (
    <section id="demo-inbox" className="space-y-4 kp-panel">
      <div>
        <h2 className="text-[22px]">Demo inbox</h2>
        <p className="text-sm text-muted">What your booking page saved and emailed, live. With your own accounts these land in Supabase and Resend.</p>
      </div>
      <div className="space-y-2">
        <p className="font-display">Bookings in the demo database</p>
        <ul className="divide-y divide-line text-sm">
          {inbox?.bookings.map((b) => (
            <li key={b.starts_at} className="flex flex-wrap justify-between gap-2 py-2">
              <span>
                {b.service} · {b.name} <span className="text-muted">{b.contact}</span>
              </span>
              <span>{new Date(b.starts_at).toLocaleString()}</span>
            </li>
          ))}
          {inbox && inbox.bookings.length === 0 && <li className="py-2 text-muted">No bookings yet. Open your booking page and book something.</li>}
        </ul>
      </div>
      <div className="space-y-2">
        <p className="font-display">Sent emails (shown here, not delivered)</p>
        <ul className="space-y-2 text-sm">
          {inbox?.mail.map((m) => (
            <li key={m.id} className="kp-note">
              <p className="font-display text-lg">{m.subject}</p>
              <p className="text-xs text-muted">
                To {m.to_address} · {new Date(m.created_at).toLocaleTimeString()}
              </p>
              <p className="mt-2 whitespace-pre-wrap">{m.body}</p>
            </li>
          ))}
          {inbox && inbox.mail.length === 0 && <li className="text-muted">No emails yet.</li>}
        </ul>
      </div>
    </section>
  );
}
