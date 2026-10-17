import { many, one, pool, type Db } from "./db";
import { HttpError } from "./session";

// Judge demo connection (SPEC §3b). Judges without Supabase or Resend accounts flip one switch:
// - bookings go to one shared table in Kitpier's demo Supabase project (a judges-only org, never the owner's),
//   every query scoped to the Kitpier project, rows older than 48 hours removed;
// - emails are captured into the project's Demo inbox instead of being delivered.

type Scope = { userId: string; projectId: string };
const KEEP_HOURS = 48;

/** One-time setup in the demo Supabase project (run by Kitpier's operator, not per judge). */
export const DEMO_BOOKINGS_SQL = `
create table if not exists public.demo_bookings (
  id          bigint generated always as identity primary key,
  project     text not null check (char_length(project) between 1 and 64),
  name        text not null check (char_length(name) between 1 and 100),
  contact     text not null check (char_length(contact) between 3 and 200),
  service     text not null check (char_length(service) between 1 and 100),
  starts_at   timestamptz not null,
  created_at  timestamptz not null default now(),
  unique (project, starts_at)
);
alter table public.demo_bookings enable row level security;
comment on table public.demo_bookings is 'Kitpier judge demo. Synthetic data only, removed after ${KEEP_HOURS} hours.';
`;

export function demoConfig() {
  const ref = process.env.DEMO_SUPABASE_REF;
  const key = process.env.DEMO_SUPABASE_SECRET_KEY;
  if (!ref || !key || !/^[a-z0-9]{20}$/.test(ref)) return null;
  return { url: `https://${ref}.supabase.co/rest/v1/demo_bookings`, key };
}

export async function isDemo(q: Db, s: Scope) {
  return !!(await one(q, "SELECT 1 FROM projects WHERE id = $1 AND user_id = $2 AND demo_connection", [s.projectId, s.userId]));
}

export async function setDemo(s: Scope, on: boolean) {
  if (on && !demoConfig()) throw new HttpError(503, "The demo connection isn't available right now");
  await pool.query("UPDATE projects SET demo_connection = $3 WHERE id = $1 AND user_id = $2", [s.projectId, s.userId, on]);
}

const headers = (key: string) => ({ apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" });

/** Best effort: drop every demo row past its keep time. Runs on each demo booking write. */
export async function sweepDemoBookings() {
  const d = demoConfig();
  if (!d) return;
  const before = new Date(Date.now() - KEEP_HOURS * 3_600_000).toISOString();
  await fetch(`${d.url}?created_at=lt.${before}`, { method: "DELETE", headers: headers(d.key), signal: AbortSignal.timeout(5_000) }).catch(() => {});
}

/** Stand-in for Resend on demo projects. The code is readable here on purpose: it's how a judge completes the flow. */
export async function captureMail(projectId: string, conversationId: string, kind: "code" | "confirmation", to: string, subject: string, body: string) {
  await pool.query(
    "INSERT INTO demo_mail (project_id, conversation_id, kind, to_address, subject, body) VALUES ($1, $2, $3, $4, $5, $6)",
    [projectId, conversationId, kind, to, subject, body],
  );
}

/** Owner-only (the route checks ownership): this project's demo bookings and captured emails. */
export async function demoInbox(s: Scope) {
  const mail = await many<{ id: number; kind: string; to_address: string; subject: string; body: string; created_at: string }>(
    pool,
    "SELECT id, kind, to_address, subject, body, created_at FROM demo_mail WHERE project_id = $1 ORDER BY id DESC LIMIT 20",
    [s.projectId],
  );
  const d = demoConfig();
  let bookings: { name: string; contact: string; service: string; starts_at: string }[] = [];
  if (d) {
    const q = new URLSearchParams([["select", "name,contact,service,starts_at"], ["project", `eq.${s.projectId}`], ["order", "created_at.desc"], ["limit", "20"]]);
    const r = await fetch(`${d.url}?${q}`, { headers: headers(d.key), signal: AbortSignal.timeout(5_000) }).catch(() => null);
    if (r?.ok) bookings = await r.json();
  }
  return { bookings, mail };
}

export { headers as supabaseHeaders };
