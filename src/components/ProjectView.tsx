"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, usd } from "@/lib/client";
import BuyCredits from "./BuyCredits";
import SupabaseConnect, { type Connection } from "./SupabaseConnect";

type Entry = { source: string; kind: string; amount_micros: number; created_at: string };
type Order = { id: string; pack_id: string; amount_micros: number; status: string; created_at: string };

export default function ProjectView({ projectId, name }: { projectId: string; name: string }) {
  const [ledger, setLedger] = useState<Entry[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [balance, setBalance] = useState(0);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  // Result of the Supabase OAuth round trip, passed back in the URL once.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const err = q.get("connect_error");
    const next = err ? { ok: false, text: err } : q.get("connected") ? { ok: true, text: "Supabase connected." } : null;
    if (next) {
      window.history.replaceState(null, "", window.location.pathname);
      setTimeout(() => setNotice(next), 0);
    }
  }, []);

  const load = useCallback(async () => {
    const [p, me] = await Promise.all([
      api<{ ledger: Entry[]; orders: Order[]; connections: Connection[] }>(`/api/projects/${projectId}`),
      api<{ balanceMicros: number }>("/api/me"),
    ]);
    setLedger(p.ledger);
    setOrders(p.orders);
    setConnections(p.connections);
    setBalance(me.balanceMicros);
  }, [projectId]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-5 py-10">
      <Link href="/" className="text-sm text-muted underline">
        ← Projects
      </Link>
      <header className="flex items-end justify-between">
        <h1 className="text-3xl font-semibold">{name}</h1>
        <div className="text-right">
          <p className="text-sm text-muted">Credits</p>
          <p className="text-2xl font-semibold">{usd(balance)}</p>
        </div>
      </header>
      {notice && (
        <p className={`rounded-xl border p-3 text-sm ${notice.ok ? "border-accent" : "border-danger text-danger"}`}>
          {notice.text}
        </p>
      )}
      <section className="rounded-2xl border border-line bg-card p-5">
        <h2 className="mb-3 font-semibold">Your accounts</h2>
        <SupabaseConnect
          projectId={projectId}
          connection={connections.find((c) => c.kind === "supabase_oauth")}
          onChange={load}
        />
      </section>
      <section className="rounded-2xl border border-line bg-card p-5">
        <h2 className="mb-3 font-semibold">Buy credits with PayPal</h2>
        <BuyCredits projectId={projectId} onPaid={load} />
      </section>
      <section className="rounded-2xl border border-line bg-card p-5">
        <h2 className="mb-3 font-semibold">Ledger</h2>
        <ul className="divide-y divide-line text-sm">
          {ledger.map((e) => (
            <li key={e.source} className="flex justify-between py-2">
              <span>
                {e.kind} <span className="text-muted">{new Date(e.created_at).toLocaleString()}</span>
              </span>
              <span className={e.amount_micros < 0 ? "text-danger" : ""}>{usd(e.amount_micros)}</span>
            </li>
          ))}
          {ledger.length === 0 && <li className="py-2 text-muted">No entries yet.</li>}
        </ul>
        {orders.length > 0 && (
          <p className="mt-3 text-xs text-muted">Orders: {orders.map((o) => `${o.pack_id} ${o.status}`).join(" · ")}</p>
        )}
      </section>
    </main>
  );
}
