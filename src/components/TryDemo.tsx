"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";

// The first row of the judges' fast path: one click, then straight into this browser's own demo project.
export function TryDemoRow() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const { projectId } = await api<{ projectId: string }>("/api/judges/demo", { body: {} });
      router.push(`/projects/${projectId}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <li className="ct-row ct-static">
      <span className="name">1. Start your demo</span>
      <button aria-busy={busy} disabled={busy} onClick={start} className="kp-btn kp-btn-xs">
        {busy ? "Setting up…" : "Try the demo"}
      </button>
      <span className="tag">
        One click, no password. You get your own Sam&apos;s Barbershop, already planned and set up on the demo connection:
        no Supabase or Resend account needed, and nothing is shared with other judges.
      </span>
      {error && (
        <span className="tag text-danger" role="alert">
          {error}
        </span>
      )}
    </li>
  );
}

// /judges/resume#<key>: signs this browser back into the demo the key belongs to, then opens its project.
export function ResumeDemo() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false); // once: the first run clears the key from the address bar

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const key = window.location.hash.slice(1);
    window.history.replaceState(null, "", window.location.pathname); // don't leave the key in the address bar
    if (!key) {
      setTimeout(() => setError("This link is missing its key. Copy the full private link from your demo."), 0);
      return;
    }
    api<{ projectId: string }>("/api/judges/resume", { body: { key } }).then(
      ({ projectId }) => router.replace(`/projects/${projectId}`),
      (e) => setError((e as Error).message),
    );
  }, [router]);

  return error ? (
    <div className="grid gap-3">
      <p className="ct-lead" role="alert">
        {error}
      </p>
      <p className="ct-lead">
        <Link href="/judges" className="underline">
          Start a new demo
        </Link>{" "}
        instead.
      </p>
    </div>
  ) : (
    <p className="ct-lead">Opening your demo…</p>
  );
}
