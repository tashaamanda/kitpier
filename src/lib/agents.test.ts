import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// No browser session in these tests: cookies are empty, and requests come from Kitpier's own origin, so the only
// thing a route can authenticate with is the agent's Bearer token.
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined, set: () => {}, delete: () => {} })),
  headers: vi.fn(async () => new Headers({ origin: "http://localhost:3005", "x-forwarded-for": "203.0.113.9" })),
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => {} }));
process.env.APP_URL = "http://localhost:3005";
process.env.SESSION_SECRET = "x".repeat(32);

const { pool } = await import("./db");
const { startLink, openLink, decideLink, pollLink, requireAgentToken, listAgentTokens, revokeAgentToken, normalizeCode } =
  await import("./agents");
const { resetPassword } = await import("./password-reset");

const userA = { id: "usr_a", email: "a@test", name: "A", frozen: false };
const userB = { id: "usr_b", email: "b@test", name: "B", frozen: false };

beforeEach(async () => {
  await pool.query("TRUNCATE agent_links, agent_tokens, rate_limits, projects, users CASCADE");
  for (const u of [userA, userB]) {
    await pool.query("INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, 'x')", [u.id, u.email, u.name]);
    await pool.query("INSERT INTO projects (id, user_id, name) VALUES ($1, $2, 'p')", [`prj_${u.id}`, u.id]);
  }
});
afterAll(() => pool.end());

const bearer = (t: string) => new Request("http://localhost:3005/x", { headers: { authorization: `Bearer ${t}` } });
const noWait = (pollToken: string) => pool.query("UPDATE agent_links SET last_poll_at = NULL WHERE last_poll_at IS NOT NULL").then(() => pollLink(pollToken));

async function connected(user = userA) {
  const l = await startLink({ clientName: "Claude Code" });
  await decideLink(user, l.code, { allow: true, projectId: `prj_${user.id}` });
  const r = await pollLink(l.poll_token);
  if (r.status !== "approved") throw new Error(r.status);
  return r.token;
}

