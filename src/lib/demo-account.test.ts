import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// "Try the demo" (judges page): every click is its own account and project, so judges never see each other's bookings,
// emails or codes, can't break each other's demo, and never share limits. No model or provider is called.
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("./session", async (orig) => ({
  ...(await orig<typeof import("./session")>()),
  requireUser: vi.fn(),
  currentUser: vi.fn(),
  assertSameOrigin: vi.fn(),
}));
// Delegates to the real one; a test can make it fail once to break setup part-way.
vi.mock("./booking", async (orig) => {
  const real = await orig<typeof import("./booking")>();
  return { ...real, proposeWidget: vi.fn(real.proposeWidget) };
});
process.env.APP_URL = "http://localhost:3005";
process.env.CREDENTIALS_MASTER_KEY = randomBytes(32).toString("base64");
process.env.DEMO_SUPABASE_REF = "abcdefghijklmnopqrst";
process.env.DEMO_SUPABASE_SECRET_KEY = "test-demo-key";

const { pool } = await import("./db");
const { DEMO_DAYS, DEMO_LIMITS, demoResumeLink, isDemoAccount, resumeDemo, rotateDemoLink, startDemo } = await import("./demo-account");
const booking = await import("./booking");
const { requireProjectOwner } = await import("./projects");
const { captureMail, demoInbox } = await import("./demo");
const session = await import("./session");

const fetchMock = vi.fn(async () => new Response("[]", { status: 200 }));
vi.stubGlobal("fetch", fetchMock);

beforeEach(async () => {
  await pool.query("TRUNCATE rate_limits, demo_mail, users CASCADE");
  fetchMock.mockClear();
});
afterAll(() => pool.end());

const userRow = async (id: string) =>
  (await pool.query("SELECT id, email, name, frozen FROM users WHERE id = $1", [id])).rows[0];

