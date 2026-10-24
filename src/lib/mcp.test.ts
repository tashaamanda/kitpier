import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The MCP server is called the way Claude Code calls it: JSON-RPC over POST /mcp with the agent's Bearer token.
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined, set: () => {}, delete: () => {} })),
  headers: vi.fn(async () => new Headers({ origin: "http://localhost:3005", "x-forwarded-for": "203.0.113.9" })),
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => {} }));
process.env.APP_URL = "http://localhost:3005";
process.env.SESSION_SECRET = "x".repeat(32);

const { pool } = await import("./db");
const { startLink, decideLink, pollLink } = await import("./agents");
const { proposeStack } = await import("./stack");
const { requireHttps } = await import("./http");
const mcp = await import("@/app/mcp/route");

const A = { userId: "usr_a", projectId: "prj_a" };
const B = { userId: "usr_b", projectId: "prj_b" };

beforeEach(async () => {
  await pool.query("TRUNCATE approval_links, key_grants, agent_links, agent_tokens, pending_actions, stack_proposals, rate_limits, projects, users CASCADE");
  for (const s of [A, B]) {
    await pool.query("INSERT INTO users (id, email, name, password_hash) VALUES ($1, $1, $1, 'x')", [s.userId]);
    await pool.query("INSERT INTO projects (id, user_id, name, demo_connection) VALUES ($1, $2, $3, true)", [s.projectId, s.userId, `Project ${s.userId}`]);
  }
});
afterAll(() => pool.end());

async function tokenFor(s = A) {
  const l = await startLink({ clientName: "Claude Code" });
  await decideLink({ id: s.userId, email: s.userId, name: s.userId, frozen: false }, l.code, { allow: true, projectId: s.projectId });
  const r = await pollLink(l.poll_token);
  if (r.status !== "approved") throw new Error(r.status);
  return r.token;
}

let rpcId = 0;
async function rpc(token: string | null, method: string, params: object = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await mcp.POST(new Request("http://localhost:3005/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) }));
  return { status: res.status, cache: res.headers.get("cache-control"), json: res.status === 200 ? await res.json() : null };
}
const call = async (token: string, name: string, args: object = {}) => {
  const r = await rpc(token, "tools/call", { name, arguments: args });
  const out = r.json.result;
  return { isError: !!out.isError, data: JSON.parse(out.content[0].text) };
};

describe("MCP server", () => {
  it("refuses requests without a valid agent token", async () => {
    expect((await rpc(null, "tools/list")).status).toBe(401);
    expect((await rpc("ka_0123456789_" + "A".repeat(43), "tools/list")).status).toBe(401);
  });

  it("lists read-and-propose tools only: nothing approves, pays or connects", async () => {
    const r = await rpc(await tokenFor(), "tools/list");
    const names: string[] = r.json.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("get_approval_link");
    expect(names.filter((n) => /approve_|pay|connect|confirm/.test(n))).toEqual([]);
    expect(r.cache).toBe("no-store");
  });

  it("each token sees only its own project", async () => {
    const ta = await tokenFor(A);
    await proposeStack(B, { items: [{ slug: "booking-api", reason: "x" }] });
    const view = await call(ta, "project_status");
    expect(view.data.project.id).toBe(A.projectId);
    expect(view.data.proposals).toEqual([]);
  });

  it("returns refusals as tool errors, not crashes", async () => {
    const t = await tokenFor(A);
    const r = await call(t, "collect_api_key");
    expect(r.isError).toBe(true);
    expect(r.data.code).toBe("not_approved");
    const bad = await call(t, "propose_booking_page", { business_name: "Fade House", services: ["Cut"], timezone: "Mars/Olympus" });
    expect(bad).toMatchObject({ isError: true, data: { error: "Unknown timezone" } });
  });

  it("the agent flow works through MCP: propose, then a link for the person", async () => {
    const t = await tokenFor(A);
    await proposeStack({ ...A }, { items: [{ slug: "booking-api", reason: "x" }] });
    const page = await call(t, "propose_booking_page", { business_name: "Fade House", services: ["Cut"], timezone: "America/New_York" });
    expect(page.isError).toBe(false);
    const link = await call(t, "get_approval_link");
    expect(link.data.items).toEqual(["stack", "booking_page"]);
    const state = await call(t, "check_approval", { approval_id: link.data.approval_id });
    expect(state.data.items.map((i: { state: string }) => i.state)).toEqual(["pending", "pending"]);
  });
});

describe("HTTPS for agent traffic", () => {
  const req = (proto?: string, url = "http://kitpier.test/mcp") => new Request(url, { headers: proto ? { "x-forwarded-proto": proto } : {} });
  it("refuses plain HTTP in production; localhost dev is exempt", () => {
    expect(() => requireHttps(req("http"), { NODE_ENV: "production" })).toThrow(/HTTPS/);
    expect(() => requireHttps(req(undefined), { NODE_ENV: "production" })).toThrow(/HTTPS/);
    expect(() => requireHttps(req("https"), { NODE_ENV: "production" })).not.toThrow();
    expect(() => requireHttps(req(undefined, "https://kitpier.com/mcp"), { NODE_ENV: "production" })).not.toThrow();
    expect(() => requireHttps(req("http"), { NODE_ENV: "development" })).not.toThrow();
  });
});
