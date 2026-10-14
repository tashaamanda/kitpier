"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, usd } from "@/lib/client";

type P = { id: string; name: string; description: string };

export default function Dashboard({
  name,
  balanceMicros,
  projects,
}: {
  name: string;
  balanceMicros: number;
  projects: P[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const { id } = await api<{ id: string }>("/api/projects", {
        body: { name: f.get("name"), description: f.get("description") || undefined },
      });
      router.push(`/projects/${id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-5 py-10">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted">Signed in as {name}</p>
          <h1 className="text-3xl font-semibold">Your projects</h1>
          <Link href="/catalog" className="text-sm text-accent underline">
            Browse the catalog
          </Link>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted">Credits</p>
          <p className="text-2xl font-semibold">{usd(balanceMicros)}</p>
          <button
            className="text-sm text-muted underline"
            onClick={async () => {
              await api("/api/auth/logout", { body: {} });
              router.refresh();
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <ul className="space-y-2">
        {projects.map((p) => (
          <li key={p.id}>
            <Link
              href={`/projects/${p.id}`}
              className="block rounded-2xl border border-line bg-card p-4 hover:border-accent"
            >
              <p className="font-semibold">{p.name}</p>
              {p.description && <p className="text-sm text-muted">{p.description}</p>}
            </Link>
          </li>
        ))}
        {projects.length === 0 && <li className="text-muted">No projects yet.</li>}
      </ul>
      <form onSubmit={create} className="space-y-2 rounded-2xl border border-line bg-card p-4">
        <input
          name="name"
          required
          maxLength={80}
          placeholder="Project name (e.g. Barbershop bookings)"
          className="w-full rounded-xl border border-line bg-paper px-3 py-2"
        />
        <input
          name="description"
          maxLength={500}
          placeholder="What are you building?"
          className="w-full rounded-xl border border-line bg-paper px-3 py-2"
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <button className="rounded-xl bg-accent px-4 py-2 font-semibold text-white hover:bg-accent-dark">
          New project
        </button>
      </form>
    </main>
  );
}
