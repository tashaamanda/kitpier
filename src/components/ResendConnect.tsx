"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import type { Connection } from "./SupabaseConnect";

// Paste a full-access key once. The server mints a send-only key with it and never stores the original.
export default function ResendConnect({
  projectId,
  connection,
  onChange,
}: {
  projectId: string;
  connection?: Connection;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setKey("");
      setOpen(false);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  const domains = connection?.meta.verified_domains ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-display text-lg">Resend</p>
          {connection ? (
            <p className="text-sm text-muted">
              Connected with a send-only key ({connection.meta.key_name}).{" "}
              {domains.length
                ? `Sends from ${domains.join(", ")}.`
                : "Test mode: no verified domain, so emails can only go to your own Resend account address."}
            </p>
          ) : (
            <p className="text-sm text-muted">Booking confirmation emails, sent from your own account.</p>
          )}
        </div>
        {connection ? (
          <button
            disabled={busy}
            onClick={() => run(() => api("/api/connect/resend", { method: "DELETE", body: { projectId } }))}
            className="text-sm text-muted underline disabled:opacity-50"
          >
            Disconnect
          </button>
        ) : (
          !open && (
            <button
              onClick={() => setOpen(true)}
              className="kp-btn-outline"
            >
              Connect Resend
            </button>
          )
        )}
      </div>
      {!connection && open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => api("/api/connect/resend", { body: { projectId, apiKey: key } }));
          }}
          className="space-y-2 kp-note text-sm"
        >
          <ol className="list-decimal space-y-1 pl-5 text-muted">
            <li>In Resend, open API Keys and create a key with <b>Full access</b>.</li>
            <li>Paste it here. Kitpier uses it once to make a send-only key, then throws it away.</li>
            <li>Afterwards you can delete the full key in Resend. The send-only key keeps working.</li>
          </ol>
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="re_…"
            className="w-full kp-input"
          />
          <div className="flex gap-3">
            <button
              disabled={busy || !key.trim()}
              className="kp-btn kp-btn-sm"
            >
              {busy ? "Connecting…" : "Connect"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-muted underline">
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
