import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("./paypal", async (orig) => {
  const real = await orig<typeof import("./paypal")>();
  return { ...real, captureOrder: vi.fn(), getOrder: vi.fn(), createOrder: vi.fn() };
});

const { pool } = await import("./db");
const paypal = await import("./paypal");
const { applyVerifiedOrder, captureForUser } = await import("./orders");
const { handleVerifiedEvent } = await import("./webhooks");
const { postedBalance } = await import("./ledger");

const userA = { id: "usr_a", email: "a@test", name: "A", frozen: false };
const userB = { id: "usr_b", email: "b@test", name: "B", frozen: false };

function ppOrder(o: {
  orderId: string;
  value?: string;
  currency?: string;
  merchant?: string;
  status?: string;
  captureId?: string;
}) {
  return {
    id: `PP_${o.orderId}`,
    status: "COMPLETED",
    purchase_units: [
      {
        custom_id: o.orderId,
        payee: { merchant_id: o.merchant ?? "TESTMERCHANT" },
        payments: {
          captures: [
            {
              id: o.captureId ?? `CAP_${o.orderId}`,
              status: o.status ?? "COMPLETED",
              custom_id: o.orderId,
              amount: { currency_code: o.currency ?? "USD", value: o.value ?? "10.00" },
            },
          ],
        },
      },
    ],
  };
}

async function seedOrder(id: string, user = userA) {
  await pool.query(
    "INSERT INTO orders (id, paypal_order_id, user_id, project_id, pack_id, amount_micros) VALUES ($1, $2, $3, $4, 'p10', 10000000)",
    [id, `PP_${id}`, user.id, `prj_${user.id}`],
  );
}

const balance = (u = userA) => postedBalance(pool, u.id);

beforeEach(async () => {
  await pool.query(
    "TRUNCATE ledger_entries, orders, webhook_events, refund_requests, usage_events, reservations, user_balances, rate_limits, projects, users CASCADE",
  );
  for (const u of [userA, userB]) {
    await pool.query("INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, 'x')", [
      u.id,
      u.email,
      u.name,
    ]);
    await pool.query("INSERT INTO projects (id, user_id, name) VALUES ($1, $2, 'p')", [`prj_${u.id}`, u.id]);
  }
  vi.mocked(paypal.captureOrder).mockReset();
  vi.mocked(paypal.getOrder).mockReset();
});

afterAll(() => pool.end());

describe("§12 #1 capture verification", () => {
  for (const [name, bad] of [
    ["wrong amount", { value: "9.99" }],
    ["wrong currency", { currency: "EUR" }],
    ["wrong payee", { merchant: "SOMEONEELSE" }],
    ["not completed", { status: "DECLINED" }],
  ] as const) {
    it(`${name} → no credit`, async () => {
      await seedOrder("ord_1");
      await expect(applyVerifiedOrder("ord_1", ppOrder({ orderId: "ord_1", ...bad }))).rejects.toMatchObject({
        status: 402,
      });
      expect(await balance()).toBe(0);
    });
  }

  it("valid capture credits exactly the pack amount", async () => {
    await seedOrder("ord_1");
    expect(await applyVerifiedOrder("ord_1", ppOrder({ orderId: "ord_1" }))).toBe("credited");
    expect(await balance()).toBe(10_000_000);
  });
});

describe("§12 #2 idempotency", () => {
  it("duplicate capture + webhook credit once", async () => {
    await seedOrder("ord_1");
    vi.mocked(paypal.getOrder).mockResolvedValue(ppOrder({ orderId: "ord_1" }));
    await applyVerifiedOrder("ord_1", ppOrder({ orderId: "ord_1" }));
    await applyVerifiedOrder("ord_1", ppOrder({ orderId: "ord_1" }));
    const event = {
      id: "WH-1",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: { id: "CAP_ord_1", supplementary_data: { related_ids: { order_id: "PP_ord_1" } } },
    };
    await handleVerifiedEvent(event);
    expect(await handleVerifiedEvent(event)).toBe("duplicate");
    expect(await balance()).toBe(10_000_000);
  });

  it("PENDING then COMPLETED webhook credits exactly once", async () => {
    await seedOrder("ord_1");
    expect(await applyVerifiedOrder("ord_1", ppOrder({ orderId: "ord_1", status: "PENDING" }))).toBe("capture_pending");
    expect(await balance()).toBe(0);
    vi.mocked(paypal.getOrder).mockResolvedValue(ppOrder({ orderId: "ord_1" }));
    const completed = {
      id: "WH-2",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: { id: "CAP_ord_1", supplementary_data: { related_ids: { order_id: "PP_ord_1" } } },
    };
    expect(await handleVerifiedEvent(completed)).toBe("order:credited");
    expect(await handleVerifiedEvent({ ...completed, id: "WH-3" })).toBe("order:credited");
    expect(await balance()).toBe(10_000_000);
  });
});