describe("startDemo", () => {
  it("creates a ready project: demo connection on, stack approved at $30, booking page live", async () => {
    const d = await startDemo("10.0.0.1");
    const user = await userRow(d.userId);
    expect(isDemoAccount(user.email)).toBe(true);
    const p = await requireProjectOwner(user, d.projectId);
    expect(p.name).toBe("Sam's Barbershop");
    expect(p.demo_connection).toBe(true);
    expect(Number(p.budget_micros)).toBe(30_000_000);
    const w = (await pool.query("SELECT user_id, project_id, active FROM widgets WHERE id = $1", [d.widgetId])).rows[0];
    expect(w).toMatchObject({ user_id: d.userId, project_id: d.projectId, active: true });
    const stack = (await pool.query("SELECT items FROM stack_proposals WHERE project_id = $1 AND status = 'approved'", [d.projectId])).rows;
    expect(stack).toHaveLength(1);
    expect(stack[0].items.map((i: { slug: string }) => i.slug)).toEqual(["booking-api", "supabase", "resend"]);
    expect(fetchMock).not.toHaveBeenCalled(); // setup touches no provider
  });

  it("gives two judges separate accounts that can't open each other's project or inbox", async () => {
    const a = await startDemo("10.0.0.1");
    const b = await startDemo("10.0.0.2");
    expect(a.userId).not.toBe(b.userId);
    expect(a.projectId).not.toBe(b.projectId);
    await expect(requireProjectOwner(await userRow(b.userId), a.projectId)).rejects.toMatchObject({ status: 404 });

    await pool.query("INSERT INTO conversations (id, widget_id) VALUES ('conv_a', $1)", [a.widgetId]);
    await captureMail(a.projectId, "conv_a", "code", "jo@example.com", "Your code", "123456");
    const inboxB = await demoInbox({ userId: b.userId, projectId: b.projectId });
    expect(inboxB.mail).toHaveLength(0);
    const inboxA = await demoInbox({ userId: a.userId, projectId: a.projectId });
    expect(inboxA.mail.map((m) => m.body)).toEqual(["123456"]);
    // The shared demo bookings table is always read with this project's id.
    const urls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls.some((u) => u.includes(`project=eq.${b.projectId}`))).toBe(true);
    expect(urls.some((u) => u.includes(`project=eq.${a.projectId}`) && !u.includes(b.projectId))).toBe(true);
  });

  it("limits demos per IP per hour, and creates nothing once limited", async () => {
    for (let i = 0; i < DEMO_LIMITS.perIpPerHour; i++) await startDemo("10.0.0.9");
    await expect(startDemo("10.0.0.9")).rejects.toMatchObject({ status: 429 });
    const n = (await pool.query("SELECT count(*)::int AS n FROM users")).rows[0].n;
    expect(n).toBe(DEMO_LIMITS.perIpPerHour);
    await expect(startDemo("10.0.0.10")).resolves.toBeTruthy(); // another judge is unaffected
  });

  it("limits one IP per day too, so it can't use up the site-wide allowance", async () => {
    await pool.query("INSERT INTO rate_limits (key, count, reset_at) VALUES ('demo-day:10.0.0.11', $1, now() + interval '1 hour')", [DEMO_LIMITS.perIpPerDay]);
    await expect(startDemo("10.0.0.11")).rejects.toMatchObject({ status: 429, code: "demo_limit" });
    expect(DEMO_LIMITS.perDay / DEMO_LIMITS.perIpPerDay).toBeGreaterThanOrEqual(50); // takes 50+ addresses to fill
  });

  it("removes the account if setup fails part-way, leaving nothing half-built", async () => {
    vi.mocked(booking.proposeWidget).mockRejectedValueOnce(new Error("boom"));
    await expect(startDemo("10.0.0.12")).rejects.toThrow("boom");
    expect((await pool.query("SELECT count(*)::int AS n FROM users")).rows[0].n).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS n FROM projects")).rows[0].n).toBe(0);
  });

  it("caps demos across all IPs per day", async () => {
    await pool.query("INSERT INTO rate_limits (key, count, reset_at) VALUES ('demo:all', $1, now() + interval '1 hour')", [DEMO_LIMITS.perDay]);
    await expect(startDemo("10.0.0.20")).rejects.toMatchObject({ status: 429 });
  });

  it("fails closed without the demo connection and creates no account", async () => {
    const ref = process.env.DEMO_SUPABASE_REF;
    delete process.env.DEMO_SUPABASE_REF;
    try {
      await expect(startDemo("10.0.0.30")).rejects.toMatchObject({ status: 503 });
      expect((await pool.query("SELECT count(*)::int AS n FROM users")).rows[0].n).toBe(0);
    } finally {
      process.env.DEMO_SUPABASE_REF = ref;
    }
  });

  it("makes accounts nobody can sign into with a password", async () => {
    const d = await startDemo("10.0.0.40");
    const hash = (await pool.query("SELECT password_hash FROM users WHERE id = $1", [d.userId])).rows[0].password_hash;
    const bcrypt = (await import("bcryptjs")).default;
    expect(await bcrypt.compare("", hash)).toBe(false);
    expect(hash).toMatch(/^\$2[aby]\$10\$/);
  });
});

