import type pg from "pg";
import { newId, one, pool, tx } from "./db";
import { post } from "./ledger";
import { CURRENCY, PACKS, type PackId } from "./packs";
import { PayPalError, captureOrder, createOrder, getOrder, verifyCapture, type PayPalOrder } from "./paypal";
import { requireProjectOwner } from "./projects";
import { HttpError, type User } from "./session";
import { applyDeferredTx, captureIdOf, lockCapture, purchasePosted } from "./payment-events";
import { requireTopUpOnLink } from "./approvals";
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
  budget_before_micros: number | null;
  quota_until: string | null;
};

/** Per account, per rolling 24 hours, in sandbox. */
export const SANDBOX_DAILY = { orders: 3, micros: 75_000_000 };
/** How long an open checkout holds its share of that allowance. A later capture re-checks before money moves. */
export const CHECKOUT_HOLD_MINUTES = 15;

const isSandbox = () => (process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com").includes("sandbox");

/** Serializes every sandbox-allowance decision for one account (order starts and late captures). */
async function lockAllowance(c: pg.PoolClient, userId: string) {
  await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`order-allowance:${userId}`]);
}

/**
 * Throws 429 if one more pack would go over the account's sandbox allowance (R4-2). Counts what was paid or is
 * clearing in the last day plus every checkout still holding its share, so opening checkouts first can't get past it.
 * Caller holds lockAllowance.
 */
async function checkAllowance(c: pg.PoolClient, userId: string, amountMicros: number, except?: string) {
  if (!isSandbox()) return;
  const day = await one<{ n: number; micros: number }>(
    c,
    `SELECT count(*)::int AS n, COALESCE(SUM(amount_micros), 0)::bigint AS micros FROM orders
     WHERE user_id = $1 AND id IS DISTINCT FROM $2 AND (
       (status IN ('credited', 'capture_pending') AND updated_at > now() - interval '1 day')
       OR (status IN ('created', 'approved') AND quota_until > now()))`,
    [userId, except ?? null],
  );
  if ((day?.n ?? 0) >= SANDBOX_DAILY.orders || (day?.micros ?? 0) + amountMicros > SANDBOX_DAILY.micros)
    throw new HttpError(429, `Sandbox limit: ${SANDBOX_DAILY.orders} credit packs or $${SANDBOX_DAILY.micros / 1_000_000} a day per account`, "pack_limit");
}

export type TopUpConsent = { id: string; budgetSeenMicros: number | null; approvalId?: string };

/** Creates our order row first (its id seeds custom_id + PayPal-Request-Id), then the PayPal order. */
export async function startOrder(user: User, projectId: string, packId: PackId, topUp?: TopUpConsent) {
  const project = await requireProjectOwner(user, projectId);
  const pack = PACKS[packId];
  const s = { userId: user.id, projectId: project.id };
  if (topUp?.approvalId) await requireTopUpOnLink(pool, user.id, topUp.approvalId, project.id, topUp.id);
  const id = newId("ord");
  // Sandbox credits buy real AI usage, so purchases are bounded per account per rolling day, by count and value.
  // The limits leave room for the demo's purchase-then-top-up within one session; the global daily AI cap still
  // bounds total spend. Server-side only: no client flag can lift them. The check and the order row that holds its
  // share commit together under the account's lock; PayPal is called after, outside the transaction.
  await tx(async (c) => {
    await lockAllowance(c, user.id);
    await checkAllowance(c, user.id, pack.amountMicros);
    const t = topUp ? await claimTopUpForOrder(c, s, topUp.id, packId, topUp.budgetSeenMicros) : null;
    await c.query(
      `INSERT INTO orders (id, user_id, project_id, pack_id, amount_micros, currency, top_up_id, budget_raise_micros,
         budget_before_micros, quota_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + ($10 || ' minutes')::interval)`,
      [id, user.id, project.id, packId, pack.amountMicros, CURRENCY, topUp?.id ?? null, t?.budgetRaiseMicros ?? 0, t?.budgetBeforeMicros ?? null, String(CHECKOUT_HOLD_MINUTES)],
    );
  });
  let pp: { id: string };
  try {
    pp = await createOrder({
      orderId: id,
      amountMicros: pack.amountMicros,
      currency: CURRENCY,
      description: `Kitpier service credits for "${project.name}"`,
      items: [{ name: `${pack.label} (closed-loop service credits)`, amountMicros: pack.amountMicros }],
    });
  } catch (e) {
    // No PayPal order, no checkout: give its share of the allowance back.
    await pool.query("UPDATE orders SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status = 'created'", [id]);
    throw e;
  }
  await pool.query("UPDATE orders SET paypal_order_id = $1, updated_at = now() WHERE id = $2", [pp.id, id]);
  return { orderId: id, paypalOrderId: pp.id };
}

/**
 * Before we capture (the moment money moves): an open checkout whose hold lapsed, or that failed and is being
 * retried, must fit the allowance again. If it doesn't, it's cancelled and never captured, so the buyer is never
 * charged for credits we'd withhold. False = don't capture.
 */
