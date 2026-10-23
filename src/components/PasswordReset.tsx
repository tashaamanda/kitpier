"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";

const input = "w-full kp-input";
const button = "w-full kp-btn";
const card = "grid gap-4"; // same open form layout as sign-in (no box)

export function ForgotForm() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api("/api/auth/forgot", { body: { email: new FormData(e.currentTarget).get("email") } });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className={card}>
        <p>If there&apos;s a Kitpier account for that email, a reset link is on its way. It works once, for 30 minutes.</p>
        <p className="text-sm text-muted">Nothing after a few minutes? Check your spam folder.</p>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className={card}>
      <input name="email" type="email" required placeholder="Email" className={input} autoComplete="email" />
      {error && <p className="text-sm text-danger">{error}</p>}
      <button aria-busy={busy} disabled={busy} className={button}>
        {busy ? "…" : "Email me a reset link"}
      </button>
    </form>
  );
}

// The token lives in the URL fragment; read it once, then drop it from the address bar and history.
let fragmentToken: string | undefined;
function readFragmentToken() {
  if (fragmentToken === undefined) {
    fragmentToken = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    history.replaceState(null, "", window.location.pathname);
  }
  return fragmentToken;
}
const noSubscribe = () => () => {};

export function ResetForm() {
  const router = useRouter();
  const token = useSyncExternalStore(noSubscribe, readFragmentToken, () => null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("confirm")) return setError("The two passwords don't match");
    setBusy(true);
    try {
      await api("/api/auth/reset", { body: { token, password: f.get("password") } });
      router.push("/");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (token === null) return null;
  if (!token) {
    return (
      <div className={card}>
        <p>This reset link is incomplete. Open the link from your email again, or ask for a new one.</p>
        <Link href="/forgot" className="underline">
          Ask for a new link
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className={card}>
      <input
        name="password"
        type="password"
        required
        minLength={10}
        placeholder="New password (10+ characters)"
        className={input}
        autoComplete="new-password"
      />
      <input name="confirm" type="password" required minLength={10} placeholder="New password again" className={input} autoComplete="new-password" />
      {error && (
        <p className="text-sm text-danger">
          {error}{" "}
          {error.includes("expired") && (
            <Link href="/forgot" className="underline">
              Ask for a new link
            </Link>
          )}
        </p>
      )}
      <button aria-busy={busy} disabled={busy} className={button}>
        {busy ? "…" : "Set new password"}
      </button>
    </form>
  );
}
