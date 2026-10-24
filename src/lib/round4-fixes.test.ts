import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression tests for the four follow-ups in Codex's Round 4 verification (docs/round4-verification-2026-10-24.md,
// probes in docs/audit-2026-10-24/round4-reproductions.test.ts.txt). Each probe is kept with its assertion turned into
// the corrected invariant, plus the cases its acceptance criteria name. PayPal is mocked; nothing calls a provider.
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("./paypal", async (orig) => ({
  ...(await orig<typeof import("./paypal")>()),
  getOrder: vi.fn(),
  createOrder: vi.fn(),
  captureOrder: vi.fn(),
}));
process.env.APP_URL = "http://localhost:3005";
process.env.CREDENTIALS_MASTER_KEY = randomBytes(32).toString("base64");
process.env.PLATFORM_DAILY_AI_CAP_MICROS = "20000000";

const { pool } = await import("./db");
const { post, postedBalance } = await import("./ledger");
const { reserveTurn, settleTurn } = await import("./billing");
const { reservePlatform, settlePlatform } = await import("./platform");
const { handleVerifiedEvent } = await import("./webhooks");
const { startOrder, applyVerifiedOrder, captureForUser, SANDBOX_DAILY } = await import("./orders");
const { proposeTopUp } = await import("./topup");
const { createApprovalLink, approvalView } = await import("./approvals");
const paypal = await import("./paypal");

const A = { userId: "r4_user", projectId: "r4_project" };
const userA = { id: A.userId, email: "r4@test", name: "R4", frozen: false };
const START = 1_000_000;
const BUDGET = 30_000_000;

