"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, usd } from "@/lib/client";
import type { PackId } from "@/lib/packs";
import BuyCredits from "./BuyCredits";
import { Badge } from "./Catalog";
import { DemoSwitch } from "./DemoConnection";
import ResendConnect from "./ResendConnect";
import SupabaseConnect, { type Connection } from "./SupabaseConnect";

type Item = {
  kind: "stack" | "setup" | "booking_page" | "api_key" | "top_up";
  id: string;
  state: "pending" | "approved" | "rejected" | "stale";
  details: Record<string, unknown>;
};
type Status = { credits_usd: number; supabase_connected: boolean; resend_connected: boolean; demo_connection: boolean };
type Data = { view: { expired: boolean; items: Item[] }; status: Status; connections: Connection[]; approvedStack: string[]; demoAvailable: boolean; demoAccount: boolean };
type StackItem = { slug: string; name: string; type: "buy" | "connect" | "soon"; price: string; reason: string };

// One page for everything an agent is waiting on. Each card shows exactly what was proposed; approving checks on the
// server that it hasn't changed since the link was made. Paying is PayPal checkout, as everywhere else.
export default function ApprovalFlow({ approvalId, projectId, projectName }: { approvalId: string; projectId: string; projectName: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<Data>(`/api/approvals/${approvalId}`).then(setData, (e) => setError((e as Error).message)), [approvalId]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function decide(index: number, approve: boolean) {
    setBusy(index);
    setError(null);
    try {
      await api(`/api/approvals/${approvalId}/items/${index}`, { body: { approve } });
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(null);
    await load();
  }

  if (!data) return <div className="app-inner">{error ? <p className="text-danger">{error}</p> : <p className="text-muted">Loading…</p>}</div>;

  const { view, status } = data;
  const stackItem = view.items.find((i) => i.kind === "stack");
  const slugs = stackItem ? ((stackItem.details.items as StackItem[]) ?? []).map((i) => i.slug) : data.approvedStack;
  const stackApproved = data.approvedStack.length > 0;
  // A specific top-up on this link is the purchase to make; don't also show the generic pack picker.
  const topUpPending = view.items.some((i) => i.kind === "top_up" && i.state === "pending");
  const needsCredits = stackApproved && slugs.includes("booking-api") && status.credits_usd <= 0 && !topUpPending;
  const needsAccounts =
    stackApproved && ((slugs.includes("supabase") && !status.supabase_connected) || (slugs.includes("resend") && !status.resend_connected));
  const open = view.items.some((i) => i.state === "pending") || needsCredits || needsAccounts;

  const actions = (i: number, item: Item, label: string) =>
    item.state === "pending" ? (
      <div className="flex flex-wrap gap-3">
        <button aria-busy={busy === i} disabled={busy !== null} onClick={() => decide(i, true)} className="kp-btn kp-btn-sm">
          {label}
        </button>
        <button disabled={busy !== null} onClick={() => decide(i, false)} className="kp-btn-outline">
          Decline
        </button>
      </div>
    ) : (
      <StateNote state={item.state} />
    );

  // Only what still needs the person gets the dark border; decided cards step back.
  const panel = (item: Item) => (item.state === "pending" ? "kp-panel kp-panel-active space-y-3" : "kp-panel space-y-3 text-muted");

  const card = (item: Item, i: number) => {
        const d = item.details;
        if (item.kind === "stack") {
          const items = (d.items as StackItem[]) ?? [];
          return (
            <section key={item.id} className={panel(item)}>
              <h2>Stack</h2>
              <ul className="space-y-3">
                {items.map((s) => (
                  <li key={s.slug} className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{s.name}</span>
                      <Badge type={s.type} />
                      <span className="text-sm text-muted">{s.price}</span>
                    </div>
                    <p className="text-sm">{s.reason}</p>
                  </li>
                ))}
              </ul>
              <div className="space-y-1 border-t border-line pt-3 text-sm">
                {Number(d.enforced_micros) > 0 && (
                  <p>
                    <span className="font-semibold">Kitpier, budget enforced:</span> about {usd(Number(d.enforced_micros))}/month, capped at{" "}
                    {usd(Number(d.budget_cap_micros))}/month
                  </p>
                )}
                {Number(d.external_paid_micros) > 0 && (
                  <p>
                    <span className="font-semibold">Your own accounts, estimate:</span> $0 on free tiers, from about{" "}
                    {usd(Number(d.external_paid_micros))}/month if you upgrade. Billed by each provider.
                  </p>
                )}
              </div>
              {actions(i, item, "Approve this stack")}
            </section>
          );
        }
        if (item.kind === "top_up")
          return (
            <section key={item.id} className={panel(item)}>
              <h2>Add {usd(Number(d.amount_micros))} with PayPal</h2>
              {d.budget_before_micros != null && (
                <p className="text-sm">
                  Paying also raises this project&apos;s monthly budget from {usd(Number(d.budget_before_micros))} to{" "}
                  {usd(Number(d.budget_after_micros))}, so the new credits can be used this month.
                </p>
              )}
              {item.state === "pending" ? (
                <BuyCredits
                  projectId={projectId}
                  onPaid={load}
                  fixedPack={d.pack as PackId}
                  topUpId={item.id}
                  budgetSeenMicros={d.budget_before_micros == null ? null : Number(d.budget_before_micros)}
                  approvalId={approvalId}
                />
              ) : (
                <StateNote state={item.state} />
              )}
            </section>
          );
        if (item.kind === "setup")
          return (
            <section key={item.id} className={panel(item)}>
              <h2>Create the bookings database</h2>
              <p className="text-sm">
                A new Supabase project <span className="font-semibold">{String(d.project_name)}</span> in your organization{" "}
                <span className="font-semibold">{String(d.org_name)}</span>, with Kitpier&apos;s bookings table. Free on Supabase&apos;s free plan.
              </p>
              {actions(i, item, "Approve database setup")}
            </section>
          );
        if (item.kind === "booking_page")
          return (
            <section key={item.id} className={panel(item)}>
              <h2>Publish the booking page</h2>
              <p className="text-sm">
                <span className="font-semibold">{String(d.business_name)}</span> · {((d.services as string[]) ?? []).join(", ")} ·{" "}
                {String(d.timezone)}
              </p>
              <p className="text-sm text-muted">Each message costs credits and each booking costs credits, within your monthly budget.</p>
              {actions(i, item, "Publish booking page")}
            </section>
          );
        return (
          <section key={item.id} className={panel(item)}>
            <h2>Give your agent a Booking API key</h2>
            <p className="text-sm">
              Your site will use this key to take bookings. It spends credits
              {d.monthly_budget_micros != null ? `, up to your ${usd(Number(d.monthly_budget_micros))}/month budget` : ""}. Only the agent
              that asked can collect it, once, within an hour of your approval.
            </p>
            {typeof d.requested_by === "string" && (
              <p className="text-sm text-muted">Requested by an agent that calls itself {d.requested_by} (name not verified).</p>
            )}
            {item.state === "pending" && typeof d.replaces_key === "string" && (
              <p className="text-sm text-danger">This replaces your current key ({d.replaces_key}…). Sites using it stop working until updated.</p>
            )}
            {actions(i, item, "Approve key")}
          </section>
        );
      };

  return (
    <div className="app-inner">
      <header className="app-head">
        <div className="grid gap-3">
          <Link href={`/projects/${projectId}`} className="micro text-muted no-underline">
            {projectName}
          </Link>
          <h1 className="app-title">Your agent is waiting on you</h1>
          <p className="text-muted">Review each step. Nothing here happens until you approve it, and payments go through PayPal.</p>
        </div>
        <div className="grid justify-items-end gap-2 text-right">
          <span className="micro text-muted">Credits</span>
          <span className="app-figure">{usd(status.credits_usd * 1_000_000)}</span>
        </div>
      </header>
      {view.expired && <p className="kp-note">This link has expired. Ask your agent for a new one.</p>}
      {error && <p className="kp-note kp-note-danger text-danger">{error}</p>}

      {view.items.map((item, i) => item.kind === "stack" && card(item, i))}
      {needsCredits && (
        <section id="credits" className="kp-panel kp-panel-active space-y-3">
          <h2>Buy credits with PayPal</h2>
          <p className="text-sm text-muted">The Booking API runs on Kitpier credits.</p>
          <BuyCredits projectId={projectId} onPaid={load} />
        </section>
      )}
      {needsAccounts && (
        <section id="accounts" className="kp-panel kp-panel-active space-y-3">
          <h2>Connect your accounts</h2>
          <DemoSwitch projectId={projectId} on={status.demo_connection} available={data.demoAvailable} locked={data.demoAccount} onChange={load} />
          {!status.demo_connection && (
            <>
              {slugs.includes("supabase") && (
                <SupabaseConnect projectId={projectId} connection={data.connections.find((c) => c.kind === "supabase_oauth")} onChange={load} />
              )}
              {slugs.includes("resend") && (
                <ResendConnect projectId={projectId} connection={data.connections.find((c) => c.kind === "resend_send_key")} onChange={load} />
              )}
              <p className="text-sm text-muted">After connecting Supabase you land on your project page. Come back to this link to continue.</p>
            </>
          )}
        </section>
      )}

      {view.items.map((item, i) => item.kind !== "stack" && card(item, i))}

      {!open && !view.expired && (
        <p className="kp-note">
          <span className="font-semibold">✓ All done.</span> You can go back to your agent.
        </p>
      )}
    </div>
  );
}

function StateNote({ state }: { state: Item["state"] }) {
  if (state === "approved") return <p className="text-sm">✓ Approved</p>;
  if (state === "rejected") return <p className="text-sm text-muted">Declined</p>;
  if (state === "stale") return <p className="text-sm text-muted">Changed since this link was made. Ask your agent for a new link.</p>;
  return null;
}
