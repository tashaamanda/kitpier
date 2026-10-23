"use client";

import { useState } from "react";
import { api } from "@/lib/client";

type Msg = { role: "user" | "assistant"; body: string };
type Pending = { id: string; name: string; email: string; service: string; date: string; time: string };
type Result = { conversationId: string; reply: string; booked: boolean; paused?: boolean; pending?: Pending | null; emailAvailable?: boolean };

/** POST with a request id; on a network failure, retry once with the same id (the server returns the first result). */
async function call(path: string, payload: object): Promise<Result> {
  const requestId = crypto.randomUUID();
  const send = () =>
    fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, requestId }) });
  let res: Response;
  try {
    res = await send();
  } catch {
    await new Promise((r) => setTimeout(r, 1500));
    res = await send();
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Something went wrong. Please try again.");
  return json as Result;
}

// Hosted booking page. Same-origin calls only; no keys ever reach the browser. Text renders as text.
// The assistant can only prepare a booking; it is written when the customer presses Confirm.
export default function BookingChat({ widgetId, business, services }: { widgetId: string; business: string; services: string[] }) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", body: `Hi! I can book you in at ${business}. What would you like, and when?` }]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [emailAvailable, setEmailAvailable] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [demoMail, setDemoMail] = useState(false); // demo connection: the email shows in the owner's Demo inbox
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  function apply(r: Result) {
    setConversationId(r.conversationId);
    setMsgs((m) => [...m, { role: "assistant", body: r.reply }]);
    const next = r.booked || r.paused ? null : (r.pending ?? null);
    if (next?.id !== pending?.id) {
      setCodeSent(false); // a new card needs a new code
      setCode("");
    }
    setPending(next);
    if (r.emailAvailable !== undefined) setEmailAvailable(r.emailAvailable);
    if (r.booked || r.paused) setDone(true);
  }

  async function run(fn: () => Promise<Result>) {
    setBusy(true);
    try {
      apply(await fn());
    } catch (err) {
      setMsgs((m) => [...m, { role: "assistant", body: (err as Error).message }]);
    }
    setBusy(false);
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    const message = text.trim();
    if (!message) return;
    setMsgs((m) => [...m, { role: "user", body: message }]);
    setText("");
    setPending(null);
    run(() => call(`/r/${widgetId}/chat`, { conversationId, message }));
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold">{business}</h1>
        <p className="text-sm text-muted">Book online · {services.join(" · ")}</p>
      </header>
      <ul className="flex-1 space-y-3">
        {msgs.map((m, i) => (
          <li key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            <p
              className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
                m.role === "user" ? "bg-accent text-white" : "border border-line bg-card"
              }`}
            >
              {m.body}
            </p>
          </li>
        ))}
        {pending && (
          <li className="space-y-2 rounded-2xl border border-accent bg-card p-4 text-sm">
            <p className="font-semibold">Check your booking</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted">Service</dt>
              <dd>{pending.service}</dd>
              <dt className="text-muted">When</dt>
              <dd>
                {pending.date} at {pending.time}
              </dd>
              <dt className="text-muted">Name</dt>
              <dd>{pending.name}</dd>
              <dt className="text-muted">Email</dt>
              <dd>{pending.email}</dd>
            </dl>
            {emailAvailable && (
              <div className="space-y-2 border-t border-line pt-2">
                {!codeSent ? (
                  <button
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setCodeError(null);
                      try {
                        const r = await api<{ demo?: boolean }>(`/r/${widgetId}/code`, { body: { conversationId, pendingId: pending.id } });
                        setDemoMail(!!r.demo);
                        setCodeSent(true);
                      } catch (e) {
                        setCodeError((e as Error).message);
                      }
                      setBusy(false);
                    }}
                    className="text-accent underline disabled:opacity-50"
                  >
                    Email me a confirmation (we&apos;ll send a code first)
                  </button>
                ) : (
                  <label className="block space-y-1">
                    <span className="text-muted">
                      {demoMail
                        ? "Demo: the code email is in the Demo inbox on this business's Kitpier project page."
                        : `Enter the 6-digit code we sent to ${pending.email}`}
                    </span>
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      className="w-32 rounded-xl border border-line bg-paper px-3 py-2 tracking-widest"
                    />
                  </label>
                )}
                {codeError && <p className="text-danger">{codeError}</p>}
              </div>
            )}
            <button
              disabled={busy || (codeSent && code.length > 0 && code.length < 6)}
              onClick={() => run(() => call(`/r/${widgetId}/confirm`, { conversationId, pendingId: pending.id, code: code.length === 6 ? code : undefined }))}
              className="rounded-full bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50"
            >
              {code.length === 6 ? "Confirm and email me" : "Confirm booking"}
            </button>
            <p className="text-xs text-muted">Something wrong? Just type the change below.</p>
          </li>
        )}
        {busy && <li className="text-sm text-muted">One moment…</li>}
      </ul>
      {!done ? (
        <form onSubmit={send} className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={500}
            placeholder="e.g. A haircut on Tuesday at 10am"
            className="flex-1 rounded-xl border border-line bg-card px-3 py-2"
          />
          <button disabled={busy || !text.trim()} className="rounded-full bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50">
            Send
          </button>
        </form>
      ) : (
        <button onClick={() => location.reload()} className="text-sm text-muted underline">
          Start a new booking
        </button>
      )}
      <p className="text-xs text-muted">
        Replies are AI-generated and may be inaccurate. Please don&apos;t share health, payment or other sensitive details. Powered by
        Kitpier Booking API.
      </p>
    </main>
  );
}