beforeEach(async () => {
  await pool.query(
    "TRUNCATE approval_links, reservations, usage_events, ledger_entries, user_balances, platform_daily_spend, platform_usage, webhook_events, deferred_payment_events, orders, top_up_proposals, rate_limits, projects, users CASCADE",
  );
  await pool.query("INSERT INTO users (id, email, name, password_hash) VALUES ($1, 'r4@test', 'R4', 'x')", [A.userId]);
  await pool.query("INSERT INTO projects (id, user_id, name, budget_micros) VALUES ($1, $2, 'R4', $3)", [A.projectId, A.userId, BUDGET]);
  await post(pool, { userId: A.userId, source: "capture:seed", kind: "purchase", amountMicros: START });
  vi.mocked(paypal.createOrder).mockImplementation(async ({ orderId }: { orderId: string }) => ({ id: `PP_${orderId}` }) as never);
  vi.mocked(paypal.captureOrder).mockResolvedValue({} as never);
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(() => pool.end());

const balance = () => postedBalance(pool, A.userId);
const budget = async () => (await pool.query("SELECT budget_micros FROM projects WHERE id = $1", [A.projectId])).rows[0].budget_micros;
const count = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0].n as number;

/** A verified PayPal order for one of our orders, as GET /v2/checkout/orders returns it. */
function pp(orderId: string, captureStatus: "COMPLETED" | "PENDING", captureId = `CAP_${orderId}`, value = "10.00") {
  return {
    id: `PP_${orderId}`,
    status: "COMPLETED",
    purchase_units: [
      {
        custom_id: orderId,
        payee: { merchant_id: "TESTMERCHANT" },
        payments: { captures: [{ id: captureId, status: captureStatus, amount: { value, currency_code: "USD" } }] },
      },
    ],
  } as never;
}

describe("R4-1: a top-up's budget raise needs current consent", () => {
  it("an open approval page can't start checkout after its budget changed (probe, corrected)", async () => {
    const top = await proposeTopUp(A, "p10");
    const link = await createApprovalLink(A);
    await pool.query("UPDATE projects SET budget_micros = 100000000 WHERE id = $1", [A.projectId]);
    expect((await approvalView(A.userId, link.approval_id)).items[0].state).toBe("stale");
    await expect(
      startOrder(userA, A.projectId, "p10", { id: top.id, budgetSeenMicros: BUDGET, approvalId: link.approval_id }),
    ).rejects.toMatchObject({ status: 409, code: "stale" });
    // The same card from the planner (no link) is refused too: the budget it showed is no longer the budget.
    await expect(startOrder(userA, A.projectId, "p10", { id: top.id, budgetSeenMicros: BUDGET })).rejects.toMatchObject({
      status: 409,
      code: "budget_changed",
    });
    expect(await count("SELECT count(*)::int AS n FROM orders")).toBe(0);
  });

  it("an expired approval link can't start checkout", async () => {
    const top = await proposeTopUp(A, "p10");
    const link = await createApprovalLink(A);
    await pool.query("UPDATE approval_links SET expires_at = now() - interval '1 second' WHERE id = $1", [link.approval_id]);
    await expect(
      startOrder(userA, A.projectId, "p10", { id: top.id, budgetSeenMicros: BUDGET, approvalId: link.approval_id }),
    ).rejects.toMatchObject({ status: 409, code: "stale" });
  });

  it("paying from a live link raises the budget exactly as shown", async () => {
    const top = await proposeTopUp(A, "p10");
    const link = await createApprovalLink(A);
    const o = await startOrder(userA, A.projectId, "p10", { id: top.id, budgetSeenMicros: BUDGET, approvalId: link.approval_id });
    expect(await applyVerifiedOrder(o.orderId, pp(o.orderId, "COMPLETED"))).toBe("credited");
    expect(await budget()).toBe(BUDGET + 10_000_000);
    expect(await balance()).toBe(START + 10_000_000);
    expect((await pool.query("SELECT status FROM top_up_proposals WHERE id = $1", [top.id])).rows[0].status).toBe("paid");
  });

  it("a budget change after checkout started doesn't silently expand the new cap; the payment is still credited", async () => {
    const top = await proposeTopUp(A, "p10");
    const o = await startOrder(userA, A.projectId, "p10", { id: top.id, budgetSeenMicros: BUDGET });
    await pool.query("UPDATE projects SET budget_micros = 100000000 WHERE id = $1", [A.projectId]);
    expect(await applyVerifiedOrder(o.orderId, pp(o.orderId, "COMPLETED"))).toBe("credited");
    expect(await budget()).toBe(100_000_000); // not 110
    expect(await balance()).toBe(START + 10_000_000); // the payment isn't discarded
    expect((await pool.query("SELECT status FROM top_up_proposals WHERE id = $1", [top.id])).rows[0].status).toBe("superseded");
  });

  it("several orders for one consent raise the budget once, sequential or concurrent", async () => {
    const top = await proposeTopUp(A, "p10");
    const orders = [];
    for (let i = 0; i < 3; i++) orders.push(await startOrder(userA, A.projectId, "p10", { id: top.id, budgetSeenMicros: BUDGET }));
    await Promise.all(orders.map((o) => applyVerifiedOrder(o.orderId, pp(o.orderId, "COMPLETED"))));
    expect(await budget()).toBe(BUDGET + 10_000_000);
    expect(await balance()).toBe(START + 30_000_000); // every payment credited
    // Replays of the winning order change nothing.
    await applyVerifiedOrder(orders[0].orderId, pp(orders[0].orderId, "COMPLETED"));
    expect(await budget()).toBe(BUDGET + 10_000_000);
  });
});

describe("R4-2: open checkouts count against the sandbox allowance", () => {
  it("pre-opened checkouts can't exceed the count (probe, corrected)", async () => {
    const opened = [];
    for (let i = 0; i < SANDBOX_DAILY.orders; i++) opened.push(await startOrder(userA, A.projectId, "p10"));
    await expect(startOrder(userA, A.projectId, "p10")).rejects.toMatchObject({ status: 429, code: "pack_limit" });
    for (const o of opened) await applyVerifiedOrder(o.orderId, pp(o.orderId, "COMPLETED"));
    expect(await count("SELECT count(*)::int AS n FROM orders WHERE status = 'credited'")).toBe(SANDBOX_DAILY.orders);
    expect(await balance()).toBe(START + SANDBOX_DAILY.orders * 10_000_000);
  });

  it("parallel starts respect the count", async () => {
    const r = await Promise.allSettled(Array.from({ length: 6 }, () => startOrder(userA, A.projectId, "p10")));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(SANDBOX_DAILY.orders);
    expect(r.filter((x) => x.status === "rejected").every((x) => (x as PromiseRejectedResult).reason.code === "pack_limit")).toBe(true);
  });

  it("parallel starts respect the value", async () => {
    const r = await Promise.allSettled([
      startOrder(userA, A.projectId, "p50"),
      startOrder(userA, A.projectId, "p50"),
      startOrder(userA, A.projectId, "p25"),
    ]);
    const micros = await count("SELECT COALESCE(SUM(amount_micros), 0)::bigint AS n FROM orders WHERE status = 'created'");
    expect(micros).toBeLessThanOrEqual(SANDBOX_DAILY.micros);
    expect(r.filter((x) => x.status === "rejected").length).toBeGreaterThan(0);
  });

  it("abandoned checkouts release their share when the hold lapses; a failed PayPal create releases at once", async () => {
    for (let i = 0; i < SANDBOX_DAILY.orders; i++) await startOrder(userA, A.projectId, "p10");
    await expect(startOrder(userA, A.projectId, "p10")).rejects.toMatchObject({ code: "pack_limit" });
    await pool.query("UPDATE orders SET quota_until = now() - interval '1 second'");
    await expect(startOrder(userA, A.projectId, "p10")).resolves.toHaveProperty("paypalOrderId");

    vi.mocked(paypal.createOrder).mockRejectedValueOnce(new Error("PayPal down"));
    await expect(startOrder(userA, A.projectId, "p10")).rejects.toThrow("PayPal down");
    expect(await count("SELECT count(*)::int AS n FROM orders WHERE status = 'cancelled'")).toBe(1);
  });

  it("a late capture can't get past the limit: it's cancelled before any money moves", async () => {
    const late = await startOrder(userA, A.projectId, "p10");
    const lateHook = await startOrder(userA, A.projectId, "p10");
    await pool.query("UPDATE orders SET quota_until = now() - interval '1 second'");
    for (let i = 0; i < SANDBOX_DAILY.orders; i++) await startOrder(userA, A.projectId, "p10");
    await expect(captureForUser(userA, late.paypalOrderId)).rejects.toMatchObject({ status: 429, code: "pack_limit" });
    // The server-side capture (CHECKOUT.ORDER.APPROVED webhook) refuses the same way.
    expect(await handleVerifiedEvent({ id: "R4_APPROVED", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: lateHook.paypalOrderId } })).toBe(
      "rejected:pack_limit",
    );
    expect(paypal.captureOrder).not.toHaveBeenCalled();
    expect(await count("SELECT count(*)::int AS n FROM orders WHERE id = ANY($1) AND status = 'cancelled'", [[late.orderId, lateHook.orderId]])).toBe(2);
  });

  it("a late capture that still fits is admitted and credited", async () => {
    const late = await startOrder(userA, A.projectId, "p10");
    await pool.query("UPDATE orders SET quota_until = now() - interval '1 second'");
    vi.mocked(paypal.getOrder).mockResolvedValue(pp(late.orderId, "COMPLETED"));
    await expect(captureForUser(userA, late.paypalOrderId)).resolves.toEqual({ status: "credited" });
    expect(paypal.captureOrder).toHaveBeenCalledTimes(1);
  });
});

