"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { envSnippet, handoffPrompt } from "@/lib/handoff";

type Key = { prefix: string; created_at: string; last_used_at: string | null } | null;

// "Use in your app": a secret key shown once as a .env snippet, plus a prompt for the builder's AI coding tool.
export default function AppHandoff({ projectId, businessName }: { projectId: string; businessName: string }) {
  const [key, setKey] = useState<Key>(null);
  const [fresh, setFresh] = useState<string | null>(null); // the full key, only in this page view
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  const load = useCallback(async () => setKey((await api<{ key: Key }>(`/api/projects/${projectId}/keys`)).key), [projectId]);
  useEffect(() => {
    const t = setTimeout(() => {
      setOrigin(window.location.origin);
      load().catch(() => {});
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  const create = () =>
    act(async () => {
      if (key && !window.confirm("Create a new key? The current key stops working right away.")) return;
      setFresh((await api<{ key: string }>(`/api/projects/${projectId}/keys`, { body: {} })).key);
    });
  const revoke = () =>
    act(async () => {
      if (!window.confirm("Turn off the key? Apps using it stop taking bookings.")) return;
      await api(`/api/projects/${projectId}/keys`, { method: "DELETE" });
      setFresh(null);
    });

  return (
    <section id="use-in-app" className="space-y-4 rounded-2xl border border-line bg-card p-5">
      <div>
        <h2 className="font-semibold">Use in your app</h2>
        <p className="text-sm text-muted">
          Put this booking chat on your own website. Your site&apos;s server talks to Kitpier with a secret key. Bookings still land
          in your Supabase, emails go through your Resend, and the same prices and budget apply.
        </p>
      </div>

      <div className="space-y-2 text-sm">
        <p className="font-semibold">1. Your secret key</p>
        {key ? (
          <p>
            ✓ Key <code className="rounded bg-paper px-1">mk_{key.prefix}_…</code> created {new Date(key.created_at).toLocaleDateString()}
            {key.last_used_at ? `, last used ${new Date(key.last_used_at).toLocaleString()}` : ", not used yet"}
          </p>
        ) : (
          <p className="text-muted">No key yet.</p>
        )}
        <div className="flex gap-3">
          <button disabled={busy} onClick={create} className="rounded-full bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50">
            {key ? "Create a new key" : "Create key"}
          </button>
          {key && (
            <button disabled={busy} onClick={revoke} className="text-muted underline">
              Turn off
            </button>
          )}
        </div>
        {fresh && (
          <div className="space-y-2 rounded-full border border-accent p-3">
            <p>
              <span className="font-semibold">Copy this into your app&apos;s .env file now.</span> It&apos;s shown only once. Keep it on
              your server: never in browser code or a public repo.
            </p>
            <Copyable text={envSnippet(origin, fresh)} />
          </div>
        )}
        {error && <p className="text-danger">{error}</p>}
      </div>

      <div className="space-y-2 text-sm">
        <p className="font-semibold">2. Paste this into your AI coding tool</p>
        <p className="text-muted">Claude Code, Cursor, Lovable or similar. It builds the booking chat into your site.</p>
        <Copyable text={handoffPrompt(businessName)} tall />
      </div>
    </section>
  );
}

function Copyable({ text, tall }: { text: string; tall?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <pre className={`overflow-auto whitespace-pre-wrap rounded-xl bg-paper p-3 text-xs ${tall ? "max-h-64" : ""}`}>{text}</pre>
      <button
        onClick={() => navigator.clipboard.writeText(text).then(() => (setCopied(true), setTimeout(() => setCopied(false), 2000)))}
        className="rounded-xl border border-line px-3 py-1 font-semibold"
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
    </div>
  );
}
