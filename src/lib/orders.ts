import type pg from "pg";
import { newId, one, pool, tx } from "./db";
import { post } from "./ledger";
import { CURRENCY, PACKS, type PackId } from "./packs";
import { PayPalError, captureOrder, createOrder, getOrder, verifyCapture, type PayPalOrder } from "./paypal";
import { requireProjectOwner } from "./projects";
import { HttpError, type User } from "./session";
import { claimTopUpForOrder } from "./topup";

export type OrderRow = {
  id: string;
  paypal_order_id: string | null;
  user_id: string;
  project_id: string;
  pack_id: PackId;
  amount_micros: number;
  currency: string;
  status: "created" | "approved" | "capture_pending" | "credited" | "failed" | "cancelled" | "reversed";
  capture_id: string | null;
  top_up_id: string | null;
  budget_raise_micros: number;
};

const isSandbox = () => (process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com").includes("sandbox");

/** Creates our order row first (its id seeds custom_id + PayPal-Request-Id), then the PayPal order. */
export async function startOrder(user: User, projectId: string, packId: PackId, topUpId?: string) {
  const project = await requireProjectOwner(user, projectId);
  const pack = PACKS[packId];
  const topUp = topUpId ? await claimTopUpForOrder(pool, { userId: user.id, projectId: project.id }, topUpId, packId) : null;
  if (isSandbox()) {
    // SPEC §5: at most 1 credited pack per user per day in sandbox (abuse + demo hygiene).
    const today = await one<{ n: number }>(
      pool,
      "SELECT count(*)::int AS n FROM orders WHERE user_id = $1 AND status = 'credited' AND updated_at > now() - interval '1 day'",
      [user.id],
    );
    if ((today?.n ?? 0) >= 1) throw new HttpError(429, "Sandbox limit: one credit pack per day", "pack_limit");
  }
  const id = newId("ord");
  await pool.query(
    `INSERT INTO orders (id, user_id, project_id, pack_id, amount_micros, currency, top_up_id, budget_raise_micros)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, user.id, project.id, packId, pack.amountMicros, CURRENCY, topUpId ?? null, topUp?.budgetRaiseMicros ?? 0],
  );
  const pp = await createOrder({
    orderId: id,
    amountMicros: pack.amountMicros,
    currency: CURRENCY,
    description: `Kitpier service credits for "${project.name}"`,
    items: [{ name: `${pack.label} (closed-loop service credits)`, amountMicros: pack.amountMicros }],
  });
  await pool.query("UPDATE orders SET paypal_order_id = $1, updated_at = now() WHERE id = $2", [pp.id, id]);
  return { orderId: id, paypalOrderId: pp.id };
}

/**
 * Applies a verified PayPal order to our records. Shared by the synchronous capture route and
 * the COMPLETED/PENDING webhook, both keyed on capture:<id>, so whichever arrives first wins.
 */
export function applyVerifiedOrder(ourOrderId: string, ppOrder: PayPalOrder) {
  return tx((c) => applyVerifiedOrderTx(c, ourOrderId, ppOrder));
}

export async function applyVerifiedOrderTx(c: pg.PoolClient, ourOrderId: string, ppOrder: PayPalOrder) {
  const order = await one<OrderRow>(c, "SELECT * FROM orders WHERE id = $1 FOR UPDATE", [ourOrderId]);
  if (!order) throw new HttpError(404, "Order not found");
  const v = verifyCapture(ppOrder, { orderId: order.id, amountMicros: order.amount_micros, currency: order.currency });
  if (!v.ok) {
    console.warn(`order ${order.id} failed verification: ${v.reason}`);
    throw new HttpError(402, "Payment could not be verified", "verify_failed");
  }
  if (order.status === "credited" || order.status === "reversed") return order.status;
  if (v.capture.status === "PENDING") {
    await c.query("UPDATE orders SET status = 'capture_pending', capture_id = $1, updated_at = now() WHERE id = $2", [
      v.capture.captureId,
      order.id,
    ]);
    return "capture_pending" as const;
  }
  await post(c, {
    userId: order.user_id,
    projectId: order.project_id,
    source: `capture:${v.capture.captureId}`,
    kind: "purchase",
    amountMicros: order.amount_micros,
  });
  // A top-up raises the project's monthly budget in the same transaction as the credit, exactly once
  // (the row lock and the 'credited' early return above guard replays).
  if (order.budget_raise_micros > 0)
    await c.query("UPDATE projects SET budget_micros = budget_micros + $2 WHERE id = $1 AND budget_micros IS NOT NULL", [
      order.project_id,
      order.budget_raise_micros,
    ]);
  if (order.top_up_id)
    await c.query("UPDATE top_up_proposals SET status = 'paid', order_id = $2, decided_at = now() WHERE id = $1 AND status = 'proposed'", [
      order.top_up_id,
      order.id,
    ]);
  await c.query("UPDATE orders SET status = 'credited', capture_id = $1, updated_at = now() WHERE id = $2", [
    v.capture.captureId,
    order.id,
  ]);
  return "credited" as const;
}

/** Capture route: the order must belong to the session user (404 otherwise, SPEC §4.1). */
export async function captureForUser(user: User, paypalOrderId: string) {
  const order = await one<OrderRow>(pool, "SELECT * FROM orders WHERE paypal_order_id = $1 AND user_id = $2", [
    paypalOrderId,
    user.id,
  ]);
  if (!order) throw new HttpError(404, "Order not found");
  if (order.status === "credited") return { status: "credited" as const };
  try {
    await captureOrder(paypalOrderId);
  } catch (e) {
    // Already captured (e.g. a retry after a dropped response): fall through to GET-verify.
    if (!(e instanceof PayPalError && e.issue === "ORDER_ALREADY_CAPTURED")) {
      if (e instanceof PayPalError && e.status === 422) {
        await pool.query(
          "UPDATE orders SET status = 'failed', updated_at = now() WHERE id = $1 AND status IN ('created','approved')",
          [order.id],
        );
        throw new HttpError(402, "PayPal declined this payment. No credits were added.", e.issue ?? "declined");
      }
      throw e;
    }
  }
  const status = await applyVerifiedOrder(order.id, await getOrder(paypalOrderId));
  return { status };
}
