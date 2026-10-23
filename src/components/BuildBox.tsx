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
        router.push("/signin");
        return;
      }
      const { id } = await api<{ id: string }>("/api/projects", {
        body: { name: description.slice(0, 60), description },
      });
      router.push(`/projects/${id}?start=1`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="ct-build" id="build">
      <label htmlFor="build-text">What are you building?</label>
      <textarea
        id="build-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={500}
        rows={2}
        placeholder="An AI receptionist for my hair salon that talks to customers, books appointments and sends confirmations."
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-5">
        <button aria-busy={busy} disabled={busy || !text.trim()} className="kp-btn">
          {busy ? "Planning…" : "Build my stack"}
        </button>
        <span className="micro text-muted">Nothing is bought until you approve</span>
      </div>
    </form>
  );
}
