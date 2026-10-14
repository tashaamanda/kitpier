import Link from "next/link";
import { Suspense } from "react";
import { pool } from "@/lib/db";
import { postedBalance } from "@/lib/ledger";
import { listProjects } from "@/lib/projects";
import { currentUser } from "@/lib/session";
import AuthForm from "@/components/AuthForm";
import Dashboard from "@/components/Dashboard";

// Reads the session cookie, so it streams inside <Suspense> (Cache Components).
async function Home() {
  const user = await currentUser();
  if (!user) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
        <h1 className="text-4xl font-semibold">Kitpier</h1>
        <p className="mb-6 mt-2 text-lg text-muted">
          The app store for AI-built software. Discover, buy, and connect the services your app needs.
        </p>
        <Link href="/catalog" className="mb-6 font-semibold text-accent underline">
          Browse the catalog →
        </Link>
        <AuthForm />
      </main>
    );
  }
  const projects = (await listProjects(user)).map(({ id, name, description }) => ({ id, name, description }));
  return <Dashboard name={user.name} balanceMicros={await postedBalance(pool, user.id)} projects={projects} />;
}

export default function Page() {
  return (
    <Suspense fallback={<main className="p-10 text-muted">Loading…</main>}>
      <Home />
    </Suspense>
  );
}
