"use client";

import { useState } from "react";
import { api } from "@/lib/client";

type Msg = { role: "user" | "assistant"; body: string };

// Hosted booking page. Calls same-origin /r/{id}/chat; no keys ever reach the browser. Text renders as text.
export default function BookingChat({ widgetId, business, services }: { widgetId: string; business: string; services: string[] }) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "assistant", body: `Hi! I can book you in at ${business}. What would you like, and when?` },
  ]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const message = text.trim();
    if (!message) return;
    setMsgs((m) => [...m, { role: "user", body: message }]);
    setText("");
    setBusy(true);
    try {
      const r = await api<{ conversationId: string; reply: string; booked: boolean; paused?: boolean }>(`/r/${widgetId}/chat`, {
        body: { conversationId, message },
      });
      setConversationId(r.conversationId);
      setMsgs((m) => [...m, { role: "assistant", body: r.reply }]);
      if (r.booked || r.paused) setDone(true);
    } catch (err) {
      setMsgs((m) => [...m, { role: "assistant", body: (err as Error).message }]);
    }
    setBusy(false);
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
        {busy && <li className="text-sm text-muted">Typing…</li>}
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
          <button disabled={busy || !text.trim()} className="rounded-xl bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50">
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
