"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { WidgetSpec } from "@/lib/booking";
import AppHandoff from "./AppHandoff";

type State = { action: { id: string; status: string; spec: WidgetSpec } | null; widget: { id: string; business_name: string } | null };

// Owner side of the booking page: describe it → approve → live link.
export default function BookingPageSetup({ projectId, databaseReady }: { projectId: string; databaseReady: boolean }) {
  const [st, setSt] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [origin, setOrigin] = useState("");

  const load = useCallback(async () => setSt(await api<State>(`/api/projects/${projectId}/widget`)), [projectId]);
  useEffect(() => {
    const t = setTimeout(() => {
      setOrigin(window.location.origin);
      load().catch(() => {});
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  if (!st) return null;
  const pending = st.action?.status === "pending" ? st.action : null;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <>
      <section id="booking" className="space-y-3 kp-panel">
        <h2 className="text-[22px]">Booking page</h2>
        {!databaseReady && <p className="text-sm text-muted">Set up the Supabase database first. Bookings are saved there.</p>}

        {st.widget && !editing && (
          <div className="space-y-1 text-sm">
            <p>
              ✓ Live:{" "}
              <a className="font-semibold underline" href={`/r/${st.widget.id}`} target="_blank" rel="noreferrer">
                {origin}/r/{st.widget.id}
              </a>
            </p>
            <p className="text-muted">Each message costs $0.02 and each booking $0.05, from your credits. It pauses at your budget.</p>
            <button onClick={() => setEditing(true)} className="text-muted underline">
              Change details
            </button>
          </div>
        )}

        {pending && (
          <div className="space-y-2 kp-note text-sm">
            <p>Kitpier asks permission to publish a booking page for <b>{pending.spec.business_name}</b>:</p>
            <ul className="list-disc pl-5">
              <li>Services: {pending.spec.services.join(", ")}</li>
              <li>Hours: Monday–Saturday 9:00–17:00 ({pending.spec.timezone}), one-hour appointments</li>
              <li>Bookings are saved to your Supabase bookings table; messages and bookings are paid from your credits</li>
            </ul>
            <div className="flex gap-3">
              <button
                aria-busy={busy} disabled={busy}
                onClick={() => act(() => api(`/api/actions/${pending.id}/approve`, { body: {} }))}
                className="kp-btn kp-btn-sm"
              >
                Approve
              </button>
              <button aria-busy={busy} disabled={busy} onClick={() => act(() => api(`/api/actions/${pending.id}/reject`, { body: {} }))} className="text-muted underline">
                Not now
              </button>
            </div>
          </div>
        )}

        {databaseReady && !pending && (!st.widget || editing) && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const services = String(f.get("services")).split(",").map((x) => x.trim()).filter(Boolean);
              act(() => api(`/api/projects/${projectId}/widget`, { body: { business_name: f.get("business_name"), services, timezone: f.get("timezone") } }));
            }}
            className="space-y-2 text-sm"
          >
            <input name="business_name" required maxLength={80} defaultValue={st.widget?.business_name} placeholder="Business name (e.g. Sam's Barbershop)" className="w-full kp-input" />
            <input name="services" required maxLength={500} placeholder="Services, separated by commas (e.g. Haircut, Beard trim, Shave)" className="w-full kp-input" />
            <input name="timezone" required maxLength={64} defaultValue={tz} className="w-full kp-input" />
            <button aria-busy={busy} disabled={busy} className="kp-btn-outline">
              Propose booking page
            </button>
          </form>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
      </section>
      {st.widget && <AppHandoff projectId={projectId} businessName={st.widget.business_name} />}
    </>
  );
}
