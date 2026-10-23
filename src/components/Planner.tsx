"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, usd } from "@/lib/client";
import type { PauseReason } from "@/lib/billing";
import type { Proposal } from "@/lib/stack";
import type { TopUp } from "@/lib/topup";
import BuyCredits from "./BuyCredits";
import { Badge } from "./Catalog";

type Msg = { id: number; role: "user" | "assistant"; body: string; proposal_id: string | null };
type Status = {
  credits_usd: number;
  supabase_connected: boolean;
  resend_connected: boolean;
  database_ready: boolean;
  stack: string;
  booking_paused: PauseReason | null;
};
type View = { messages: Msg[]; proposals: Proposal[]; topUps: TopUp[]; status: Status };

const PAUSED: Record<PauseReason, string> = {
  credits: "your Kitpier credits ran out",
  budget: "this month's project budget is used up",
  daily_limit: "today's spending limit is reached. It resets tomorrow",
  on_hold: "your account is on hold. Please contact Kitpier support",
};

// "What are you building?" → planner chat → stack card → Approve. Text is rendered as text, never HTML.
export default function Planner({
  projectId,
  description,
  autoStart,
  rev,
  onApproved,
}: {
  projectId: string;
  description: string;
  autoStart: boolean;
  rev: number;
  onApproved: () => void;
}) {
  const [view, setView] = useState<View | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const send = useCallback(
    async (message: string) => {
      setBusy(true);
      setError(null);
      try {
        setView(await api<View>(`/api/projects/${projectId}/plan`, { body: { message } }));
        setText("");
      } catch (e) {
        setError((e as Error).message);
      }
      setBusy(false);
    },
    [projectId],
  );

  useEffect(() => {
    api<View>(`/api/projects/${projectId}/plan`).then((v) => {
      setView(v);
      // Arriving from "Build my stack": plan the description straight away, once.
      if (autoStart && !started.current && v.messages.length === 0 && description) {
        started.current = true;
        send(description);
      }
    }, (e) => setError((e as Error).message));
  }, [projectId, autoStart, description, send, rev]);

  async function approve(proposalId: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/projects/${projectId}/stack/approve`, { body: { proposalId } });
      setView(await api<View>(`/api/projects/${projectId}/plan`));
      onApproved();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  async function paid() {
    setView(await api<View>(`/api/projects/${projectId}/plan`));
    onApproved();
  }

  const proposals = new Map(view?.proposals.map((p) => [p.id, p]));
  const topUps = new Map(view?.topUps.map((t) => [t.id, t]));
  const lastProposalMsg = [...(view?.messages ?? [])].reverse().find((m) => m.proposal_id && proposals.has(m.proposal_id));
  const lastTopUpMsg = [...(view?.messages ?? [])].reverse().find((m) => m.proposal_id && topUps.has(m.proposal_id));
  const paused = view?.status.booking_paused;

  return (
    <section className="space-y-4 rounded-2xl border border-line bg-card p-5">
      <div>
        <h2 className="font-semibold">What are you building?</h2>
        <p className="text-sm text-muted">The planner suggests services from the catalog. Nothing happens until you approve.</p>
      </div>
      {paused && (
        <div className="space-y-2 rounded-xl border border-danger p-3 text-sm">
          <p>
            <span className="font-semibold text-danger">Online booking is paused:</span> {PAUSED[paused]}.
          </p>
          {(paused === "credits" || paused === "budget") && (
            <button
              disabled={busy}
              onClick={() => send("My booking page is paused. What should I do?")}
              className="rounded-xl border border-line px-3 py-1 font-semibold disabled:opacity-50"
            >
              Ask the assistant
            </button>
          )}
        </div>
      )}
      <ul className="space-y-3">
        {view?.messages.map((m) => (
          <li key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
            <div className={m.role === "user" ? "max-w-[85%] rounded-2xl bg-paper px-4 py-2" : "space-y-3"}>
              <p className="whitespace-pre-wrap text-sm">{m.body}</p>
              {m.role === "assistant" && m.proposal_id === lastProposalMsg?.proposal_id && proposals.get(m.proposal_id!) && (
                <StackCard p={proposals.get(m.proposal_id!)!} status={view.status} busy={busy} onApprove={approve} />
              )}
              {m.role === "assistant" && m.proposal_id === lastTopUpMsg?.proposal_id && topUps.get(m.proposal_id!) && (
                <TopUpCard t={topUps.get(m.proposal_id!)!} projectId={projectId} onPaid={paid} />
              )}
            </div>
          </li>
        ))}
        {busy && <li className="text-sm text-muted">Planning…</li>}
      </ul>
      {error && <p className="text-sm text-danger">{error}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) send(text.trim());
        }}
        className="flex gap-2"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          placeholder={view?.messages.length ? "Reply to the planner" : "A booking site for my barbershop, budget $30/month"}
          className="flex-1 rounded-xl border border-line bg-paper px-3 py-2"
        />
        <button disabled={busy || !text.trim()} className="rounded-full bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50">
          Send
        </button>
      </form>
      <p className="text-xs text-muted">Replies are AI-generated and may be inaccurate.</p>
    </section>
  );
}

function StackCard({ p, status, busy, onApprove }: { p: Proposal; status: Status; busy: boolean; onApprove: (id: string) => void }) {
  const approved = p.status === "approved";
  const has = (slug: string) => p.items.some((i) => i.slug === slug);
  const steps = [
    has("booking-api") && { label: "Buy credits with PayPal", done: status.credits_usd > 0, href: "#credits" },
    has("supabase") && { label: "Connect Supabase", done: status.supabase_connected, href: "#accounts" },
    has("supabase") && { label: "Approve the database setup", done: status.database_ready, href: "#accounts" },
    has("resend") && { label: "Connect Resend", done: status.resend_connected, href: "#accounts" },
  ].filter(Boolean) as { label: string; done: boolean; href: string }[];

  return (
    <div className="space-y-3 rounded-2xl border border-accent p-4">
      <p className="font-semibold">{approved ? "Your stack (approved)" : "Proposed stack"}</p>
      <ul className="space-y-3">
        {p.items.map((i) => (
          <li key={i.slug} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{i.name}</span>
              <Badge type={i.type} />
              <span className="text-sm text-muted">{i.price}</span>
            </div>
            <p className="text-sm">{i.reason}</p>
          </li>
        ))}
      </ul>
      <div className="space-y-1 border-t border-line pt-3 text-sm">
        {p.enforced_micros > 0 && (
          <p>
            <span className="font-semibold">Kitpier, budget enforced:</span> about {usd(p.enforced_micros)}/month, capped at{" "}
            {usd(p.budget_cap_micros)}/month
          </p>
        )}
        {p.external_paid_micros > 0 && (
          <p>
            <span className="font-semibold">Your own accounts, estimate:</span> $0 on free tiers, from about{" "}
            {usd(p.external_paid_micros)}/month if you upgrade. Billed by each provider.
          </p>
        )}
        {p.enforced_micros > p.budget_cap_micros && <p className="text-danger">This estimate is above your budget.</p>}
      </div>
      {approved ? (
        <ol className="space-y-1 text-sm">
          {steps.map((s) => (
            <li key={s.label}>
              {s.done ? "✓" : "○"}{" "}
              <a href={s.href} className={s.done ? "text-muted line-through" : "underline"}>
                {s.label}
              </a>
            </li>
          ))}
        </ol>
      ) : (
        <button
          disabled={busy}
          onClick={() => onApprove(p.id)}
          className="rounded-full bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          Approve this stack
        </button>
      )}
    </div>
  );
}

function TopUpCard({ t, projectId, onPaid }: { t: TopUp; projectId: string; onPaid: () => void }) {
  return (
    <div className="space-y-3 rounded-2xl border border-accent p-4">
      <p className="font-semibold">{t.status === "paid" ? "Top-up paid ✓" : `Add ${usd(t.amount_micros)} with PayPal`}</p>
      <ul className="space-y-1 text-sm">
        <li>{usd(t.amount_micros)} of Kitpier credits{t.status === "paid" ? " added" : ""}</li>
        {t.budget_raise_micros > 0 && (
          <li>
            {t.status === "paid"
              ? `Your monthly budget went up by ${usd(t.budget_raise_micros)}`
              : `Your monthly budget goes up by ${usd(t.budget_raise_micros)}, so the credits can be used this month`}
          </li>
        )}
      </ul>
      {t.status === "paid" ? (
        <p className="text-sm text-accent">Bookings are back on.</p>
      ) : (
        <BuyCredits projectId={projectId} onPaid={onPaid} fixedPack={t.pack_id} topUpId={t.id} />
      )}
    </div>
  );
}
