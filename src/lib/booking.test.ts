import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
type Tool = { name: string; run: (i: unknown) => Promise<string> };
let script: (tools: Tool[]) => AsyncGenerator<unknown>;
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    beta = { messages: { toolRunner: (p: { tools: Tool[] }) => script(p.tools) } };
  },
}));
process.env.ANTHROPIC_API_KEY = "test";
process.env.PLATFORM_DAILY_AI_CAP_MICROS = "5000000";
process.env.CREDENTIALS_MASTER_KEY = randomBytes(32).toString("base64");

const { pool } = await import("./db");
const { putCredential } = await import("./credentials");
const { post, postedBalance } = await import("./ledger");
const { bookingTurn } = await import("./booking");
const { reserveTurn, settleTurn, TURN_MAX_MICROS } = await import("./billing");

const A = { userId: "usr_a", projectId: "prj_a" };
const B = { userId: "usr_b", projectId: "prj_b" };
const REF = "abcdefghijklmnopqrst";
const TZ = "Asia/Makassar";
const msg = (text: string) => ({ content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 100 } });
const run = (tools: Tool[], name: string, input: unknown) => tools.find((t) => t.name === name)!.run(input);

// Fake Supabase REST for the managed bookings table.
let rows: { starts_at: string; name: string }[] = [];
function supabase(url: string, init?: RequestInit) {
  const u = new URL(url);
  if (!u.hostname.startsWith(REF)) return Promise.resolve(new Response("{}", { status: 404 }));
  if (init?.method === "POST") {
    const row = JSON.parse(String(init.body));
    if (rows.some((r) => r.starts_at === row.starts_at)) return Promise.resolve(new Response("{}", { status: 409 }));
    rows.push(row);
    return Promise.resolve(new Response(null, { status: 201 }));
  }
  return Promise.resolve(new Response(JSON.stringify(rows.map((r) => ({ starts_at: r.starts_at }))), { status: 200 }));
}

