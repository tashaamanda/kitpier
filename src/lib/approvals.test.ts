import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// No browser session: cookies are empty, so routes can only authenticate with an agent's Bearer token.
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined, set: () => {}, delete: () => {} })),
  headers: vi.fn(async () => new Headers({ origin: "http://localhost:3005", "x-forwarded-for": "203.0.113.9" })),
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => {} }));
process.env.APP_URL = "http://localhost:3005";
process.env.SESSION_SECRET = "x".repeat(32);

const { pool } = await import("./db");
const { startLink, decideLink, pollLink, requireAgentToken } = await import("./agents");
const { createKey } = await import("./apikeys");
const { requestKey, claimKey, createApprovalLink, approvalView, decideLinkItem } = await import("./approvals");
const { proposeStack } = await import("./stack");
const { proposeWidget } = await import("./booking");
const { proposeTopUp } = await import("./topup");

const A = { userId: "usr_a", projectId: "prj_a" };
const B = { userId: "usr_b", projectId: "prj_b" };
const user = (id: string) => ({ id, email: id, name: id, frozen: false });
const spec = { business_name: "Fade House", services: ["Haircut"], timezone: "America/New_York" };

beforeEach(async () => {
  await pool.query(
    "TRUNCATE top_up_proposals, approval_links, key_grants, agent_links, agent_tokens, api_keys, widgets, pending_actions, stack_proposals, rate_limits, projects, users CASCADE",
  );
  for (const s of [A, B]) {
    await pool.query("INSERT INTO users (id, email, name, password_hash) VALUES ($1, $1, $1, 'x')", [s.userId]);
    await pool.query("INSERT INTO projects (id, user_id, name, demo_connection) VALUES ($1, $2, 'p', true)", [s.projectId, s.userId]);
  }
});
afterAll(() => pool.end());

const stack = (s = A) => proposeStack(s, { items: [{ slug: "booking-api", reason: "bookings" }] });

async function tokenFor(s = A) {
  const l = await startLink({ clientName: "Claude Code" });
  await decideLink(user(s.userId), l.code, { allow: true, projectId: s.projectId });
  const r = await pollLink(l.poll_token);
  if (r.status !== "approved") throw new Error(r.status);
  return r.token;
}

describe("approval links", () => {
  it("snapshot what's pending; an item changed afterwards can't be approved from the link", async () => {
    await stack();
    const link = await createApprovalLink(A);
    expect(link.items).toEqual(["stack"]);
    expect(link.url).toBe(`http://localhost:3005/approve/${link.approval_id}`);

    await stack(); // the agent re-plans: a new proposal supersedes the one on the link
    expect((await approvalView(A.userId, link.approval_id)).items[0].state).toBe("stale");
    await expect(decideLinkItem(A.userId, link.approval_id, 0, true)).rejects.toMatchObject({ status: 409, code: "stale" });

    const fresh = await createApprovalLink(A);
    await decideLinkItem(A.userId, fresh.approval_id, 0, true);
    expect((await approvalView(A.userId, fresh.approval_id)).items[0].state).toBe("approved");
    const budget = await pool.query("SELECT budget_micros FROM projects WHERE id = $1", [A.projectId]);
    expect(budget.rows[0].budget_micros).toBeGreaterThan(0);
  });

  it("only the owner can see or decide; expired links can't be used", async () => {
    await stack();
    const link = await createApprovalLink(A);
    await expect(approvalView(B.userId, link.approval_id)).rejects.toMatchObject({ status: 404 });
    await expect(decideLinkItem(B.userId, link.approval_id, 0, true)).rejects.toMatchObject({ status: 404 });
    await expect(approvalView(A.userId, link.approval_id, B.projectId)).rejects.toMatchObject({ status: 404 });
    await pool.query("UPDATE approval_links SET expires_at = now() - interval '1 second'");
    await expect(decideLinkItem(A.userId, link.approval_id, 0, true)).rejects.toMatchObject({ status: 409 });
  });

  it("a top-up card states the budget change and goes stale if the budget changes first", async () => {
    await pool.query("UPDATE projects SET budget_micros = 17000000 WHERE id = $1", [A.projectId]);
    await proposeTopUp(A, "p10");
    const link = await createApprovalLink(A);
    const item = (await approvalView(A.userId, link.approval_id)).items[0];
    expect(item).toMatchObject({ kind: "top_up", state: "pending", details: { budget_before_micros: 17000000, budget_after_micros: 27000000 } });
    await pool.query("UPDATE projects SET budget_micros = 20000000 WHERE id = $1", [A.projectId]);
    expect((await approvalView(A.userId, link.approval_id)).items[0].state).toBe("stale");
  });

  it("nothing pending → no link", async () => {
    await expect(createApprovalLink(A)).rejects.toMatchObject({ status: 409, code: "nothing_pending" });
  });
});

