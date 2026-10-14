import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
process.env.CREDENTIALS_MASTER_KEY = randomBytes(32).toString("base64");
process.env.SUPABASE_OAUTH_CLIENT_ID = "test-client";
process.env.SUPABASE_OAUTH_CLIENT_SECRET = "test-secret";
process.env.APP_URL = "http://localhost:3005";

const { pool } = await import("./db");
const { seal, open, putCredential, getCredential } = await import("./credentials");
const { startConnect, claimState, finishConnect, accessToken } = await import("./supabase");

const A = { userId: "usr_a", projectId: "prj_a" };
const B = { userId: "usr_b", projectId: "prj_b" };

const fetchMock = vi.fn();
function reply(status: number, json: unknown) {
  return Promise.resolve(new Response(JSON.stringify(json), { status }));
}

beforeEach(async () => {
  await pool.query("TRUNCATE credentials, oauth_states, projects, users CASCADE");
  for (const s of [A, B]) {
    await pool.query("INSERT INTO users (id, email, name, password_hash) VALUES ($1, $1, $1, 'x')", [s.userId]);
    await pool.query("INSERT INTO projects (id, user_id, name) VALUES ($1, $2, 'p')", [s.projectId, s.userId]);
  }
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => pool.end());

describe("credential encryption", () => {
  it("round-trips and binds ciphertext to its id, owner, project and kind", () => {
    const e = seal("cred_1", A, "supabase_oauth", "s3cret");
    expect(e.ciphertext.toString("utf8")).not.toContain("s3cret");
    expect(open("cred_1", A, "supabase_oauth", e)).toBe("s3cret");
    expect(() => open("cred_2", A, "supabase_oauth", e)).toThrow();
    expect(() => open("cred_1", { ...A, userId: "usr_b" }, "supabase_oauth", e)).toThrow();
    expect(() => open("cred_1", A, "resend_send_key", e)).toThrow();
  });

  it("another user can't read the credential", async () => {
    await putCredential(A, "supabase_oauth", "s3cret");
    expect((await getCredential(A, "supabase_oauth"))?.secret).toBe("s3cret");
    expect(await getCredential({ userId: B.userId, projectId: A.projectId }, "supabase_oauth")).toBeUndefined();
    const raw = await pool.query("SELECT ciphertext::text AS c, meta::text AS m FROM credentials");
    expect(JSON.stringify(raw.rows)).not.toContain("s3cret");
  });
});

describe("Supabase OAuth", () => {
  it("state is single use and bound to the user who started it", async () => {
    const url = new URL(await startConnect(A));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3005/api/connect/supabase/callback");
    const state = url.searchParams.get("state")!;

    await expect(claimState(B.userId, state)).rejects.toThrow(/expired/); // wrong user burns it
    const again = new URL(await startConnect(A)).searchParams.get("state")!;
    expect((await claimState(A.userId, again)).projectId).toBe(A.projectId);
    await expect(claimState(A.userId, again)).rejects.toThrow(/expired/); // replay
  });

  it("connect stores an encrypted token and calls nothing that creates", async () => {
    fetchMock
      .mockImplementationOnce(() => reply(200, { access_token: "at1", refresh_token: "rt1", expires_in: 3600 }))
      .mockImplementationOnce(() => reply(200, [{ id: "o1", name: "Hackathon" }]));
    await finishConnect(A, "code", "verifier");
    const methods = fetchMock.mock.calls.map(([u, i]) => `${i?.method ?? "GET"} ${new URL(u).pathname}`);
    expect(methods).toEqual(["POST /v1/oauth/token", "GET /v1/organizations"]);
    const c = await getCredential(A, "supabase_oauth");
    expect(c?.meta).toEqual({ orgs: ["Hackathon"] });
  });

  it("an expired token is refreshed once and the rotated refresh token is stored", async () => {
    await putCredential(A, "supabase_oauth", JSON.stringify({ access_token: "old", refresh_token: "rt1", expires_at: 0 }));
    fetchMock.mockImplementation(() => reply(200, { access_token: "at2", refresh_token: "rt2", expires_in: 3600 }));
    const tokens = await Promise.all([accessToken(A), accessToken(A), accessToken(A)]);
    expect(tokens).toEqual(["at2", "at2", "at2"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][1].body)).toContain("refresh_token=rt1");
    expect(JSON.parse((await getCredential(A, "supabase_oauth"))!.secret).refresh_token).toBe("rt2");
  });
});
