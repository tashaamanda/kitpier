import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression tests for the six failures Codex reproduced (docs/security-and-submission-audit-2026-10-24.md, saved
// reproductions in docs/audit-2026-10-24/). Each reproduction is kept, with its assertion turned into the correct
// behavior, plus the extra cases its acceptance criteria name. AI and PayPal are mocked; nothing calls a provider.
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    beta = {
      messages: {
        toolRunner: () =>
          (async function* () {
            yield { content: [{ type: "text", text: "Hello" }], stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 100 } };
          })(),
      },
    };
  },
}));
vi.mock("./paypal", async (orig) => ({ ...(await orig<typeof import("./paypal")>()), getOrder: vi.fn(), createOrder: vi.fn() }));
process.env.APP_URL = "http://localhost:3005";
process.env.ANTHROPIC_API_KEY = "synthetic-test";
process.env.CREDENTIALS_MASTER_KEY = randomBytes(32).toString("base64");
process.env.PLATFORM_DAILY_AI_CAP_MICROS = "20000000";
process.env.DEMO_SUPABASE_REF = "abcdefghijklmnopqrst";
process.env.DEMO_SUPABASE_SECRET_KEY = "synthetic-test";

const { pool } = await import("./db");
const { post, postedBalance } = await import("./ledger");
const { putCredential, getCredential } = await import("./credentials");
const { reserveTurn, claimBooking, confirmBookingWrite, releaseBooking, settleTurn, recordTurnUsage } = await import("./billing");
const { bookingTurn } = await import("./booking");
const { handleVerifiedEvent } = await import("./webhooks");
const { startOrder, SANDBOX_DAILY } = await import("./orders");
const { proposeTopUp } = await import("./topup");
const { reservePlatform } = await import("./platform");
const paypal = await import("./paypal");

const A = { userId: "audit_user", projectId: "audit_project" };
const userA = { id: A.userId, email: "audit@test", name: "Audit", frozen: false };
const START = 1_000_000;

