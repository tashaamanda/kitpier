"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, usd } from "@/lib/client";
import { DRAFT_KEY } from "./BuildBox";

type P = { id: string; name: string; description: string };

export default function Dashboard({
  name,
  balanceMicros,
  projects,
  topBar,
}: {
  name: string;
  balanceMicros: number;
  projects: P[];
  topBar: React.ReactNode; // server-rendered TopBar (it reads the session)
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // Text typed into "What are you building?" before signing in.
  useEffect(() => {
    try {
      const d = sessionStorage.getItem(DRAFT_KEY);
      if (d) {
        sessionStorage.removeItem(DRAFT_KEY);
        setTimeout(() => setDraft(d), 0);
      }
    } catch {}
  }, []);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const { id } = await api<{ id: string }>("/api/projects", {
        body: { name: f.get("name"), description: f.get("description") || undefined },
      });
      router.push(`/projects/${id}${f.get("description") ? "?start=1" : ""}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="app-page">
      {topBar}
      <div className="app-inner">
        <header className="app-head">
          <div className="grid gap-3">
            <span className="micro text-muted">Signed in as {name}</span>
            <h1 className="app-title">
              Your <i>projects</i>
            </h1>
          </div>
          <div className="grid justify-items-end gap-2 text-right">
            <span className="micro text-muted">Credits</span>
            <span className="app-figure">{usd(balanceMicros)}</span>
            <button
              className="micro text-muted underline"
              onClick={async () => {
                await api("/api/auth/logout", { body: {} });
                router.push("/");
                router.refresh();
              }}
            >
              Sign out
            </button>
          </div>
        </header>
        <div className="grid">
          {projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="app-row">
              <span className="name">{p.name}</span>
              <span className="micro text-muted">Open ↗</span>
              {p.description && <span className="desc">{p.description}</span>}
            </Link>
          ))}
          {projects.length === 0 && <p className="text-muted">No projects yet. Start one below.</p>}
        </div>
        <form key={draft} onSubmit={create} className="kp-panel grid gap-4">
          <h2 className="m-0">New project</h2>
          <input
            name="name"
            required
            maxLength={80}
            defaultValue={draft.slice(0, 60)}
            placeholder="Project name (e.g. Barbershop bookings)"
            className="w-full kp-input"
          />
          <input
            name="description"
            maxLength={500}
            defaultValue={draft}
            placeholder="What are you building?"
            className="w-full kp-input"
          />
          {error && <p className="text-sm text-danger">{error}</p>}
          <div>
            <button className="kp-btn kp-btn-sm">Create project</button>
          </div>
        </form>
      </div>
    </main>
  );
}
