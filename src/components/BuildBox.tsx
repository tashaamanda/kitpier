"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";

export const DRAFT_KEY = "kitpier:draft";

// "What are you building?" Starts a project from the description; the planning agent works inside that project.
// Signed-out visitors keep their text in sessionStorage and pick it up after signing in.
export default function BuildBox() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const description = text.trim();
    if (!description) return;
    setBusy(true);
    setError(null);
    try {
      const me = await fetch("/api/me");
      if (me.status === 401) {
        try {
          sessionStorage.setItem(DRAFT_KEY, description);
        } catch {}
        router.push("/");
        return;
      }
      const { id } = await api<{ id: string }>("/api/projects", {
        body: { name: description.slice(0, 60), description },
      });
      router.push(`/projects/${id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-line bg-card p-5 shadow-sm">
      <label htmlFor="build" className="block text-lg font-semibold">
        What are you building?
      </label>
      <textarea
        id="build"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={500}
        rows={3}
        placeholder="An AI receptionist for my hair salon that talks to customers, books appointments and sends confirmations."
        className="w-full resize-none rounded-xl border border-line bg-paper px-4 py-3 outline-none focus:border-accent"
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <button
        disabled={busy || !text.trim()}
        className="rounded-xl bg-accent px-5 py-2.5 font-semibold text-white hover:bg-accent-dark disabled:opacity-50"
      >
        Build my stack
      </button>
    </form>
  );
}