describe("approved webhook (browser never captured)", () => {
  it("server captures on ORDER.APPROVED and a later browser capture doesn't double-credit", async () => {
    await seedOrder("ord_1");
    vi.mocked(paypal.captureOrder).mockResolvedValue(ppOrder({ orderId: "ord_1" }));
    vi.mocked(paypal.getOrder).mockResolvedValue(ppOrder({ orderId: "ord_1" }));
    const approved = { id: "WH-A", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: "PP_ord_1" } };
    expect(await handleVerifiedEvent(approved)).toBe("order:credited");
    expect(paypal.captureOrder).toHaveBeenCalledWith("PP_ord_1");
    expect(await captureForUser(userA, "PP_ord_1")).toEqual({ status: "credited" });
    expect(await balance()).toBe(10_000_000);
  });

  it("approved event for an unknown order changes nothing", async () => {
    expect(
      await handleVerifiedEvent({ id: "WH-X", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: "PP_nope" } }),
    ).toBe("ignored:unknown_order");
    expect(paypal.captureOrder).not.toHaveBeenCalled();
  });
});

describe("§12 #3 order ownership", () => {
  it("another user's order → 404 and PayPal is never called", async () => {
    await seedOrder("ord_1", userA);
    await expect(captureForUser(userB, "PP_ord_1")).rejects.toMatchObject({ status: 404 });
    expect(paypal.captureOrder).not.toHaveBeenCalled();
    expect(await balance(userB)).toBe(0);
  });

  it("owner capture credits; declined capture adds nothing", async () => {
    await seedOrder("ord_1");
    vi.mocked(paypal.captureOrder).mockResolvedValue(ppOrder({ orderId: "ord_1" }));
    vi.mocked(paypal.getOrder).mockResolvedValue(ppOrder({ orderId: "ord_1" }));
    expect(await captureForUser(userA, "PP_ord_1")).toEqual({ status: "credited" });

    await seedOrder("ord_2");
    vi.mocked(paypal.captureOrder).mockRejectedValue(new paypal.PayPalError(422, "INSTRUMENT_DECLINED", "declined"));
    await expect(captureForUser(userA, "PP_ord_2")).rejects.toMatchObject({ status: 402, code: "INSTRUMENT_DECLINED" });
    expect(await balance()).toBe(10_000_000);
  });
});

describe("§12 #5 reversal and dispute", () => {
  it("reversal posts full negative entry once and freezes the user", async () => {
    await seedOrder("ord_1");
    await applyVerifiedOrder("ord_1", ppOrder({ orderId: "ord_1" }));
    const ev = { id: "WH-R", event_type: "PAYMENT.CAPTURE.REVERSED", resource: { id: "CAP_ord_1" } };
    expect(await handleVerifiedEvent(ev)).toBe("reversal:posted");
    expect(await handleVerifiedEvent({ ...ev, id: "WH-R2" })).toBe("reversal:posted"); // new event id, same reversal source
    expect(await balance()).toBe(0);
    const u = await pool.query("SELECT frozen FROM users WHERE id = $1", [userA.id]);
    expect(u.rows[0].frozen).toBe(true);
  });

  it("dispute freezes the owning user only", async () => {
    await seedOrder("ord_1");
    await applyVerifiedOrder("ord_1", ppOrder({ orderId: "ord_1" }));
    await handleVerifiedEvent({
      id: "WH-D",
      event_type: "CUSTOMER.DISPUTE.CREATED",
      resource: { disputed_transactions: [{ seller_transaction_id: "CAP_ord_1" }] },
    });
    const r = await pool.query("SELECT id, frozen FROM users ORDER BY id");
    expect(r.rows).toEqual([
      { id: "usr_a", frozen: true },
      { id: "usr_b", frozen: false },
    ]);
  });

  it("refund webhook debits once, keyed on refund id", async () => {
    await seedOrder("ord_1");
    await applyVerifiedOrder("ord_1", ppOrder({ orderId: "ord_1" }));
    const ev = {
      id: "WH-F",
      event_type: "PAYMENT.CAPTURE.REFUNDED",
      resource: {
        id: "REF_1",
        amount: { value: "3.00", currency_code: "USD" },
        links: [{ rel: "up", href: "https://api.sandbox.paypal.com/v2/payments/captures/CAP_ord_1" }],
      },
    };
    await handleVerifiedEvent(ev);
    await handleVerifiedEvent({ ...ev, id: "WH-F2" });
    expect(await balance()).toBe(7_000_000);
  });
});

describe("money parsing", () => {
  it("valueToMicros is exact", () => {
    expect(paypal.valueToMicros("10.00")).toBe(10_000_000);
    expect(paypal.valueToMicros("0.07")).toBe(70_000);
    expect(paypal.valueToMicros("9.99")).toBe(9_990_000);
  });
});
