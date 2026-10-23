import { Suspense } from "react";
import { pool } from "@/lib/db";
import { postedBalance } from "@/lib/ledger";
import { listProjects } from "@/lib/projects";
import { currentUser } from "@/lib/session";
import Dashboard from "@/components/Dashboard";
import Landing from "@/components/Landing";

// Reads the session cookie, so it streams inside <Suspense> (Cache Components).
async function Home() {
  const user = await currentUser();
  if (!user) return <Landing />;
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
