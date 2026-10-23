import bcrypt from "bcryptjs";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
process.env.APP_URL = "https://kitpier.test";
process.env.RESEND_API_KEY = "re_test";
process.env.MAIL_FROM = "Kitpier <noreply@kitpier.test>";

const { pool } = await import("./db");
const { requestPasswordReset, resetPassword } = await import("./password-reset");

const EMAIL = "owner@example.com";
let sent: { from: string; to: string[]; subject: string; text: string }[] = [];

const linkToken = () => sent.at(-1)!.text.match(/\/reset#token=([\w-]+)/)![1];
async function request(email = EMAIL, ip = "1.1.1.1") {
  await (await requestPasswordReset(email, ip)).delivery;
}

beforeEach(async () => {
  await pool.query("TRUNCATE password_resets, rate_limits, users CASCADE");
  await pool.query("INSERT INTO users (id, email, name, password_hash) VALUES ('usr_o', $1, 'Owner', $2)", [EMAIL, await bcrypt.hash("old-password-123", 4)]);
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      expect(new URL(url).hostname).toBe("api.resend.com");
      sent.push(JSON.parse(String(init?.body)));
      return Promise.resolve(new Response(JSON.stringify({ id: "em_1" }), { status: 200 }));
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => pool.end());

describe("forgot password", () => {
  it("emails a one-time link from the configured origin and stores only the token's hash", async () => {
    await request();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ from: "Kitpier <noreply@kitpier.test>", to: [EMAIL] });
    expect(sent[0].text).toContain("https://kitpier.test/reset#token=");
    const token = linkToken();
    const { rows } = await pool.query("SELECT token_hash FROM password_resets");
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toContain(token);
  });

  it("sends nothing for an unknown address but answers the same way", async () => {
    const r = await requestPasswordReset("nobody@example.com", "1.1.1.1");
    await r.delivery;
    expect(sent).toHaveLength(0);
    expect((await pool.query("SELECT 1 FROM password_resets")).rowCount).toBe(0);
  });

  it("resets the password once, bumps the session version, and burns the link", async () => {
    await request();
    const token = linkToken();
    const out = await resetPassword(token, "brand-new-password", "2.2.2.2");
    expect(out).toEqual({ userId: "usr_o", sessionVersion: 1 });
    const { rows } = await pool.query("SELECT password_hash, session_version FROM users WHERE id = 'usr_o'");
    expect(await bcrypt.compare("brand-new-password", rows[0].password_hash)).toBe(true);
    expect(rows[0].session_version).toBe(1);
    await expect(resetPassword(token, "another-password-1", "2.2.2.2")).rejects.toMatchObject({ status: 400 });
  });

  it("a new request replaces the old link", async () => {
    await request();
    const first = linkToken();
    await request();
    await expect(resetPassword(first, "brand-new-password", "2.2.2.2")).rejects.toMatchObject({ status: 400 });
    await expect(resetPassword(linkToken(), "brand-new-password", "2.2.2.2")).resolves.toMatchObject({ userId: "usr_o" });
  });

  it("rejects expired and made-up links", async () => {
    await request();
    const token = linkToken();
    await pool.query("UPDATE password_resets SET expires_at = now() - interval '1 second'");
    await expect(resetPassword(token, "brand-new-password", "2.2.2.2")).rejects.toMatchObject({ status: 400 });
    await expect(resetPassword("x".repeat(43), "brand-new-password", "2.2.2.2")).rejects.toMatchObject({ status: 400 });
    const { rows } = await pool.query("SELECT session_version FROM users WHERE id = 'usr_o'");
    expect(rows[0].session_version).toBe(0); // nothing changed
  });

  it("limits requests per address and per IP", async () => {
    for (let i = 0; i < 3; i++) await request(EMAIL, `9.9.9.${i}`);
    await expect(requestPasswordReset(EMAIL, "9.9.9.9")).rejects.toMatchObject({ status: 429 });
    for (let i = 0; i < 10; i++) await request(`x${i}@example.com`, "8.8.8.8");
    await expect(requestPasswordReset("y@example.com", "8.8.8.8")).rejects.toMatchObject({ status: 429 });
  });

  it("doesn't send when platform mail isn't configured", async () => {
    const key = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await request();
    expect(sent).toHaveLength(0);
    process.env.RESEND_API_KEY = key;
    err.mockRestore();
  });
});