describe("Booking API keys for agents", () => {
  // An agent connected to project A, as the agent routes would scope it.
  async function agentOn(s = A) {
    const t = await tokenFor(s);
    const { tokenId } = await requireAgentToken(new Request("http://x", { headers: { authorization: `Bearer ${t}` } }));
    return { ...s, agentTokenId: tokenId };
  }
  async function approvedKey(agent: Awaited<ReturnType<typeof agentOn>>) {
    await proposeWidget(agent, spec);
    await requestKey(agent);
    const link = await createApprovalLink(agent);
    await decideLinkItem(agent.userId, link.approval_id, 0, true); // booking page goes live
    await decideLinkItem(agent.userId, link.approval_id, 1, true); // key approved
    return link;
  }
  const liveKeys = () => pool.query("SELECT prefix FROM api_keys WHERE revoked_at IS NULL").then((r) => r.rows.map((x) => x.prefix));

  it("need the person's approval, are collected once, and only then minted", async () => {
    const agent = await agentOn();
    await expect(requestKey(agent)).rejects.toMatchObject({ status: 409 }); // no booking page yet
    await proposeWidget(agent, spec);
    await requestKey(agent);
    await expect(claimKey(agent)).rejects.toMatchObject({ status: 409, code: "not_approved" });

    const link = await createApprovalLink(agent);
    expect(link.items).toEqual(["booking_page", "api_key"]);
    const view = await approvalView(A.userId, link.approval_id);
    expect(view.items[1].details.requested_by).toBe("Claude Code"); // the card names the agent that asked
    await decideLinkItem(A.userId, link.approval_id, 0, true);
    await decideLinkItem(A.userId, link.approval_id, 1, true);

    const [k1, k2] = await Promise.allSettled([claimKey(agent), claimKey(agent)]);
    const won = [k1, k2].filter((r) => r.status === "fulfilled");
    expect(won).toHaveLength(1);
    const key = (won[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof claimKey>>>).value;
    expect(key.key).toMatch(/^mk_[0-9a-f]{10}_/);
    expect(key.env).toContain("KITPIER_API_KEY=");
    expect(key.prompt).toContain("Fade House");
    expect(await liveKeys()).toHaveLength(1);
    // The key it minted doesn't make the decided item look stale.
    expect((await approvalView(A.userId, link.approval_id)).items.map((i) => i.state)).toEqual(["approved", "approved"]);
  });

  it("only the agent that asked can collect it (Codex P1)", async () => {
    const asker = await agentOn();
    const other = await agentOn(); // a second agent on the same project
    await approvedKey(asker);
    await expect(claimKey(other)).rejects.toMatchObject({ status: 409, code: "not_approved" });
    await expect(claimKey(A)).rejects.toMatchObject({ status: 403 }); // no agent at all
    expect(await liveKeys()).toHaveLength(0);
    await expect(claimKey(asker)).resolves.toMatchObject({ key: expect.stringMatching(/^mk_/) });
  });

  it("a key made in the browser after approval isn't revoked by the old approval (Codex P1)", async () => {
    const agent = await agentOn();
    await approvedKey(agent);
    const { prefix } = await createKey(A); // the owner makes a key themselves
    await expect(claimKey(agent)).rejects.toMatchObject({ status: 409 });
    expect(await liveKeys()).toEqual([prefix]);
  });

  it("collection re-checks the key it replaces and the approval's time limit", async () => {
    const agent = await agentOn();
    await approvedKey(agent);
    // A key appears without going through createKey (which would also supersede the grant): the claim still refuses.
    await pool.query(
      "INSERT INTO api_keys (id, user_id, project_id, widget_id, prefix, secret_hash) SELECT 'key_x', $1, $2, id, '0123456789', '\\x00' FROM widgets",
      [A.userId, A.projectId],
    );
    await expect(claimKey(agent)).rejects.toMatchObject({ code: "stale" });
    expect(await liveKeys()).toEqual(["0123456789"]);

    const agent2 = await agentOn();
    await pool.query("DELETE FROM api_keys");
    await requestKey(agent2);
    const link = await createApprovalLink(agent2);
    await decideLinkItem(A.userId, link.approval_id, 0, true);
    await pool.query("UPDATE key_grants SET approved_until = now() - interval '1 second' WHERE status = 'approved'");
    await expect(claimKey(agent2)).rejects.toMatchObject({ code: "stale" });
    expect(await liveKeys()).toHaveLength(0);
  });

  it("a key approval is bound to the key it replaces", async () => {
    const agent = await agentOn();
    await proposeWidget(agent, spec);
    await requestKey(agent);
    const link = await createApprovalLink(agent);
    await decideLinkItem(A.userId, link.approval_id, 0, true); // booking page goes live
    await pool.query(
      "INSERT INTO api_keys (id, user_id, project_id, widget_id, prefix, secret_hash) SELECT 'key_x', $1, $2, id, '0123456789', '\\x00' FROM widgets",
      [A.userId, A.projectId],
    );
    await expect(decideLinkItem(A.userId, link.approval_id, 1, true)).rejects.toMatchObject({ code: "stale" });
  });

  it("a declined key can't be collected", async () => {
    const agent = await agentOn();
    await proposeWidget(agent, spec);
    await requestKey(agent);
    const link = await createApprovalLink(agent);
    await decideLinkItem(A.userId, link.approval_id, 1, false);
    await expect(claimKey(agent)).rejects.toMatchObject({ code: "not_approved" });
  });
});

describe("agent API routes", () => {
  const call = async (path: string, token: string | null, body?: unknown) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    const req = new Request(`http://localhost:3005${path}`, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined });
    return req;
  };

  it("need a token, and a token only reaches its own project", async () => {
    const ta = await tokenFor(A);
    const tb = await tokenFor(B);
    await stack(B);
    const projectRoute = await import("@/app/v1/agent/project/route");
    expect((await projectRoute.GET(await call("/v1/agent/project", null))).status).toBe(401);
    const a = await (await projectRoute.GET(await call("/v1/agent/project", ta))).json();
    expect(a.project.id).toBe(A.projectId);
    expect(a.proposals).toHaveLength(0); // B's proposal isn't visible to A's agent

    const linkRoute = await import("@/app/v1/agent/project/approval-link/route");
    const res = await linkRoute.POST(await call("/v1/agent/project/approval-link", tb, {}));
    const link = await res.json();
    const view = await import("@/app/v1/agent/approvals/[id]/route");
    const ctx = { params: Promise.resolve({ id: link.approval_id }) };
    expect((await view.GET(await call("/x", ta), ctx)).status).toBe(404);
    expect((await (await view.GET(await call("/x", tb), ctx)).json()).items).toEqual([{ kind: "stack", state: "pending" }]);
  });

  it("the person's approval route doesn't accept an agent token", async () => {
    const t = await tokenFor(A);
    await stack();
    const link = await createApprovalLink(A);
    const items = await import("@/app/api/approvals/[id]/items/[index]/route");
    const req = new Request("http://localhost:3005/x", {
      method: "POST",
      headers: { authorization: `Bearer ${t}`, "content-type": "application/json", origin: "http://localhost:3005" },
      body: JSON.stringify({ approve: true }),
    });
    expect((await items.POST(req, { params: Promise.resolve({ id: link.approval_id, index: "0" }) })).status).toBe(401);
    expect((await approvalView(A.userId, link.approval_id)).items[0].state).toBe("pending");
  });

  it("proposals record which agent made them", async () => {
    const t = await tokenFor(A);
    const pageRoute = await import("@/app/v1/agent/project/booking-page/route");
    expect((await pageRoute.POST(await call("/v1/agent/project/booking-page", t, spec))).status).toBe(200);
    const r = await pool.query("SELECT agent_token_id FROM pending_actions WHERE project_id = $1", [A.projectId]);
    expect(r.rows[0].agent_token_id).toMatch(/^agt_/);
  });
});
