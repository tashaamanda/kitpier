import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));

// Fake tool runner: lets each test script what the "model" does with the real tools.
type Tool = { name: string; run: (i: unknown) => Promise<string> };
let script: (tools: Tool[]) => AsyncGenerator<unknown>;
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    beta = { messages: { toolRunner: (p: { tools: Tool[] }) => script(p.tools) } };
  },
}));
process.env.ANTHROPIC_API_KEY = "test";
process.env.PLATFORM_DAILY_AI_CAP_MICROS = "1000000";

const { pool } = await import("./db");
const { runPlanner, PLANNER_RESERVE } = await import("./planner");
const { approveStack, listProposals, proposeStack } = await import("./stack");
const { reservePlatform } = await import("./platform");

const A = { userId: "usr_a", projectId: "prj_a" };
const B = { userId: "usr_b", projectId: "prj_b" };
const msg = (text: string, input = 1000, output = 200) => ({
  content: [{ type: "text", text }],
  stop_reason: "end_turn",
  usage: { input_tokens: input, output_tokens: output },
});
const run = (tools: Tool[], name: string, input: unknown) => tools.find((t) => t.name === name)!.run(input);
const day = async () => (await pool.query("SELECT * FROM platform_daily_spend")).rows[0];

beforeEach(async () => {
  await pool.query("TRUNCATE plan_messages, stack_proposals, platform_usage, platform_daily_spend, rate_limits, credentials, projects, users CASCADE");
  for (const s of [A, B]) {
    await pool.query("INSERT INTO users (id, email, name, password_hash) VALUES ($1, $1, $1, 'x')", [s.userId]);
    await pool.query("INSERT INTO projects (id, user_id, name) VALUES ($1, $2, 'p')", [s.projectId, s.userId]);
  }
});
afterAll(() => pool.end());

describe("stack proposals", () => {
  it("prices come from the server, and coming-soon or unknown listings are refused", async () => {
    const p = await proposeStack(A, {
      items: [{ slug: "booking-api", reason: "r" }, { slug: "supabase", reason: "r" }, { slug: "resend", reason: "r" }],
      monthly_budget_usd: 30,
    });
    expect(p.enforced_micros).toBe(400 * 20_000 + 60 * 50_000); // $11 typical month
    expect(p.external_paid_from_micros).toBe(45_000_000);
    expect(p.budget_cap_micros).toBe(30_000_000);
    await expect(proposeStack(A, { items: [{ slug: "vercel", reason: "r" }] })).rejects.toThrow(/coming soon/);
    await expect(proposeStack(A, { items: [{ slug: "nope", reason: "r" }] })).rejects.toThrow(/Unknown/);
  });

  it("only the owner can approve, once, and approval sets the project budget", async () => {
    const p = await proposeStack(A, { items: [{ slug: "booking-api", reason: "r" }] });
    await expect(approveStack({ userId: B.userId, projectId: A.projectId }, p.id)).rejects.toThrow(/no longer/);
    await expect(approveStack(B, p.id)).rejects.toThrow(/no longer/);
    expect((await approveStack(A, p.id)).budget_micros).toBe(17_000_000); // 1.5 × $11, rounded up
    await expect(approveStack(A, p.id)).rejects.toThrow(/no longer/);
    expect((await pool.query("SELECT budget_micros FROM projects WHERE id = $1", [A.projectId])).rows[0].budget_micros).toBe(17_000_000);
    expect(await listProposals(pool, B)).toEqual([]);
  });
});

describe("planner", () => {
  it("a planner turn can propose but has no tool that approves, buys or connects", async () => {
    let names: string[] = [];
    script = async function* (tools) {
      names = tools.map((t) => t.name);
      await run(tools, "propose_stack", { items: [{ slug: "booking-api", reason: "Takes bookings" }] });
      yield msg("Here is your stack.");
    };
    await runPlanner(A, "Booking site for my barbershop");
    expect(names.sort()).toEqual(["estimate_cost", "get_project_status", "propose_stack", "search_catalog"]);
    const msgs = (await pool.query("SELECT role, proposal_id FROM plan_messages ORDER BY id")).rows;
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[1].proposal_id).toMatch(/^stk_/);
    const [p] = await listProposals(pool, A);
    expect(p.status).toBe("proposed");
    expect((await pool.query("SELECT budget_micros FROM projects WHERE id = $1", [A.projectId])).rows[0].budget_micros).toBeNull();
  });

  it("meters every response against the platform day and settles exactly once", async () => {
    script = async function* () {
      yield msg("one", 1000, 100);
      yield msg("two", 2000, 300);
    };
    await runPlanner(A, "hi");
    const d = await day();
    expect(d.reserved_micros).toBe(0);
    expect(d.committed_micros).toBe(1000 + 500 + 2000 + 1500); // Haiku list price, micro-USD per token
    const u = (await pool.query("SELECT state, iterations FROM platform_usage")).rows[0];
    expect(u).toEqual({ state: "settled", iterations: 2 });
  });

  it("refuses with 503 before any model call once the daily cap is reached", async () => {
    let called = false;
    script = async function* () {
      called = true;
      yield msg("x");
    };
    await pool.query("INSERT INTO platform_daily_spend (day, committed_micros) VALUES (CURRENT_DATE, $1)", [1_000_000 - PLANNER_RESERVE + 1]);
    await expect(runPlanner(A, "hi")).rejects.toMatchObject({ status: 503 });
    expect(called).toBe(false);
  });

  it("a run that never settles is swept: recorded cost committed, the rest counted as exposure", async () => {
    const r = await reservePlatform(A.userId, A.projectId, 100_000);
    await pool.query("UPDATE platform_usage SET cost_micros = 30000, expires_at = now() - interval '1 second' WHERE id = $1", [r.id]);
    await reservePlatform(A.userId, A.projectId, 1);
    const d = await day();
    expect([d.reserved_micros, d.committed_micros, d.exposure_micros]).toEqual([1, 30_000, 70_000]);
  });

  it("a model error still settles the reservation", async () => {
    script = async function* () {
      yield msg("partial");
      throw Object.assign(new Error("overloaded"), { status: 529 });
    };
    await expect(runPlanner(A, "hi")).rejects.toMatchObject({ status: 502 });
    expect((await day()).reserved_micros).toBe(0);
  });
});