export async function admitCapture(orderId: string) {
  return tx(async (c) => {
    const o = await one<{ user_id: string }>(c, "SELECT user_id FROM orders WHERE id = $1", [orderId]);
    if (!o) return false;
    await lockAllowance(c, o.user_id);
    const order = await one<OrderRow & { held: boolean }>(c, "SELECT *, quota_until > now() AS held FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
    if (!order || order.status === "cancelled") return false;
    if (!["created", "approved", "failed"].includes(order.status)) return true; // already captured: just verify it
    if (order.status !== "failed" && order.held) return true;
    try {
      await checkAllowance(c, order.user_id, order.amount_micros, order.id);
    } catch (e) {
      if (!(e instanceof HttpError && e.code === "pack_limit")) throw e;
      await c.query("UPDATE orders SET status = 'cancelled', updated_at = now() WHERE id = $1", [order.id]);
      return false;
    }
    await c.query(
      `UPDATE orders SET status = CASE WHEN status = 'failed' THEN 'approved' ELSE status END,
         quota_until = now() + ($2 || ' minutes')::interval, updated_at = now() WHERE id = $1`,
      [order.id, String(CHECKOUT_HOLD_MINUTES)],
    );
    return true;
  });
}

/**
 * Applies a verified PayPal order to our records. Shared by the synchronous capture route and
 * the COMPLETED/PENDING webhook, both keyed on capture:<id>, so whichever arrives first wins.
 */
export function applyVerifiedOrder(ourOrderId: string, ppOrder: PayPalOrder) {
  return tx((c) => applyVerifiedOrderTx(c, ourOrderId, ppOrder));
}

export async function applyVerifiedOrderTx(c: pg.PoolClient, ourOrderId: string, ppOrder: PayPalOrder) {
  // Capture lock before the order row (payment-events.ts lock order), so an early refund/reversal/dispute for this
  // capture is either already deferred (applied below) or waits and then finds the linked order.
  const captureId = captureIdOf(ppOrder);
  if (captureId) await lockCapture(c, captureId);
  const order = await one<OrderRow>(c, "SELECT * FROM orders WHERE id = $1 FOR UPDATE", [ourOrderId]);
  if (!order) throw new HttpError(404, "Order not found");
  const v = verifyCapture(ppOrder, { orderId: order.id, amountMicros: order.amount_micros, currency: order.currency });
  if (!v.ok) {
    console.warn(`order ${order.id} failed verification: ${v.reason}`);
    throw new HttpError(402, "Payment could not be verified", "verify_failed");
  }
  if (order.status === "credited") return order.status;
  if (order.status === "reversed") {
    // Reversed before we saw it complete (R4-4): the reversal froze the account but debited nothing, because no
    // credits had been granted. Once PayPal reports it completed, record the purchase and its reversal together (net
    // zero, idempotent by source). No budget raise and no top-up: that payment is gone.
    if (v.capture.status === "COMPLETED" && !(await purchasePosted(c, v.capture.captureId))) {
      await c.query("UPDATE orders SET capture_id = $1, updated_at = now() WHERE id = $2", [v.capture.captureId, order.id]);
      await post(c, { userId: order.user_id, projectId: order.project_id, source: `capture:${v.capture.captureId}`, kind: "purchase", amountMicros: order.amount_micros });
      await post(c, { userId: order.user_id, projectId: order.project_id, source: `reversal:${v.capture.captureId}`, kind: "reversal", amountMicros: -order.amount_micros });
    }
    return "reversed" as const;
  }
  if (v.capture.status === "PENDING") {
    await c.query("UPDATE orders SET status = 'capture_pending', capture_id = $1, updated_at = now() WHERE id = $2", [
      v.capture.captureId,
      order.id,
    ]);
    // Only effects that don't need granted credits land now (a hold, a reversal's freeze); refunds wait for credit.
    await applyDeferredTx(c, v.capture.captureId);
    const now = await one<{ status: string }>(c, "SELECT status FROM orders WHERE id = $1", [order.id]);
    return now?.status === "reversed" ? ("reversed" as const) : ("capture_pending" as const);
  }
  await post(c, {
    userId: order.user_id,
    projectId: order.project_id,
    source: `capture:${v.capture.captureId}`,
    kind: "purchase",
    amountMicros: order.amount_micros,
  });
  // A top-up raises the monthly budget in the same transaction as the credit (R4-1): once per top-up (the first
  // order to claim it; other orders for the same card just add credits), and only from the budget the owner saw. If
  // the budget changed since, the credits still land but the card is superseded: a new cap needs new consent.
  if (order.top_up_id) {
    const claimed = await one(
      c,
      "UPDATE top_up_proposals SET status = 'paid', order_id = $2, decided_at = now() WHERE id = $1 AND status = 'proposed' RETURNING 1",
      [order.top_up_id, order.id],
    );
    if (claimed && order.budget_raise_micros > 0) {
      const raised =
        order.budget_before_micros != null &&
        (await c.query("UPDATE projects SET budget_micros = budget_micros + $2 WHERE id = $1 AND budget_micros = $3", [
          order.project_id,
          order.budget_raise_micros,
          order.budget_before_micros,
        ])).rowCount === 1;
      if (!raised) await c.query("UPDATE top_up_proposals SET status = 'superseded' WHERE id = $1", [order.top_up_id]);
    }
  }
  await c.query("UPDATE orders SET status = 'credited', capture_id = $1, updated_at = now() WHERE id = $2", [
    v.capture.captureId,
    order.id,
  ]);
  await applyDeferredTx(c, v.capture.captureId); // an early dispute/refund/reversal lands now, in the same transaction
  const after = await one<{ status: string }>(c, "SELECT status FROM orders WHERE id = $1", [order.id]);
  return after?.status === "reversed" ? ("reversed" as const) : ("credited" as const);
}

/** Capture route: the order must belong to the session user (404 otherwise, SPEC §4.1). */
export async function captureForUser(user: User, paypalOrderId: string) {
  const order = await one<OrderRow>(pool, "SELECT * FROM orders WHERE paypal_order_id = $1 AND user_id = $2", [
    paypalOrderId,
    user.id,
  ]);
  if (!order) throw new HttpError(404, "Order not found");
  if (order.status === "credited") return { status: "credited" as const };
  if (!(await admitCapture(order.id)))
    throw new HttpError(429, "This checkout expired and today's sandbox limit is used up. No payment was taken.", "pack_limit");
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
