import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
process.env.CREDENTIALS_MASTER_KEY = randomBytes(32).toString("base64");
process.env.SUPABASE_OAUTH_CLIENT_ID = "test-client";
process.env.SUPABASE_OAUTH_CLIENT_SECRET = "test-secret";
process.env.APP_URL = "http://localhost:3005";

const { pool } = await import("./db");
const { putCredential, getCredential } = await import("./credentials");
const { proposeProvision, decideAction, advanceProvision, provisionState } = await import("./provision");
const { BOOKINGS_V1 } = await import("./templates");

const A = { userId: "usr_a", projectId: "prj_a" };
const B = { userId: "usr_b", projectId: "prj_b" };
const REF = "abcdefghijklmnopqrst";

// Fake Supabase Management API, keyed by "METHOD /path".
let projects: { status: string }[] = [{ status: "ACTIVE_HEALTHY" }];
let health = "COMING_UP";
let createStatus = 201;
const calls: string[] = [];
function api(url: string, init?: RequestInit) {
  const key = `${init?.method ?? "GET"} ${new URL(url).pathname}`;
  calls.push(key);
  const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  if (key === "GET /v1/organizations") return json(200, [{ id: "o1", slug: "hack", name: "Hackathon" }]);
  if (key === "GET /v1/projects") return json(200, projects);
  if (key === "POST /v1/projects") return new Promise((r) => setTimeout(() => r(json(createStatus, { ref: REF })), 20));
  if (key === `GET /v1/projects/${REF}`) return json(200, { status: health });
  if (key === `GET /v1/projects/${REF}/api-keys`) return json(200, [{ type: "publishable", api_key: "pk" }, { type: "secret", api_key: "sb_secret_x" }]);
  if (key === `POST /v1/projects/${REF}/database/query`) return json(201, []);
  return json(404, {});
}

beforeEach(async () => {
  await pool.query("TRUNCATE provision_jobs, pending_actions, managed_supabase_refs, credentials, rate_limits, projects, users CASCADE");
  for (const s of [A, B]) {
    await pool.query("INSERT INTO users (id, email, name, password_hash) VALUES ($1, $1, $1, 'x')", [s.userId]);
    await pool.query("INSERT INTO projects (id, user_id, name) VALUES ($1, $2, 'Barber Shop')", [s.projectId, s.userId]);
    await putCredential(s, "supabase_oauth", JSON.stringify({ access_token: "at", refresh_token: "rt", expires_at: Date.now() + 3600_000 }));
  }
  projects = [{ status: "ACTIVE_HEALTHY" }];
  health = "COMING_UP";
  createStatus = 201;
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(api));
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => pool.end());

async function approved() {
  const { id } = await proposeProvision(A);
  await decideAction(A.userId, id, true);
  return id;
}

describe("proposing a database setup", () => {
  it("only reads from Supabase and creates a pending action, no job", async () => {
    const { spec } = await proposeProvision(A);
    expect(calls.every((c) => c.startsWith("GET "))).toBe(true);
    expect(spec).toMatchObject({ mode: "new", org_name: "Hackathon", template: "bookings_v1" });
    expect(spec.project_name).toMatch(/^kitpier-barber-shop-[0-9a-f]{4}$/);
    const st = await provisionState(A);
    expect(st.action?.status).toBe("pending");
    expect(st.job).toBeNull();
  });

  it("stops at the free-plan cap and when the project list is unreadable", async () => {
    projects = [{ status: "ACTIVE_HEALTHY" }, { status: "COMING_UP" }, { status: "INACTIVE" }];
    await expect(proposeProvision(A)).rejects.toMatchObject({ code: "supabase_cap" });
    projects = {} as never;
    await expect(proposeProvision(A)).rejects.toMatchObject({ status: 409 });
    expect((await provisionState(A)).action).toBeNull();
  });
});

describe("approval gate", () => {
  it("only the owner can approve, and only once", async () => {
    const { id } = await proposeProvision(A);
    await expect(decideAction(B.userId, id, true)).rejects.toMatchObject({ status: 404 });
    const r = await decideAction(A.userId, id, true);
    expect(r.job?.state).toBe("requested");
    await expect(decideAction(A.userId, id, true)).rejects.toMatchObject({ status: 404 });
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual([]); // approval itself calls nothing
  });

  it("rejecting creates no job", async () => {
    const { id } = await proposeProvision(A);
    await decideAction(A.userId, id, false);
    expect((await provisionState(A)).job).toBeNull();
    await advanceProvision(A);
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual([]);
  });
});

describe("provisioning job", () => {
  it("runs requested → creating → healthy → schema_ready with the fixed template", async () => {
    await approved();
    await advanceProvision(A);
    let job = (await provisionState(A)).job!;
    expect([job.state, job.ref]).toEqual(["creating", REF]);
    await advanceProvision(A); // still coming up
    expect((await provisionState(A)).job!.state).toBe("creating");
    health = "ACTIVE_HEALTHY";
    await advanceProvision(A);
    expect((await provisionState(A)).job!.state).toBe("healthy");
    await advanceProvision(A);
    job = (await provisionState(A)).job!;
    expect(job.state).toBe("schema_ready");
    const ddl = (vi.mocked(fetch).mock.calls.find(([u, i]) => String(u).endsWith("/database/query") && i?.method === "POST")![1]!.body as string);
    expect(JSON.parse(ddl).query).toBe(BOOKINGS_V1);
    expect(BOOKINGS_V1).not.toMatch(/\b(drop|alter\s+table\s+(?!public\.bookings))/i);
    expect((await getCredential(A, "supabase_secret_key"))?.secret).toBe("sb_secret_x");
    expect(calls.filter((c) => c === "POST /v1/projects")).toHaveLength(1);
  });

  it("parallel polls create exactly one project", async () => {
    await approved();
    await Promise.all([advanceProvision(A), advanceProvision(A), advanceProvision(A)]);
    expect(calls.filter((c) => c === "POST /v1/projects")).toHaveLength(1);
  });

  it("refuses a ref Kitpier didn't create (fails closed)", async () => {
    await approved();
    await pool.query("UPDATE provision_jobs SET state = 'creating', ref = 'someoneelsesprojectref' WHERE user_id = $1", [A.userId]);
    await expect(advanceProvision(A)).rejects.toMatchObject({ status: 403 });
    expect(calls.some((c) => c.includes("someoneelsesprojectref"))).toBe(false);
  });

  it("a failed create can be proposed and approved again", async () => {
    createStatus = 402;
    await approved();
    await advanceProvision(A);
    expect((await provisionState(A)).job!.state).toBe("failed");
    createStatus = 201;
    await approved();
    expect((await provisionState(A)).job!.state).toBe("requested");
  });
});