/**
 * Holds the first transaction right after it locks its day row, until another backend is seen waiting on a lock
 * (or 3s pass, so a fixed lock order can never hang the test). The waiting backend is the concurrent sweep.
 */
function gateFirstDayLock() {
  let locked!: () => void;
  const ready = new Promise<void>((r) => (locked = r));
  const realConnect = pool.connect.bind(pool);
  let first = true;
  // pool.query calls connect with a callback, which this spy doesn't serve: restore it (vi.restoreAllMocks) before
  // using pool.query again.
  vi.spyOn(pool, "connect").mockImplementation((async () => {
    const c = await realConnect();
    const q = c.query.bind(c);
    const gated = first;
    first = false;
    c.query = (async (...args: unknown[]) => {
      const out = await q(...(args as Parameters<typeof q>));
      const sql = String(args[0]);
      if (gated && sql.startsWith("SELECT 1 FROM platform_daily_spend WHERE day = $1 FOR UPDATE")) {
        locked();
        const until = Date.now() + 3000;
        for (;;) {
          const w = await realConnect().then(async (p) => {
            try {
              return (await p.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()")).rows[0].n;
            } finally {
              p.release();
            }
          });
          if (w > 0 || Date.now() > until) break;
          await new Promise((r) => setTimeout(r, 20));
        }
      }
      return out;
    }) as typeof c.query;
    return c;
  }) as typeof pool.connect);
  return ready;
}

describe("R4-3: sweeping old reservations and settling them can't deadlock", () => {
  for (const daysAgo of [1, 35]) {
    it(`booking: a sweep racing the normal settlement of a reservation ${daysAgo} days old (probe, corrected)`, async () => {
      const r = await reserveTurn(A, "old", 1000);
      await pool.query("INSERT INTO platform_daily_spend (day, reserved_micros) VALUES (current_date - $1::int, 1000)", [daysAgo]);
      await pool.query("UPDATE platform_daily_spend SET reserved_micros = 0 WHERE day = current_date");
      await pool.query("UPDATE reservations SET day = current_date - $2::int, expires_at = now() - interval '1 second' WHERE id = $1", [r.id, daysAgo]);
      const ready = gateFirstDayLock();
      const settling = settleTurn(r.id);
      await ready;
      const sweeping = reserveTurn(A, "new", 0);
      const results = await Promise.allSettled([settling, sweeping]);
      vi.restoreAllMocks();
      expect(results.map((x) => x.status)).toEqual(["fulfilled", "fulfilled"]);
      expect((await pool.query("SELECT state FROM reservations WHERE id = $1", [r.id])).rows[0].state).toMatch(/settled/);
      const old = (await pool.query("SELECT reserved_micros FROM platform_daily_spend WHERE day = current_date - $1::int", [daysAgo])).rows[0];
      expect(old.reserved_micros).toBe(0); // released exactly once
      expect(await count("SELECT count(*)::int AS n FROM ledger_entries WHERE source = $1", [`usage:${r.id}`])).toBeLessThanOrEqual(1);
    });
  }

  it("planner: a sweep racing the normal settlement of yesterday's run", async () => {
    const u = await reservePlatform(A.userId, A.projectId, 5000);
    await pool.query("INSERT INTO platform_daily_spend (day, reserved_micros) VALUES (current_date - 1, 5000)");
    await pool.query("UPDATE platform_daily_spend SET reserved_micros = 0 WHERE day = current_date");
    await pool.query("UPDATE platform_usage SET day = current_date - 1, expires_at = now() - interval '1 second' WHERE id = $1", [u.id]);
    const ready = gateFirstDayLock();
    const settling = settlePlatform(u.id);
    await ready;
    const sweeping = reservePlatform(A.userId, A.projectId, 1000);
    const results = await Promise.allSettled([settling, sweeping]);
    vi.restoreAllMocks();
    expect(results.map((x) => x.status)).toEqual(["fulfilled", "fulfilled"]);
    const y = (await pool.query("SELECT reserved_micros FROM platform_daily_spend WHERE day = current_date - 1")).rows[0];
    expect(y.reserved_micros).toBe(0);
  });
});

describe("R4-4: a reversal debits only credits that were granted", () => {
  const ORDER = "r4_order";
  const CAP = `CAP_${ORDER}`;
  const seedOrder = () =>
    pool.query("INSERT INTO orders (id, paypal_order_id, user_id, project_id, pack_id, amount_micros) VALUES ($1, $2, $3, $4, 'p10', 10000000)", [
      ORDER,
      `PP_${ORDER}`,
      A.userId,
      A.projectId,
    ]);
  const reverse = (id: string) => handleVerifiedEvent({ id, event_type: "PAYMENT.CAPTURE.REVERSED", resource: { id: CAP } });
  const entries = async (kind: string) => count("SELECT count(*)::int AS n FROM ledger_entries WHERE source = $1", [`${kind}:${CAP}`]);
  const held = async () => (await pool.query("SELECT frozen FROM users WHERE id = $1", [A.userId])).rows[0].frozen;
  const status = async () => (await pool.query("SELECT status FROM orders WHERE id = $1", [ORDER])).rows[0].status;

  it("reversal → PENDING → COMPLETED nets to zero with the purchase recorded (probe, corrected)", async () => {
    await seedOrder();
    await reverse("R4_REV");
    await applyVerifiedOrder(ORDER, pp(ORDER, "PENDING"));
    expect(await balance()).toBe(START); // nothing granted, nothing taken
    expect(await held()).toBe(true);
    expect(await applyVerifiedOrder(ORDER, pp(ORDER, "COMPLETED"))).toBe("reversed");
    expect(await balance()).toBe(START);
    expect(await entries("capture")).toBe(1);
    expect(await entries("reversal")).toBe(1);
    expect(await status()).toBe("reversed");
  });

  it("a reversal while the capture is pending freezes without a debit; completion then records both", async () => {
    await seedOrder();
    await applyVerifiedOrder(ORDER, pp(ORDER, "PENDING"));
    await reverse("R4_REV");
    expect(await balance()).toBe(START);
    expect(await held()).toBe(true);
    expect(await status()).toBe("reversed");
    await applyVerifiedOrder(ORDER, pp(ORDER, "COMPLETED"));
    expect(await balance()).toBe(START);
    expect(await entries("capture")).toBe(1);
    expect(await entries("reversal")).toBe(1);
  });

  it("completion before a delayed PENDING observation stays credited", async () => {
    await seedOrder();
    expect(await applyVerifiedOrder(ORDER, pp(ORDER, "COMPLETED"))).toBe("credited");
    expect(await applyVerifiedOrder(ORDER, pp(ORDER, "PENDING"))).toBe("credited");
    expect(await balance()).toBe(START + 10_000_000);
  });

  it("duplicate reversals and completions converge: one purchase, one debit, held", async () => {
    await seedOrder();
    await applyVerifiedOrder(ORDER, pp(ORDER, "COMPLETED"));
    await reverse("R4_REV_1");
    await reverse("R4_REV_2");
    await reverse("R4_REV_1"); // redelivery
    await applyVerifiedOrder(ORDER, pp(ORDER, "COMPLETED"));
    expect(await balance()).toBe(START);
    expect(await entries("capture")).toBe(1);
    expect(await entries("reversal")).toBe(1);
    expect(await held()).toBe(true);
  });

  it("a refund that arrives while the capture is pending waits for the credit, then lands once", async () => {
    await seedOrder();
    const refund = {
      id: "R4_REFUND",
      event_type: "PAYMENT.CAPTURE.REFUNDED",
      resource: { id: "REF_1", amount: { value: "4.00", currency_code: "USD" }, links: [{ rel: "up", href: `https://api.paypal.com/v2/payments/captures/${CAP}` }] },
    };
    await applyVerifiedOrder(ORDER, pp(ORDER, "PENDING"));
    expect(await handleVerifiedEvent(refund)).toBe("deferred:PAYMENT.CAPTURE.REFUNDED");
    expect(await balance()).toBe(START);
    await applyVerifiedOrder(ORDER, pp(ORDER, "COMPLETED"));
    expect(await balance()).toBe(START + 6_000_000);
    await applyVerifiedOrder(ORDER, pp(ORDER, "COMPLETED"));
    expect(await balance()).toBe(START + 6_000_000);
  });
});