describe("agent links", () => {
  it("codes avoid lookalikes and normalize loosely", async () => {
    const l = await startLink({ clientName: "Claude Code" });
    expect(l.code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    expect(l.url).toBe(`http://localhost:3005/link/${l.code}`);
    expect(normalizeCode(l.code.toLowerCase().replace("-", " "))).toBe(l.code.replace("-", ""));
    expect(normalizeCode("ABCD-EF0O")).toBeNull();
  });

  it("strips control characters from self-reported names", async () => {
    const l = await startLink({ clientName: "Claude‮ Code\n\u0000", projectName: "  Barber\tshop " });
    const open = await openLink(l.code);
    expect(open).toMatchObject({ client_name: "Claude Code", project_name: "Barber shop" });
  });

  it("pending until allowed, then redeems exactly once", async () => {
    const l = await startLink({ clientName: "Claude Code" });
    expect((await pollLink(l.poll_token)).status).toBe("pending");
    expect((await pollLink(l.poll_token)).status).toBe("slow_down");
    await decideLink(userA, l.code, { allow: true, projectId: "prj_usr_a" });
    const [r1, r2] = await Promise.all([noWait(l.poll_token), noWait(l.poll_token)]);
    const approved = [r1, r2].filter((r) => r.status === "approved");
    expect(approved).toHaveLength(1);
    expect((await noWait(l.poll_token)).status).toBe("expired");
    expect(await pool.query("SELECT 1 FROM agent_tokens").then((r) => r.rowCount)).toBe(1);
  });

  it("a link can be decided once, and not after it expires", async () => {
    const l = await startLink({ clientName: "x" });
    await decideLink(userA, l.code, { allow: false });
    expect((await noWait(l.poll_token)).status).toBe("denied");
    await expect(decideLink(userA, l.code, { allow: true, projectId: "prj_usr_a" })).rejects.toMatchObject({ status: 404 });

    const late = await startLink({ clientName: "x" });
    await pool.query("UPDATE agent_links SET expires_at = now() - interval '1 second' WHERE state = 'pending'");
    await expect(decideLink(userA, late.code, { allow: true, projectId: "prj_usr_a" })).rejects.toMatchObject({ status: 404 });
    expect((await noWait(late.poll_token)).status).toBe("expired");
  });

  it("an approved link that isn't collected in time expires", async () => {
    const l = await startLink({ clientName: "x" });
    await decideLink(userA, l.code, { allow: true, projectId: "prj_usr_a" });
    await pool.query("UPDATE agent_links SET expires_at = now() - interval '1 second'");
    expect((await noWait(l.poll_token)).status).toBe("expired");
  });

  it("can't bind someone else's project; can create a new one", async () => {
    const l = await startLink({ clientName: "x" });
    await expect(decideLink(userA, l.code, { allow: true, projectId: "prj_usr_b" })).rejects.toMatchObject({ status: 404 });
    const { projectId } = await decideLink(userA, l.code, { allow: true, newProjectName: "Fade House" });
    const p = await pool.query("SELECT user_id, name FROM projects WHERE id = $1", [projectId]);
    expect(p.rows[0]).toEqual({ user_id: "usr_a", name: "Fade House" });
  });

  it("unknown poll tokens look expired", async () => {
    expect((await pollLink("nope")).status).toBe("expired");
    expect((await pollLink("a".repeat(43))).status).toBe("expired");
  });
});

describe("agent tokens", () => {
  it("authenticate to exactly one user and project; secrets aren't stored", async () => {
    const t = await connected();
    expect(await requireAgentToken(bearer(t))).toMatchObject({ userId: "usr_a", projectId: "prj_usr_a" });
    const raw = await pool.query("SELECT secret_hash::text AS h FROM agent_tokens");
    expect(JSON.stringify(raw.rows)).not.toContain(t.slice(14));
  });

  it("reject wrong secrets, revoked, expired and never-used-for-a-day tokens", async () => {
    const t = await connected();
    await expect(requireAgentToken(bearer(t.slice(0, -1) + (t.endsWith("A") ? "B" : "A")))).rejects.toMatchObject({ status: 401 });
    await expect(requireAgentToken(bearer("mk_0123456789_" + "a".repeat(43)))).rejects.toMatchObject({ status: 401 });

    await pool.query("UPDATE agent_tokens SET created_at = now() - interval '25 hours'");
    await expect(requireAgentToken(bearer(t))).rejects.toMatchObject({ status: 401 });
    expect(await listAgentTokens("usr_a", "prj_usr_a")).toHaveLength(0);

    const t2 = await connected();
    await requireAgentToken(bearer(t2));
    await pool.query("UPDATE agent_tokens SET created_at = now() - interval '25 hours' WHERE last_used_at IS NOT NULL");
    expect(await requireAgentToken(bearer(t2))).toMatchObject({ userId: "usr_a" }); // used within its first day: still fine
    await pool.query("UPDATE agent_tokens SET expires_at = now() - interval '1 second' WHERE last_used_at IS NOT NULL");
    await expect(requireAgentToken(bearer(t2))).rejects.toMatchObject({ status: 401 });

    const t3 = await connected();
    const [row] = await listAgentTokens("usr_a", "prj_usr_a");
    await expect(revokeAgentToken("usr_b", "prj_usr_a", row.id)).rejects.toMatchObject({ status: 404 });
    await revokeAgentToken("usr_a", "prj_usr_a", row.id);
    await expect(requireAgentToken(bearer(t3))).rejects.toMatchObject({ status: 401 });
  });

  it("can't approve, pay, connect accounts or issue keys: those routes take only a browser session", async () => {
    const t = await connected();
    const p = { params: Promise.resolve({ id: "prj_usr_a" }) };
    const req = (body: unknown = {}) =>
      new Request("http://localhost:3005/api/x", {
        method: "POST",
        headers: { authorization: `Bearer ${t}`, "content-type": "application/json", origin: "http://localhost:3005" },
        body: JSON.stringify(body),
      });
    const routes = [
      () => import("@/app/api/projects/[id]/stack/approve/route").then((m) => m.POST(req({ proposalId: "spr_x" }), p)),
      () => import("@/app/api/actions/[id]/approve/route").then((m) => m.POST(req(), { params: Promise.resolve({ id: "act_x" }) })),
      () => import("@/app/api/orders/route").then((m) => m.POST(req({ projectId: "prj_usr_a", pack: "p10" }))),
      () => import("@/app/api/connect/resend/route").then((m) => m.POST(req({ projectId: "prj_usr_a", apiKey: "re_x" }))),
      () => import("@/app/api/connect/supabase/route").then((m) => m.POST(req({ projectId: "prj_usr_a" }))),
      () => import("@/app/api/projects/[id]/keys/route").then((m) => m.POST(req(), p)),
      () => import("@/app/api/projects/[id]/provision/route").then((m) => m.POST(req(), p)),
      () => import("@/app/api/projects/[id]/plan/route").then((m) => m.POST(req({ message: "hi" }), p)),
    ];
    for (const call of routes) expect((await call()).status).toBe(401);
  });

  it("a password reset also kills a connection that was allowed but not yet collected (Codex P1)", async () => {
    const l = await startLink({ clientName: "Claude Code" });
    await decideLink(userA, l.code, { allow: true, projectId: "prj_usr_a" });
    const token = "s".repeat(43);
    await pool.query("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, 'usr_a', now() + interval '1 hour')", [
      createHash("sha256").update(token).digest("hex"),
    ]);
    await resetPassword(token, "brand-new-password", "2.2.2.2");
    expect((await pollLink(l.poll_token)).status).toBe("expired");
    expect(await pool.query("SELECT 1 FROM agent_tokens").then((r) => r.rowCount)).toBe(0);
  });

  it("a session from before a reset can't allow a connection", async () => {
    const l = await startLink({ clientName: "x" });
    await pool.query("UPDATE users SET session_version = session_version + 1 WHERE id = 'usr_a'"); // reset elsewhere
    await expect(decideLink({ ...userA, session_version: 0 }, l.code, { allow: true, projectId: "prj_usr_a" })).rejects.toMatchObject({
      status: 409,
    });
    expect((await pollLink(l.poll_token)).status).toBe("pending");
  });

  it("a password reset ends agent access", async () => {
    const t = await connected();
    const token = "r".repeat(43);
    const hash = createHash("sha256").update(token).digest("hex");
    await pool.query("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, 'usr_a', now() + interval '1 hour')", [hash]);
    await resetPassword(token, "brand-new-password", "2.2.2.2");
    await expect(requireAgentToken(bearer(t))).rejects.toMatchObject({ status: 401 });
  });
});

describe("containment (scripts/revoke-agent-access.sql)", () => {
  const sql = readFileSync(new URL("../../scripts/revoke-agent-access.sql", import.meta.url), "utf8");

  it("an approved but uncollected connection can't mint a token afterwards (Codex P1)", async () => {
    const t = await connected();
    const l = await startLink({ clientName: "x" });
    await decideLink(userA, l.code, { allow: true, projectId: "prj_usr_a" });
    const c = await pool.connect();
    try {
      await c.query(sql);
    } finally {
      c.release();
    }
    expect((await pollLink(l.poll_token)).status).toBe("expired");
    await expect(requireAgentToken(bearer(t))).rejects.toMatchObject({ status: 401 });
  });

  it("a poll racing the revocation never leaves a working token", async () => {
    for (let round = 0; round < 5; round++) {
      await pool.query("TRUNCATE agent_links, agent_tokens CASCADE");
      const l = await startLink({ clientName: "x" });
      await decideLink(userA, l.code, { allow: true, projectId: "prj_usr_a" });
      const c = await pool.connect();
      const [poll] = await Promise.all([pollLink(l.poll_token), c.query(sql).finally(() => c.release())]);
      if (poll.status === "approved") await expect(requireAgentToken(bearer(poll.token))).rejects.toMatchObject({ status: 401 });
      const live = await pool.query("SELECT 1 FROM agent_tokens WHERE revoked_at IS NULL");
      expect(live.rowCount).toBe(0);
    }
  });
});

describe("rollout switches", () => {
  it("agent connections are off in production until explicitly enabled", async () => {
    const { agentConnectOpen } = await import("./agents");
    expect(agentConnectOpen({ NODE_ENV: "production" })).toBe(false);
    expect(agentConnectOpen({ NODE_ENV: "production", AGENT_CONNECT_ENABLED: "true" })).toBe(false);
    expect(agentConnectOpen({ NODE_ENV: "production", AGENT_CONNECT_ENABLED: "1" })).toBe(true);
    expect(agentConnectOpen({ NODE_ENV: "development" })).toBe(true);
  });

  it("the client IP source must be explicit in production and valid everywhere", async () => {
    const { ipSource } = await import("./session");
    expect(() => ipSource({ NODE_ENV: "production" })).toThrow(/must be set/);
    expect(() => ipSource({ NODE_ENV: "development", CLIENT_IP_SOURCE: "x-forwarded-for" })).toThrow(/not one of/);
    expect(ipSource({ NODE_ENV: "production", CLIENT_IP_SOURCE: "cf-connecting-ip" })).toBe("cf-connecting-ip");
    expect(ipSource({ NODE_ENV: "test" })).toBe("xff-first");
  });
});

describe("client IP source", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it("reads only the configured header, and refuses anything that isn't an address", async () => {
    const { pickClientIp } = await import("./session");
    const forged = h({ "x-forwarded-for": "6.6.6.6, 203.0.113.9", "cf-connecting-ip": "198.51.100.7" });
    expect(pickClientIp(forged, "xff-first")).toBe("6.6.6.6");
    expect(pickClientIp(forged, "xff-last")).toBe("203.0.113.9");
    expect(pickClientIp(forged, "cf-connecting-ip")).toBe("198.51.100.7");
    expect(pickClientIp(h({ "x-forwarded-for": "not-an-ip" }), "xff-first")).toBe("unknown");
    expect(pickClientIp(h({ "x-forwarded-for": "999.1.1.1" }), "xff-first")).toBe("unknown");
    expect(pickClientIp(h({ "x-forwarded-for": "::::" }), "xff-first")).toBe("unknown");
    expect(pickClientIp(h({ "x-forwarded-for": "::ffff:127.0.0.1" }), "xff-first")).toBe("::ffff:127.0.0.1");
    expect(pickClientIp(h({}), "cf-connecting-ip")).toBe("local");
  });
});
