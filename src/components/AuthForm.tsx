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
      router.push("/");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const input =
    "w-full border-0 border-b border-line bg-transparent px-0 py-3 outline-none focus:border-ink placeholder:text-[#a3a39f]";

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="micro flex gap-6" role="tablist" aria-label="Account">
        {(["signup", "login"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`pb-1 ${mode === m ? "border-b border-ink text-ink" : "text-muted"}`}
          >
            {m === "signup" ? "Create account" : "Sign in"}
          </button>
        ))}
      </div>
      {mode === "signup" && <input name="name" required placeholder="Your name" className={input} autoComplete="name" />}
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
        <Link href="/forgot" className="justify-self-end text-sm text-muted underline">
          Forgot password?
        </Link>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      <button disabled={busy} className="kp-btn mt-2 w-full">
        {busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}
      </button>
    </form>
  );
}
