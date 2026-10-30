import { DEMO_DOMAIN, DEMO_DAYS } from "./account-expiry";
import { tx } from "./db";
import { deleteOldDemoBookings, deleteOldDemoMail } from "./demo";

// The daily cleanup behind what the demo pages promise (POST /api/cron/purge-demo, run by
// .github/workflows/purge-demo.yml): demo bookings and emails go after 48 hours, and demo accounts with everything they
// made go once they're DEMO_DAYS old (by then nothing can sign in to them: account-expiry.ts).

// Users cascade to projects, chats, demo mail, connections, tokens and approvals. The money tables don't cascade (on
// purpose, for real accounts), so they go first. Demo accounts only ever hold PayPal sandbox money.
const EXPIRED = `SELECT id FROM users WHERE email LIKE '%@${DEMO_DOMAIN}' AND created_at < now() - interval '${DEMO_DAYS} days'`;
const PURGE_EXPIRED = [
  `DELETE FROM usage_events WHERE reservation_id IN (SELECT id FROM reservations WHERE user_id IN (${EXPIRED}))`,
  `DELETE FROM reservations WHERE user_id IN (${EXPIRED})`,
  `DELETE FROM refund_requests WHERE user_id IN (${EXPIRED})`,
  `DELETE FROM ledger_entries WHERE user_id IN (${EXPIRED})`,
  `DELETE FROM orders WHERE user_id IN (${EXPIRED})`,
];

export async function purgeDemoData() {
  const { accounts, mail } = await tx(async (c) => {
    for (const q of PURGE_EXPIRED) await c.query(q);
    const accounts = (await c.query(`DELETE FROM users WHERE id IN (${EXPIRED})`)).rowCount ?? 0;
    return { accounts, mail: await deleteOldDemoMail(c) };
  });
  // Separate from the database work, so a Supabase outage doesn't undo it; the error still fails the run.
  await deleteOldDemoBookings();
  return { accounts, mail, bookings: "cleaned" as const };
}
