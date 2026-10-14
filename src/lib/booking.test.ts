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
const { bookingTurn, confirmBooking } = await import("./booking");
const { zonedToUtc } = await import("./slots");
const { claimBooking, reserveTurn, settleTurn, TURN_MAX_MICROS } = await import("./billing");

const A = { userId: "usr_a", projectId: "prj_a" };
const B = { userId: "usr_b", projectId: "prj_b" };
const REF = "abcdefghijklmnopqrst";
const TZ = "Asia/Makassar";
const msg = (text: string) => ({ content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 100 } });
const run = (tools: Tool[], name: string, input: unknown) => tools.find((t) => t.name === name)!.run(input);

// Fake Supabase REST for the managed bookings table.
let rows: { starts_at: string; name: string; contact?: string }[] = [];
function supabase(url: string, init?: RequestInit) {
  const u = new URL(url);
  if (!u.hostname.startsWith(REF)) return Promise.resolve(new Response("{}", { status: 404 }));
  if (init?.method === "POST") {
    const row = JSON.parse(String(init.body));
    if (rows.some((r) => r.starts_at === row.starts_at)) return Promise.resolve(new Response("{}", { status: 409 }));
    rows.push(row);
    return Promise.resolve(new Response(null, { status: 201 }));
  }
  // Honour eq. filters (exists check); range filters are left to the slot logic.
  const eq = [...u.searchParams].filter(([, v]) => v.startsWith("eq.")).map(([k, v]) => [k, v.slice(3)] as const);
  const match = rows.filter((r) => eq.every(([k, v]) => (k === "starts_at" ? Date.parse(r.starts_at) === Date.parse(v) : (r as Record<string, unknown>)[k] === v)));
  return Promise.resolve(new Response(JSON.stringify(match.map((r) => ({ starts_at: r.starts_at }))), { status: 200 }));
}

