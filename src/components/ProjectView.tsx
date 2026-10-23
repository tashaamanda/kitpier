"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, usd } from "@/lib/client";
import BookingPageSetup from "./BookingPageSetup";
import BuyCredits from "./BuyCredits";
import { DemoInbox, DemoSwitch } from "./DemoConnection";
import Planner from "./Planner";
import ResendConnect from "./ResendConnect";
import SupabaseConnect, { type Connection } from "./SupabaseConnect";
import TopBar from "./TopBar";

type Entry = { source: string; kind: string; amount_micros: number; created_at: string };
type Order = { id: string; pack_id: string; amount_micros: number; status: string; created_at: string };

export default function ProjectView({
  projectId,
  name,
  description,
}: {
  projectId: string;
  name: string;
  description: string;
}) {
  const [ledger, setLedger] = useState<Entry[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [balance, setBalance] = useState(0);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [databaseReady, setDatabaseReady] = useState(false);
  const [demo, setDemo] = useState({ on: false, available: false });
  const [rev, setRev] = useState(0); // bumps after every reload so the planner's checklist refreshes too
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [autoStart] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("start"),
  );

  // Result of the Supabase OAuth round trip, passed back in the URL once.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const err = q.get("connect_error");
    const next = err ? { ok: false, text: err } : q.get("connected") ? { ok: true, text: "Supabase connected." } : null;
    if (q.size) window.history.replaceState(null, "", window.location.pathname);
    if (next) {
      setTimeout(() => setNotice(next), 0);
    }
  }, []);

  const load = useCallback(async () => {
    const [p, me] = await Promise.all([
      api<{
        ledger: Entry[];
        orders: Order[];
        connections: Connection[];
        databaseReady: boolean;
        demo: boolean;
        demoAvailable: boolean;
      }>(`/api/projects/${projectId}`),
      api<{ balanceMicros: number }>("/api/me"),
    ]);
    setLedger(p.ledger);
    setOrders(p.orders);
    setConnections(p.connections);
    setDatabaseReady(p.databaseReady);
    setDemo({ on: p.demo, available: p.demoAvailable });
    setRev((r) => r + 1);
    setBalance(me.balanceMicros);
  }, [projectId]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <main className="app-page">
      <TopBar signedIn />
      <div className="app-inner">
        <header className="app-head">
          <div className="grid gap-3">
            <Link href="/" className="micro text-muted no-underline">
              ← Your projects
            </Link>
            <h1 className="app-title">{name}</h1>
          </div>
          <div className="grid justify-items-end gap-2 text-right">
            <span className="micro text-muted">Credits</span>
            <span className="app-figure">{usd(balance)}</span>
          </div>
        </header>
        {notice && <p className={`kp-note ${notice.ok ? "" : "kp-note-danger text-danger"}`}>{notice.text}</p>}
        <Planner projectId={projectId} description={description} autoStart={autoStart} rev={rev} onApproved={load} />
        <section id="accounts" className="kp-panel">
          <h2 className="mb-4">Your accounts</h2>
          <DemoSwitch projectId={projectId} on={demo.on} available={demo.available} onChange={load} />
          {!demo.on && (
            <>
              <div className="my-4" />
              <SupabaseConnect
                projectId={projectId}
                connection={connections.find((c) => c.kind === "supabase_oauth")}
                onChange={load}
              />
              <div className="my-4 border-t border-line" />
              <ResendConnect
                projectId={projectId}
                connection={connections.find((c) => c.kind === "resend_send_key")}
                onChange={load}
              />
            </>
          )}
        </section>
        <BookingPageSetup key={rev} projectId={projectId} databaseReady={databaseReady} />
        {demo.on && <DemoInbox projectId={projectId} />}
        <section id="credits" className="kp-panel">
          <h2 className="mb-4">Buy credits with PayPal</h2>
          <BuyCredits projectId={projectId} onPaid={load} />
        </section>
        <section className="kp-panel">
          <h2 className="mb-4">Ledger</h2>
          <ul className="divide-y divide-line text-sm">
            {ledger.map((e) => (
              <li key={e.source} className="flex justify-between py-3" style={{ fontVariantNumeric: "tabular-nums" }}>
                <span>
                  {e.kind} <span className="text-muted">{new Date(e.created_at).toLocaleString()}</span>
                </span>
                <span className={e.amount_micros < 0 ? "text-danger" : ""}>{usd(e.amount_micros)}</span>
              </li>
            ))}
            {ledger.length === 0 && <li className="py-2 text-muted">No entries yet.</li>}
          </ul>
          {orders.length > 0 && (
            <p className="mt-3 text-xs text-muted">
              Orders: {orders.map((o) => `${o.pack_id} ${o.status}`).join(" · ")}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