describe("the private resume link", () => {
  const keyOf = async (userId: string) => (await demoResumeLink(userId)).resumeUrl.split("#")[1];
  const age = (userId: string, days: number) =>
    pool.query("UPDATE users SET created_at = now() - make_interval(days => $2) WHERE id = $1", [userId, days]);

  it("reopens the same demo project after the session is gone, and says when it expires", async () => {
    const d = await startDemo("10.0.0.70");
    const link = await demoResumeLink(d.userId);
    expect(link.resumeUrl.startsWith("http://localhost:3005/judges/resume#")).toBe(true);
    const days = (link.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(DEMO_DAYS);
    await expect(resumeDemo(await keyOf(d.userId))).resolves.toEqual({ userId: d.userId, projectId: d.projectId, version: 0 });
  });

  it("refuses a tampered key, another demo's id with this key, and real accounts", async () => {
    const a = await startDemo("10.0.0.71");
    const b = await startDemo("10.0.0.72");
    const [, mac] = (await keyOf(a.userId)).split(".");
    await expect(resumeDemo(`${a.userId}.${mac.slice(0, -1)}x`)).rejects.toMatchObject({ status: 404 });
    await expect(resumeDemo(`${b.userId}.${mac}`)).rejects.toMatchObject({ status: 404 });
    await expect(resumeDemo("garbage")).rejects.toMatchObject({ status: 404 });
    await pool.query("INSERT INTO users (id, email, name, password_hash) VALUES ('usr_real', 'owner@example.com', 'Owner', 'x')");
    await expect(demoResumeLink("usr_real")).rejects.toMatchObject({ status: 404 }); // never issued for real accounts
    await expect(rotateDemoLink("usr_real")).rejects.toMatchObject({ status: 404 }); // nor can their sessions be reset here
  });

  it("stops working once the demo is DEMO_DAYS old", async () => {
    const d = await startDemo("10.0.0.73");
    const key = await keyOf(d.userId);
    await age(d.userId, DEMO_DAYS + 1);
    await expect(resumeDemo(key)).rejects.toMatchObject({ status: 404 });
    await expect(demoResumeLink(d.userId)).rejects.toMatchObject({ status: 404 });
  });

  it("making a new link revokes the old one and ends other sessions of that demo", async () => {
    const d = await startDemo("10.0.0.74");
    const old = await keyOf(d.userId);
    expect(await rotateDemoLink(d.userId)).toBe(1);
    await expect(resumeDemo(old)).rejects.toMatchObject({ status: 404 });
    const fresh = await keyOf(d.userId);
    expect(fresh).not.toBe(old);
    await expect(resumeDemo(fresh)).resolves.toMatchObject({ projectId: d.projectId, version: 1 });
    // Sessions are checked against session_version, so a cookie issued at version 0 no longer signs in.
    const live = await pool.query("SELECT 1 FROM users WHERE id = $1 AND session_version = 0", [d.userId]);
    expect(live.rowCount).toBe(0);
  });

});

describe("an expired demo", () => {
  const age = (userId: string, days: number) =>
    pool.query("UPDATE users SET created_at = now() - make_interval(days => $2) WHERE id = $1", [userId, days]);
  const bearer = (token: string) => new Request("https://kitpier.test/x", { headers: { authorization: `Bearer ${token}` } });
  const sha = (v: string) => createHash("sha256").update(v).digest();

  it("can't be used any way in: session cookie, agent token, API key or public booking page", async () => {
    const d = await startDemo("10.0.0.80");
    const agentSecret = randomBytes(32).toString("base64url");
    await pool.query(
      "INSERT INTO agent_links (id, code_hash, poll_hash, client_name, state, user_id, project_id, expires_at) VALUES ('lnk_x', 'c', 'p', 'Agent', 'approved', $1, $2, now() + interval '1 day')",
      [d.userId, d.projectId],
    );
    await pool.query(
      "INSERT INTO agent_tokens (id, link_id, user_id, project_id, client_name, prefix, secret_hash, expires_at) VALUES ('tok_x', 'lnk_x', $1, $2, 'Agent', 'aaaaaaaaaa', $3, now() + interval '30 days')",
      [d.userId, d.projectId, sha(agentSecret)],
    );
    const keySecret = randomBytes(32).toString("base64url");
    await pool.query(
      "INSERT INTO api_keys (id, user_id, project_id, widget_id, prefix, secret_hash) VALUES ('key_x', $1, $2, $3, 'bbbbbbbbbb', $4)",
      [d.userId, d.projectId, d.widgetId, sha(keySecret)],
    );
    const real = await vi.importActual<typeof import("./session")>("./session");
    const { requireAgentToken } = await import("./agents");
    const { requireApiKey } = await import("./apikeys");
    const { getWidget } = await import("./booking");

    // Day 44: everything works.
    await age(d.userId, DEMO_DAYS - 1);
    expect(await real.sessionUser({ userId: d.userId, v: 0 })).toMatchObject({ id: d.userId });
    await expect(requireAgentToken(bearer(`ka_aaaaaaaaaa_${agentSecret}`))).resolves.toMatchObject({ userId: d.userId });
    await expect(requireApiKey(bearer(`mk_bbbbbbbbbb_${keySecret}`))).resolves.toMatchObject({ widgetId: d.widgetId });
    expect(await getWidget(d.widgetId)).toMatchObject({ id: d.widgetId });

    // Day 46, before any cleanup has run: nothing does.
    await age(d.userId, DEMO_DAYS + 1);
    expect(await real.sessionUser({ userId: d.userId, v: 0 })).toBeNull();
    await expect(requireAgentToken(bearer(`ka_aaaaaaaaaa_${agentSecret}`))).rejects.toMatchObject({ status: 401 });
    await expect(requireApiKey(bearer(`mk_bbbbbbbbbb_${keySecret}`))).rejects.toMatchObject({ status: 401 });
    expect(await getWidget(d.widgetId)).toBeUndefined(); // the public booking page 404s
  });

  it("only demo accounts expire: an old real account still signs in", async () => {
    await pool.query("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('usr_old', 'owner@example.com', 'Owner', 'x', now() - interval '400 days')");
    const real = await vi.importActual<typeof import("./session")>("./session");
    expect(await real.sessionUser({ userId: "usr_old", v: 0 })).toMatchObject({ id: "usr_old" });
  });
});

describe("the daily cleanup", () => {
  const age = (userId: string, days: number) =>
    pool.query("UPDATE users SET created_at = now() - make_interval(days => $2) WHERE id = $1", [userId, days]);

  it("deletes expired demos with all their data, old demo mail and old Supabase bookings, and nothing else", async () => {
    const { purgeDemoData } = await import("./demo-purge");
    const old = await startDemo("10.0.0.75");
    const fresh = await startDemo("10.0.0.76");
    await pool.query("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('usr_real', 'owner@example.com', 'Owner', 'x', now() - interval '400 days')");
    // A sandbox purchase on the old demo: money rows don't cascade, so the purge has to clear them itself.
    await pool.query(
      "INSERT INTO orders (id, paypal_order_id, user_id, project_id, pack_id, amount_micros, status) VALUES ('ord_old', 'PP_old', $1, $2, 'p10', 10000000, 'credited')",
      [old.userId, old.projectId],
    );
    await pool.query("INSERT INTO ledger_entries (user_id, project_id, kind, amount_micros, source) VALUES ($1, $2, 'purchase', 10000000, 'capture:old')", [old.userId, old.projectId]);
    await pool.query("INSERT INTO conversations (id, widget_id) VALUES ('conv_f', $1)", [fresh.widgetId]);
    await captureMail(fresh.projectId, "conv_f", "code", "jo@example.com", "Your code", "old");
    await captureMail(fresh.projectId, "conv_f", "code", "jo@example.com", "Your code", "new");
    await pool.query("UPDATE demo_mail SET created_at = now() - interval '49 hours' WHERE body = 'old'");
    await age(old.userId, DEMO_DAYS + 1);
    fetchMock.mockClear();

    await expect(purgeDemoData()).resolves.toEqual({ accounts: 1, mail: 1, bookings: "cleaned" });
    const ids = (await pool.query("SELECT id FROM users ORDER BY id")).rows.map((r) => r.id);
    expect(ids).toEqual([fresh.userId, "usr_real"].sort());
    expect((await pool.query("SELECT count(*)::int AS n FROM projects WHERE user_id = $1", [old.userId])).rows[0].n).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS n FROM orders")).rows[0].n).toBe(0);
    expect((await pool.query("SELECT body FROM demo_mail")).rows.map((r) => r.body)).toEqual(["new"]);
    // Supabase: one DELETE of every demo booking created over 48 hours ago.
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("DELETE");
    const cutoff = new Date(decodeURIComponent(url.split("created_at=lt.")[1])).getTime();
    expect(Math.round((Date.now() - cutoff) / 3_600_000)).toBe(48);
  });

  it("reports a Supabase failure instead of claiming success", async () => {
    const { purgeDemoData } = await import("./demo-purge");
    fetchMock.mockResolvedValueOnce(new Response("down", { status: 503 }));
    await expect(purgeDemoData()).rejects.toThrow("demo bookings cleanup failed (503)");
  });

  it("fails, rather than reporting success, when the demo Supabase settings are missing", async () => {
    const { purgeDemoData } = await import("./demo-purge");
    const ref = process.env.DEMO_SUPABASE_REF;
    process.env.DEMO_SUPABASE_REF = "not-a-valid-ref";
    try {
      await expect(purgeDemoData()).rejects.toThrow("demo Supabase settings missing or invalid");
      delete process.env.DEMO_SUPABASE_REF;
      await expect(purgeDemoData()).rejects.toThrow("demo Supabase settings missing or invalid");
    } finally {
      process.env.DEMO_SUPABASE_REF = ref;
    }
    const { sweepDemoBookings } = await import("./demo");
    delete process.env.DEMO_SUPABASE_REF;
    try {
      await expect(sweepDemoBookings()).resolves.toBeUndefined(); // the best-effort sweep on booking writes still never throws
    } finally {
      process.env.DEMO_SUPABASE_REF = ref;
    }
  });

  it("the endpoint runs only with the right CRON_SECRET, and fails closed without one", async () => {
    const cron = await import("@/app/api/cron/purge-demo/route");
    const call = (auth?: string) =>
      cron.POST(new Request("http://localhost:3005/api/cron/purge-demo", { method: "POST", headers: auth ? { authorization: auth } : {} }));
    delete process.env.CRON_SECRET;
    expect((await call("Bearer anything")).status).toBe(503);
    process.env.CRON_SECRET = "s".repeat(16);
    expect((await call(`Bearer ${"s".repeat(16)}`)).status).toBe(503); // too short to count as configured
    process.env.CRON_SECRET = "c".repeat(40);
    try {
      expect((await call()).status).toBe(401);
      expect((await call(`Bearer ${"c".repeat(39)}`)).status).toBe(401);
      const ok = await call(`Bearer ${"c".repeat(40)}`);
      expect(ok.status).toBe(200);
      expect(ok.headers.get("cache-control")).toBe("no-store");
    } finally {
      delete process.env.CRON_SECRET;
    }
  });
});

describe("someone already signed in to their own account", () => {
  it("is not switched to a demo account", async () => {
    await pool.query("INSERT INTO users (id, email, name, password_hash) VALUES ('usr_mine', 'owner@example.com', 'Owner', 'x')");
    vi.mocked(session.currentUser).mockResolvedValue(await userRow("usr_mine"));
    const demo = await import("@/app/api/judges/demo/route");
    const res = await demo.POST();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("signed_in");
    expect((await pool.query("SELECT count(*)::int AS n FROM users")).rows[0].n).toBe(1); // no demo created
  });
});

describe("demo accounts can't attach real accounts", () => {
  const req = (body: unknown) =>
    new Request("http://localhost:3005/api/connect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("refuses Supabase and Resend connect with 403 and stores nothing", async () => {
    const d = await startDemo("10.0.0.50");
    vi.mocked(session.requireUser).mockResolvedValue(await userRow(d.userId));
    const supabase = await import("@/app/api/connect/supabase/route");
    const resend = await import("@/app/api/connect/resend/route");

    const s = await supabase.POST(req({ projectId: d.projectId }));
    expect(s.status).toBe(403);
    const r = await resend.POST(req({ projectId: d.projectId, apiKey: "re_abcdefghijklmnop" }));
    expect(r.status).toBe(403);
    expect((await pool.query("SELECT count(*)::int AS n FROM credentials WHERE user_id = $1", [d.userId])).rows[0].n).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a demo project on the demo connection", async () => {
    const d = await startDemo("10.0.0.60");
    vi.mocked(session.requireUser).mockResolvedValue(await userRow(d.userId));
    const demo = await import("@/app/api/projects/[id]/demo/route");
    const ctx = { params: Promise.resolve({ id: d.projectId }) };
    const res = await demo.POST(req({ on: false }), ctx);
    expect(res.status).toBe(403);
    const on = (await pool.query("SELECT demo_connection FROM projects WHERE id = $1", [d.projectId])).rows[0].demo_connection;
    expect(on).toBe(true);
  });

  it("still lets a normal account start Supabase connect", async () => {
    await pool.query("INSERT INTO users (id, email, name, password_hash) VALUES ('usr_normal', 'owner@example.com', 'Owner', 'x')");
    await pool.query("INSERT INTO projects (id, user_id, name) VALUES ('prj_normal', 'usr_normal', 'Mine')");
    vi.mocked(session.requireUser).mockResolvedValue(await userRow("usr_normal"));
    const supabase = await import("@/app/api/connect/supabase/route");
    const res = await supabase.POST(req({ projectId: "prj_normal" }));
    expect(res.status).not.toBe(403);
  });
});