// A future Tuesday, in the window the slot rules allow.
function nextTuesday() {
  const d = new Date(Date.now() + 2 * 86_400_000);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

beforeEach(async () => {
  await pool.query(
    "TRUNCATE turn_requests, conversation_messages, conversations, widgets, usage_events, reservations, ledger_entries, user_balances, platform_daily_spend, provision_jobs, managed_supabase_refs, credentials, rate_limits, projects, users CASCADE",
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

let n = 0;
const rid = () => `req_${++n}_${Date.now()}`;
const turn = (text: string, conv: string | null = null, id = rid(), widget = "w_a") => bookingTurn(widget, conv, id, text, "1.1.1.1");
const confirm = (conv: string, pendingId: string, id = rid()) => confirmBooking("w_a", conv, pendingId, id, "1.1.1.1");
const propose = (date: string, time = "10:00") =>
  async function* (tools: Tool[]) {
    expect(await run(tools, "propose_booking", { name: "Sam (synthetic)", email: "Sam@Example.com", service: "haircut", date, time })).toMatch(/card is shown/);
    yield msg("Please check the card and press Confirm.");
  };

describe("booking turn", () => {
  it("the model can only propose; the customer's Confirm writes the booking ($0.02 per message, $0.05 per booking)", async () => {
    const date = nextTuesday();
    let names: string[] = [];
    script = async function* (tools) {
      names = tools.map((t) => t.name);
      yield* propose(date)(tools);
    };
    const t1 = await turn("Haircut Tuesday 10am, Sam, sam@example.com");
    expect(names.sort()).toEqual(["check_slots", "propose_booking"]); // no tool writes a booking
    expect(rows).toHaveLength(0);
    expect(t1.pending).toMatchObject({ service: "Haircut", time: "10:00", email: "sam@example.com" });
    expect(await postedBalance(pool, A.userId)).toBe(10_000_000 - 20_000);

    expect(await confirm(t1.conversationId, "pb_wrong")).toMatchObject({ booked: false });
    expect(rows).toHaveLength(0);

    const c = await confirm(t1.conversationId, t1.pending!.id);
    expect(c.booked).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Sam (synthetic)", service: "Haircut" });
    expect(await postedBalance(pool, A.userId)).toBe(10_000_000 - 20_000 - 50_000);

    // After the booking the chat is over: fixed reply, no model call, no charge.
    script = async function* () {
      throw new Error("model must not be called");
    };
    expect(await turn("what shampoo?", t1.conversationId)).toMatchObject({ booked: true });
    expect(await postedBalance(pool, A.userId)).toBe(10_000_000 - 70_000);
  });

  it("a retried message (same request id) returns the first result: one model call, one charge", async () => {
    let calls = 0;
    script = async function* () {
      calls++;
      yield msg("Hello!");
    };
    const id = rid();
    const a = await turn("hi", null, id);
    const b = await turn("hi", null, id);
    expect(b).toEqual(a);
    expect(calls).toBe(1);
    expect(await postedBalance(pool, A.userId)).toBe(10_000_000 - 20_000);
  });

  it("concurrent messages in one conversation run one at a time", async () => {
    script = async function* () {
      await new Promise((r) => setTimeout(r, 50));
      yield msg("Hello!");
    };
    const first = await turn("hi");
    const results = await Promise.allSettled([turn("a", first.conversationId), turn("b", first.conversationId), turn("c", first.conversationId)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason.status)).toEqual([409, 409]);
  });

  it("concurrent or repeated Confirms make one booking and one charge", async () => {
    const date = nextTuesday();
    script = propose(date);
    const t = await turn("book me");
    const results = await Promise.allSettled([confirm(t.conversationId, t.pending!.id), confirm(t.conversationId, t.pending!.id), confirm(t.conversationId, t.pending!.id)]);
    expect(results.filter((r) => r.status === "fulfilled" && r.value.booked)).toHaveLength(1);
    expect(await confirm(t.conversationId, t.pending!.id)).toMatchObject({ booked: true, reply: "You're already booked." });
    expect(rows).toHaveLength(1);
    expect(await postedBalance(pool, A.userId)).toBe(10_000_000 - 20_000 - 50_000);
  });

  it("recovers when Supabase saved the booking but the response was lost", async () => {
    const date = nextTuesday();
    script = propose(date);
    const t = await turn("book me");
    // The insert reaches Supabase, then the connection drops before we hear back.
    vi.mocked(fetch).mockImplementationOnce((u) => supabase(String(u))).mockImplementationOnce(async (u, init) => {
      await supabase(String(u), init);
      throw new TypeError("network lost");
    });
    await expect(confirm(t.conversationId, t.pending!.id)).rejects.toMatchObject({ status: 502 });
    expect(rows).toHaveLength(1);
    expect(await postedBalance(pool, A.userId)).toBe(10_000_000 - 20_000); // not charged for an unconfirmed result

    const again = await confirm(t.conversationId, t.pending!.id);
    expect(again.booked).toBe(true);
    expect(rows).toHaveLength(1); // found the saved row instead of inserting twice
    expect(await postedBalance(pool, A.userId)).toBe(10_000_000 - 20_000 - 50_000);
  });

  it("a slot taken by someone else in the meantime is refused at Confirm", async () => {
    const date = nextTuesday();
    script = propose(date);
    const t = await turn("book me");
    rows.push({ starts_at: zonedToUtc(date, 10, TZ).toISOString(), name: "Other" });
    const c = await confirm(t.conversationId, t.pending!.id);
    expect(c.booked).toBe(false);
    expect(c.reply).toMatch(/just took that time/);
    expect(await postedBalance(pool, A.userId)).toBe(10_000_000 - 20_000);
  });

  it("pauses gracefully with no credits: no model call, no charge", async () => {
    let called = false;
    script = async function* () {
      called = true;
      yield msg("x");
    };
    await pool.query("DELETE FROM ledger_entries");
    const r = await turn("hi");
    expect(r.paused).toBe(true);
    expect(called).toBe(false);
  });

  it("a conversation id from another widget is not reused", async () => {
    script = async function* () {
      yield msg("hi");
    };
    await pool.query("INSERT INTO widgets (id, user_id, project_id, business_name, services, timezone) VALUES ('w_b', $1, $2, 'B', '[\"x\"]', $3)", [B.userId, B.projectId, TZ]);
    await pool.query("INSERT INTO conversations (id, widget_id) VALUES ('cv_b', 'w_b')");
    const r = await turn("hi", "cv_b");
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

  it("an expired or settled reservation can't start a booking write", async () => {
    const r = await reserveTurn(A, "cv", 0);
    await settleTurn(r.id);
    expect(await claimBooking(r.id)).toBe(false);
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