// A future Tuesday, in the window the slot rules allow.
function nextTuesday() {
  const d = new Date(Date.now() + 2 * 86_400_000);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

beforeEach(async () => {
  await pool.query(
    "TRUNCATE conversation_messages, conversations, widgets, usage_events, reservations, ledger_entries, user_balances, platform_daily_spend, provision_jobs, managed_supabase_refs, credentials, rate_limits, projects, users CASCADE",
  );
  for (const s of [A, B]) {
    await pool.query("INSERT INTO users (id, email, name, password_hash) VALUES ($1, $1, $1, 'x')", [s.userId]);
    await pool.query("INSERT INTO projects (id, user_id, name, budget_micros) VALUES ($1, $2, 'p', 30000000)", [s.projectId, s.userId]);
  }
  await pool.query("INSERT INTO managed_supabase_refs (user_id, project_id, ref, created_by_us) VALUES ($1, $2, $3, true)", [A.userId, A.projectId, REF]);
  await putCredential(A, "supabase_secret_key", "sb_secret_x", { ref: REF });
  await pool.query("INSERT INTO widgets (id, user_id, project_id, business_name, services, timezone) VALUES ('w_a', $1, $2, 'Sam''s Barbershop', '[\"Haircut\",\"Beard trim\"]', $3)", [A.userId, A.projectId, TZ]);
  await post(pool, { userId: A.userId, source: "capture:test", kind: "purchase", amountMicros: 10_000_000 });
  rows = [];
  vi.stubGlobal("fetch", vi.fn(supabase));
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => pool.end());

describe("booking turn", () => {
  it("a message costs $0.02; a booking adds $0.05 and lands in the business's Supabase", async () => {
    script = async function* () {
      yield msg("What would you like?");
    };
    const t1 = await bookingTurn("w_a", null, "hi", "1.1.1.1");
    expect(await postedBalance(pool, A.userId)).toBe(10_000_000 - 20_000);

    const date = nextTuesday();
    script = async function* (tools) {
      expect(await run(tools, "check_slots", { date })).toContain("10:00");
      expect(await run(tools, "create_booking", { name: "Sam (synthetic)", email: "sam@example.com", service: "haircut", date, time: "10:00" })).toMatch(/^Booked/);
      yield msg("You're booked!");
    };
    const t2 = await bookingTurn("w_a", t1.conversationId, "Yes, Tuesday 10am, Sam, sam@example.com", "1.1.1.1");
    expect(t2.booked).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Sam (synthetic)", service: "Haircut" });
    expect(await postedBalance(pool, A.userId)).toBe(10_000_000 - 20_000 - 70_000);

    // After the booking the chat is over: fixed reply, no model call, no charge.
    script = async function* () {
      throw new Error("model must not be called");
    };
    const t3 = await bookingTurn("w_a", t1.conversationId, "what shampoo?", "1.1.1.1");
    expect(t3).toMatchObject({ booked: true });
    expect(await postedBalance(pool, A.userId)).toBe(10_000_000 - 90_000);
  });

  it("one booking per conversation, taken slots refused, unknown services refused", async () => {
    const date = nextTuesday();
    script = async function* (tools) {
      await run(tools, "create_booking", { name: "A", email: "a@example.com", service: "Haircut", date, time: "10:00" });
      expect(await run(tools, "create_booking", { name: "A", email: "a@example.com", service: "Haircut", date, time: "11:00" })).toMatch(/already made a booking/);
      yield msg("ok");
    };
    await bookingTurn("w_a", null, "book", "1.1.1.1");
    script = async function* (tools) {
      expect(await run(tools, "create_booking", { name: "B", email: "b@example.com", service: "Haircut", date, time: "10:00" })).toMatch(/not available/);
      expect(await run(tools, "create_booking", { name: "B", email: "b@example.com", service: "Tattoo", date, time: "12:00" })).toMatch(/Unknown service/);
      yield msg("ok");
    };
    await bookingTurn("w_a", null, "book", "2.2.2.2");
    expect(rows).toHaveLength(1);
  });

  it("pauses gracefully with no credits: no model call, no charge", async () => {
    let called = false;
    script = async function* () {
      called = true;
      yield msg("x");
    };
    await pool.query("DELETE FROM ledger_entries");
    const r = await bookingTurn("w_a", null, "hi", "1.1.1.1");
    expect(r.paused).toBe(true);
    expect(called).toBe(false);
  });

  it("a conversation id from another widget is not reused", async () => {
    script = async function* () {
      yield msg("hi");
    };
    await pool.query("INSERT INTO widgets (id, user_id, project_id, business_name, services, timezone) VALUES ('w_b', $1, $2, 'B', '[\"x\"]', $3)", [B.userId, B.projectId, TZ]);
    await pool.query("INSERT INTO conversations (id, widget_id) VALUES ('cv_b', 'w_b')");
    const r = await bookingTurn("w_a", "cv_b", "hi", "1.1.1.1");
    expect(r.conversationId).not.toBe("cv_b");
  });
});

describe("billing", () => {
  it("stops at the project's monthly budget with 402", async () => {
    await pool.query("UPDATE projects SET budget_micros = $2 WHERE id = $1", [A.projectId, TURN_MAX_MICROS * 2]);
    const r1 = await reserveTurn(A, "cv", 1000);
    await settleTurn(r1.id); // no usage recorded → $0
    await post(pool, { userId: A.userId, projectId: A.projectId, source: "usage:x", kind: "usage", amountMicros: -TURN_MAX_MICROS });
    await reserveTurn(A, "cv", 1000);
    await expect(reserveTurn(A, "cv", 1000)).rejects.toMatchObject({ status: 402, code: "budget_exhausted" });
  });

  it("settles exactly once", async () => {
    const r = await reserveTurn(A, "cv", 1000);
    await pool.query("INSERT INTO usage_events (reservation_id, iteration, model, input_tokens, output_tokens, cost_micros) VALUES ($1, 0, 'm', 1, 1, 10)", [r.id]);
    await Promise.all([settleTurn(r.id), settleTurn(r.id), settleTurn(r.id)]);
    expect(await postedBalance(pool, A.userId)).toBe(10_000_000 - 20_000);
  });

  it("20 parallel turns against credits for 1 → exactly 1 reserves", async () => {
    await pool.query("DELETE FROM ledger_entries");
    await post(pool, { userId: A.userId, source: "capture:small", kind: "purchase", amountMicros: TURN_MAX_MICROS });
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => reserveTurn(A, "cv", 1000)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("expired reservations charge recorded usage only", async () => {
    const r = await reserveTurn(A, "cv", 1000);
    await pool.query("UPDATE reservations SET expires_at = now() - interval '1 second', booked = true WHERE id = $1", [r.id]);
    await reserveTurn(A, "cv2", 1000); // sweep runs here
    expect(await postedBalance(pool, A.userId)).toBe(10_000_000 - 50_000); // booking recorded, no message usage recorded
    const d = (await pool.query("SELECT exposure_micros FROM platform_daily_spend")).rows[0];
    expect(d.exposure_micros).toBe(1000);
  });
});
