"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";

export default function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      if (mode === "signup") {
        await api("/api/auth/signup", {
          body: { name: f.get("name"), email: f.get("email"), password: f.get("password") },
        });
      } else {
        await api("/api/auth/login", { body: { email: f.get("email"), password: f.get("password") } });
      }
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full rounded-xl border border-line bg-card px-4 py-3 outline-none focus:border-accent";

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-line bg-card p-5 shadow-sm">
      <div className="mb-2 grid grid-cols-2 rounded-xl bg-paper p-1 text-sm font-medium">
        {(["signup", "login"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-lg py-2 ${mode === m ? "bg-card shadow-sm" : "text-muted"}`}
          >
            {m === "signup" ? "Create account" : "Sign in"}
          </button>
        ))}
      </div>
      {mode === "signup" && <input name="name" required placeholder="Your name" className={input} />}
      <input name="email" type="email" required placeholder="Email" className={input} autoComplete="email" />
      <input
        name="password"
        type="password"
        required
        minLength={mode === "signup" ? 10 : 1}
        placeholder={mode === "signup" ? "Password (10+ characters)" : "Password"}
        className={input}
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
      />
      {mode === "login" && (
        <Link href="/forgot" className="block text-right text-sm text-muted underline">
          Forgot password?
        </Link>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      <button
        disabled={busy}
        className="w-full rounded-xl bg-accent py-3 font-semibold text-white hover:bg-accent-dark disabled:opacity-60"
      >
        {busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}
      </button>
    </form>
  );
}
