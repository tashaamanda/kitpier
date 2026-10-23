"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import DatabaseSetup from "./DatabaseSetup";

export type Connection = {
  kind: string;
  meta: { orgs?: string[]; key_name?: string; verified_domains?: string[] };
  created_at: string;
};

// Connect stores access only. Nothing is created in Supabase until you approve a proposed change.
export default function SupabaseConnect({
  projectId,
  connection,
  onChange,
}: {
  projectId: string;
  connection?: Connection;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api<{ url: string }>("/api/connect/supabase", { body: { projectId } });
      window.location.assign(url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/connect/supabase", { method: "DELETE", body: { projectId } });
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold">Supabase</p>
          {connection ? (
            <p className="text-sm text-muted">
              Connected{connection.meta.orgs?.length ? ` · ${connection.meta.orgs.join(", ")}` : ""}. Kitpier only changes
              what you approve.
            </p>
          ) : (
            <p className="text-sm text-muted">Database for your app. Connecting creates nothing in your account.</p>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
        {connection ? (
          <button disabled={busy} onClick={disconnect} className="text-sm text-muted underline disabled:opacity-50">
            Disconnect
          </button>
        ) : (
          <button
            disabled={busy}
            onClick={connect}
            className="rounded-full border border-accent px-4 py-2 text-sm font-semibold text-accent disabled:opacity-50"
          >
            Connect Supabase
          </button>
        )}
      </div>
      {connection && <DatabaseSetup projectId={projectId} onReady={onChange} />}
    </div>
  );
}