beforeEach(async () => {
  await pool.query(
    "TRUNCATE turn_requests, conversation_messages, conversations, widgets, usage_events, reservations, ledger_entries, user_balances, platform_daily_spend, platform_usage, credentials, webhook_events, deferred_payment_events, orders, top_up_proposals, rate_limits, projects, users CASCADE",
  );
  await pool.query("INSERT INTO users (id, email, name, password_hash) VALUES ($1, 'audit@test', 'Audit', 'x')", [A.userId]);
  await pool.query("INSERT INTO projects (id, user_id, name, demo_connection, budget_micros) VALUES ($1, $2, 'Audit', true, 30000000)", [A.projectId, A.userId]);
  await pool.query(
    `INSERT INTO widgets (id, user_id, project_id, business_name, services, timezone) VALUES ('audit_widget', $1, $2, 'Audit', '["Haircut"]', 'UTC')`,
    [A.userId, A.projectId],
  );
  await post(pool, { userId: A.userId, source: "capture:seed", kind: "purchase", amountMicros: START });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
afterAll(() => pool.end());

const balance = () => postedBalance(pool, A.userId);

/** Make one statement fail once (simulating a crash or lost write at that boundary). */
function failOnce(prefix: string) {
  const original = pool.query.bind(pool);
  let armed = true;
  vi.spyOn(pool, "query").mockImplementation(((...args: unknown[]) => {
    if (armed && String(args[0]).startsWith(prefix)) {
      armed = false;
      return Promise.reject(new Error("synthetic failure"));
    }
    return original(...(args as Parameters<typeof original>));
  }) as typeof pool.query);
}

describe("F1: a retried message is charged once", () => {
  it("response persistence fails after the charge: the retry returns the original reply, no second charge", async () => {
    failOnce("UPDATE turn_requests SET status = 'done'");
    await expect(bookingTurn("audit_widget", null, "audit-retry-001", "hello", "127.0.0.8")).rejects.toThrow();
    expect(await balance()).toBe(START - 20_000);
    const retry = await bookingTurn("audit_widget", null, "audit-retry-001", "hello", "127.0.0.8");
    expect(retry.reply).toBe("Hello");
    expect(await balance()).toBe(START - 20_000);
  });

  it("the process died after charging (request left running): after 3 minutes a retry is reconciled, not re-run", async () => {
    const first = await bookingTurn("audit_widget", null, "audit-first-01", "hi", "127.0.0.8");
    const conv = first.conversationId;
    // A second message whose process died after settling: reserved (bound to the request), used, settled, no response.
    await pool.query("INSERT INTO turn_requests (widget_id, request_id, op_hash) VALUES ('audit_widget', 'audit-crash-01', NULL)");
    const r = await reserveTurn(A, conv, 1000, undefined, { widgetId: "audit_widget", requestId: "audit-crash-01" });
    await recordTurnUsage(r.id, 0, "claude-haiku-5-5", 10, 10);
    await settleTurn(r.id);
    await pool.query("UPDATE turn_requests SET created_at = now() - interval '4 minutes' WHERE request_id = 'audit-crash-01'");
    const charged = await balance();

    const retry = await bookingTurn("audit_widget", conv, "audit-crash-01", "and Tuesday?", "127.0.0.8");
    expect(retry.conversationId).toBe(conv);
    expect(retry.reply).toMatch(/something went wrong/);
    expect(await balance()).toBe(charged); // reconciled from what happened, not charged again
    expect(await bookingTurn("audit_widget", conv, "audit-crash-01", "and Tuesday?", "127.0.0.8")).toEqual(retry);
  });

  it("a crash before any charge is simply re-run", async () => {
    await pool.query("INSERT INTO turn_requests (widget_id, request_id, created_at) VALUES ('audit_widget', 'audit-early-01', now() - interval '4 minutes')");
    const r = await bookingTurn("audit_widget", null, "audit-early-01", "hello", "127.0.0.8");
    expect(r.reply).toBe("Hello");
    expect(await balance()).toBe(START - 20_000);
  });

  it("a request id reused with a different message is refused", async () => {
    await bookingTurn("audit_widget", null, "audit-reuse-01", "hello", "127.0.0.8");
    await expect(bookingTurn("audit_widget", null, "audit-reuse-01", "something else", "127.0.0.8")).rejects.toMatchObject({ status: 409 });
    expect(await balance()).toBe(START - 20_000);
  });
});

describe("F2: a booking is charged only when its write is confirmed", () => {
  it("a claim that crashed before the database insert is never charged", async () => {
    const r = await reserveTurn(A, "synthetic-conversation", 0, 50_000);
    expect(await claimBooking(r.id)).toBe(true);
    await pool.query("UPDATE reservations SET expires_at = now() - interval '1 second' WHERE id = $1", [r.id]);
    await reserveTurn(A, "another-conversation", 0, 50_000); // the sweep settles the expired claim
    expect(await balance()).toBe(START);
  });

  it("a confirmed write is charged exactly once; confirming after expiry charges nothing", async () => {
    const r = await reserveTurn(A, "c1", 0, 50_000);
    await claimBooking(r.id);
    expect(await confirmBookingWrite(r.id)).toBe(true);
    await settleTurn(r.id);
    await settleTurn(r.id);
    expect(await balance()).toBe(START - 50_000);

    const late = await reserveTurn(A, "c2", 0, 50_000);
    await claimBooking(late.id);
    await pool.query("UPDATE reservations SET expires_at = now() - interval '1 second' WHERE id = $1", [late.id]);
    await reserveTurn(A, "c3", 0, 50_000); // swept as an unknown outcome
    expect(await confirmBookingWrite(late.id)).toBe(false);
    expect(await balance()).toBe(START - 50_000);
  });

  it("a released claim (slot taken, write failed) is not charged", async () => {
    const r = await reserveTurn(A, "c1", 0, 50_000);
    await claimBooking(r.id);
    await releaseBooking(r.id);
    await settleTurn(r.id);
    expect(await balance()).toBe(START);
  });
});

describe("F3: refunds, reversals and disputes converge whatever order they arrive in", () => {
  const order = (status = "COMPLETED") => ({
    id: "PP_AUDIT",
    status: "COMPLETED",
    purchase_units: [{ custom_id: "audit_order", payee: { merchant_id: "TESTMERCHANT" }, payments: { captures: [{ id: "CAP_AUDIT", status, amount: { value: "10.00", currency_code: "USD" } }] } }],
  });
  const capture = { id: "AUDIT-CAPTURE", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "CAP_AUDIT", supplementary_data: { related_ids: { order_id: "PP_AUDIT" } } } };
  const dispute = { id: "AUDIT-DISPUTE", event_type: "CUSTOMER.DISPUTE.CREATED", resource: { disputed_transactions: [{ seller_transaction_id: "CAP_AUDIT" }] } };
  const frozen = async () => (await pool.query("SELECT frozen FROM users WHERE id = $1", [A.userId])).rows[0].frozen;

  beforeEach(async () => {
    await pool.query(
      "INSERT INTO orders (id, paypal_order_id, user_id, project_id, pack_id, amount_micros) VALUES ('audit_order', 'PP_AUDIT', $1, $2, 'p10', 10000000)",
      [A.userId, A.projectId],
    );
    vi.mocked(paypal.getOrder).mockResolvedValue(order() as never);
  });

  it("a dispute before the capture is linked still holds the account (reproduction, corrected)", async () => {
    expect(await handleVerifiedEvent(dispute)).toBe("deferred:CUSTOMER.DISPUTE.CREATED");
    expect(await frozen()).toBe(false); // nothing to hold yet
    await handleVerifiedEvent(capture);
    expect(await frozen()).toBe(true);
    expect(await balance()).toBe(START + 10_000_000);
    expect(await handleVerifiedEvent(dispute)).toBe("duplicate");
    expect((await pool.query("SELECT applied_at FROM deferred_payment_events")).rows[0].applied_at).not.toBeNull();
  });

  it("a reversal before the capture is linked is applied once the order is credited", async () => {
    await handleVerifiedEvent({ id: "AUDIT-REV", event_type: "PAYMENT.CAPTURE.REVERSED", resource: { id: "CAP_AUDIT" } });
    await handleVerifiedEvent(capture);
    expect(await balance()).toBe(START); // purchase and reversal both posted
    expect((await pool.query("SELECT status FROM orders WHERE id = 'audit_order'")).rows[0].status).toBe("reversed");
    expect(await frozen()).toBe(true);
  });

  it("a refund before the capture is linked is debited once, after linking", async () => {
    const refund = {
      id: "AUDIT-REF",
      event_type: "PAYMENT.CAPTURE.REFUNDED",
      resource: { id: "REF_AUDIT", amount: { value: "3.00", currency_code: "USD" }, links: [{ rel: "up", href: "https://api.sandbox.paypal.com/v2/payments/captures/CAP_AUDIT" }] },
    };
    await handleVerifiedEvent(refund);
    await handleVerifiedEvent(capture);
    await handleVerifiedEvent({ ...refund, id: "AUDIT-REF-2" }); // redelivered under a new event id: same refund source
    expect(await balance()).toBe(START + 7_000_000);
  });

  it("the same result in the normal order (capture first, then dispute)", async () => {
    await handleVerifiedEvent(capture);
    expect(await handleVerifiedEvent(dispute)).toBe("dispute:frozen");
    expect(await frozen()).toBe(true);
  });

  it("dispute and capture arriving at the same moment always end held", async () => {
    for (let round = 0; round < 5; round++) {
      await pool.query("TRUNCATE webhook_events, deferred_payment_events");
      await pool.query("UPDATE orders SET status = 'created', capture_id = NULL WHERE id = 'audit_order'");
      await pool.query("UPDATE users SET frozen = false WHERE id = $1", [A.userId]);
      await pool.query("DELETE FROM ledger_entries WHERE source = 'capture:CAP_AUDIT'");
      await Promise.all([handleVerifiedEvent({ ...dispute, id: `D-${round}` }), handleVerifiedEvent({ ...capture, id: `C-${round}` })]);
      expect(await frozen()).toBe(true);
      expect(await balance()).toBe(START + 10_000_000);
    }
  });
});

describe("F4: the advertised same-day top-up works, within explicit sandbox limits", () => {
  beforeEach(() => {
    vi.mocked(paypal.createOrder).mockImplementation(async ({ orderId }: { orderId: string }) => ({ id: `PP_${orderId}` }) as never);
  });
  const credited = (id: string, micros = 10_000_000) =>
    pool.query(
      "INSERT INTO orders (id, paypal_order_id, user_id, project_id, pack_id, amount_micros, status) VALUES ($1, $2, $3, $4, 'p10', $5, 'credited')",
      [id, `PP_${id}`, A.userId, A.projectId, micros],
    );

  it("a credited purchase earlier today doesn't block the approved top-up (reproduction, corrected)", async () => {
    await credited("already_paid");
    const top = await proposeTopUp(A, "p10");
    await expect(startOrder(userA, A.projectId, "p10", { id: top.id, budgetSeenMicros: 30_000_000 })).resolves.toMatchObject({ paypalOrderId: expect.stringMatching(/^PP_/) });
  });

  it("counts are bounded per account per day", async () => {
    for (let i = 0; i < SANDBOX_DAILY.orders; i++) await credited(`paid_${i}`);
    await expect(startOrder(userA, A.projectId, "p10")).rejects.toMatchObject({ status: 429, code: "pack_limit" });
  });

  it("value is bounded per account per day", async () => {
    await credited("big", SANDBOX_DAILY.micros - 5_000_000);
    await expect(startOrder(userA, A.projectId, "p10")).rejects.toMatchObject({ status: 429, code: "pack_limit" });
  });
});

describe("F5: concurrent first credential writes stay decryptable", () => {
  it("two first writes racing (reproduction, corrected)", async () => {
    const original = pool.query.bind(pool);
    let reads = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.spyOn(pool, "query").mockImplementation(((...args: unknown[]) => {
      if (String(args[0]).startsWith("SELECT id FROM credentials WHERE project_id"))
        return (async () => {
          const r = await original(...(args as Parameters<typeof original>));
          if (++reads === 2) release();
          await Promise.race([gate, new Promise((r) => setTimeout(r, 200))]); // with the lock, the 2nd read waits for the 1st write
          return r;
        })();
      return original(...(args as Parameters<typeof original>));
    }) as typeof pool.query);
    await Promise.all([putCredential(A, "resend_send_key", "synthetic-1"), putCredential(A, "resend_send_key", "synthetic-2")]);
    expect(["synthetic-1", "synthetic-2"]).toContain((await getCredential(A, "resend_send_key"))?.secret);
  });

  it("many concurrent writes (connect, reconnect, refresh) leave one readable row", async () => {
    await Promise.all(Array.from({ length: 8 }, (_, i) => putCredential(A, "supabase_oauth", `token-${i}`)));
    const rows = await pool.query("SELECT 1 FROM credentials WHERE project_id = $1", [A.projectId]);
    expect(rows.rowCount).toBe(1);
    expect((await getCredential(A, "supabase_oauth"))?.secret).toMatch(/^token-\d$/);
  });
});

describe("F6: expired reservations from earlier days are released", () => {
  async function stranded(daysAgo: string) {
    await pool.query("DELETE FROM ledger_entries");
    await post(pool, { userId: A.userId, source: "capture:tiny", kind: "purchase", amountMicros: 70_000 });
    const r = await reserveTurn(A, "old-conversation", 0);
    await pool.query(`UPDATE reservations SET day = ${daysAgo}, expires_at = now() - interval '1 day' WHERE id = $1`, [r.id]);
    return r.id;
  }

  it("yesterday's (reproduction, corrected)", async () => {
    const id = await stranded("current_date - 1");
    await expect(reserveTurn(A, "new-conversation", 0)).resolves.toMatchObject({ id: expect.any(String) });
    expect((await pool.query("SELECT state FROM reservations WHERE id = $1", [id])).rows[0].state).toBe("expired_settled");
  });

  it("across a month boundary", async () => {
    const id = await stranded("date_trunc('month', current_date)::date - 1");
    await expect(reserveTurn(A, "new-conversation", 0)).resolves.toBeTruthy();
    expect((await pool.query("SELECT state FROM reservations WHERE id = $1", [id])).rows[0].state).toBe("expired_settled");
  });

  it("the planner's platform reservations from earlier days are released against their own day", async () => {
    const old = await reservePlatform(A.userId, A.projectId, 5_000);
    await pool.query("INSERT INTO platform_daily_spend (day, reserved_micros) VALUES (current_date - 1, 5000) ON CONFLICT DO NOTHING");
    await pool.query("UPDATE platform_daily_spend SET reserved_micros = reserved_micros - 5000 WHERE day = current_date");
    await pool.query("UPDATE platform_usage SET day = current_date - 1, expires_at = now() - interval '1 day' WHERE id = $1", [old.id]);
    await reservePlatform(A.userId, A.projectId, 5_000);
    expect((await pool.query("SELECT state FROM platform_usage WHERE id = $1", [old.id])).rows[0].state).toBe("expired_settled");
    const y = (await pool.query("SELECT reserved_micros, exposure_micros FROM platform_daily_spend WHERE day = current_date - 1")).rows[0];
    expect(y).toEqual({ reserved_micros: 0, exposure_micros: 5000 });
  });
});
