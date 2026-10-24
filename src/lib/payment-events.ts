import type pg from "pg";
import { one } from "./db";
import { post } from "./ledger";
import type { OrderRow } from "./orders";
import { valueToMicros } from "./paypal";

// Refund, reversal and dispute effects for one PayPal capture (docs/security-and-submission-audit-2026-10-24.md F3).
// PayPal can deliver these before we've linked the capture to an order. Such an event is kept as deferred (not just
// marked processed) and applied in the same transaction that links the capture, so every arrival order ends the same.
// Both paths take the capture's advisory lock first, then the order row: one lock order, so no deadlocks, and an
// event and the link can't miss each other.

export type CaptureEventType = "PAYMENT.CAPTURE.REFUNDED" | "PAYMENT.CAPTURE.REVERSED" | "CUSTOMER.DISPUTE.CREATED";
export type CaptureResource = { id?: string; amount?: { value: string; currency_code: string } };

export async function lockCapture(c: pg.PoolClient, captureId: string) {
  await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`capture:${captureId}`]);
}

/** True if the purchase for this capture is on the ledger (credits were actually granted). */
export async function purchasePosted(c: pg.PoolClient, captureId: string) {
  return !!(await one(c, "SELECT 1 FROM ledger_entries WHERE source = $1", [`capture:${captureId}`]));
}

/**
 * The effect itself, for an order we know. Idempotent: ledger sources are unique, freezing twice is a no-op. Debits
 * only take back credits that were granted (R4-4): on a capture that is still pending, a reversal freezes and marks
 * the order reversed (orders.ts records purchase + reversal together if it later completes), and a refund waits.
 * null = not applicable yet; keep it deferred.
 */
async function apply(c: pg.PoolClient, type: CaptureEventType, order: OrderRow, resource: CaptureResource): Promise<string | null> {
  if (type === "CUSTOMER.DISPUTE.CREATED") {
    await c.query("UPDATE users SET frozen = true WHERE id = $1", [order.user_id]);
    return "dispute:frozen";
  }
  const credited = !!order.capture_id && (await purchasePosted(c, order.capture_id));
  if (type === "PAYMENT.CAPTURE.REVERSED") {
    await c.query("UPDATE users SET frozen = true WHERE id = $1", [order.user_id]);
    await c.query("UPDATE orders SET status = 'reversed', updated_at = now() WHERE id = $1", [order.id]);
    if (!credited) return "reversal:frozen_uncredited";
    await post(c, { userId: order.user_id, projectId: order.project_id, source: `reversal:${order.capture_id}`, kind: "reversal", amountMicros: -order.amount_micros });
    return "reversal:posted";
  }
  if (!resource.id || !resource.amount) return "ignored:incomplete_refund";
  if (!credited) return null;
  await post(c, { userId: order.user_id, projectId: order.project_id, source: `refund:${resource.id}`, kind: "refund", amountMicros: -valueToMicros(resource.amount.value) });
  await c.query("UPDATE refund_requests SET state = 'completed', updated_at = now() WHERE paypal_refund_id = $1 AND state IN ('held','sent')", [resource.id]);
  return "refund:posted";
}

async function defer(c: pg.PoolClient, eventId: string, captureId: string, type: CaptureEventType, resource: CaptureResource) {
  await c.query(
    `INSERT INTO deferred_payment_events (event_id, capture_id, event_type, resource) VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [eventId, captureId, type, JSON.stringify(resource)],
  );
  return `deferred:${type}`;
}

/** A verified webhook event for one capture: applied now if the capture is linked (and credited, for a refund), otherwise deferred. */
export async function captureEventTx(c: pg.PoolClient, eventId: string, type: CaptureEventType, captureId: string, resource: CaptureResource) {
  await lockCapture(c, captureId);
  const order = await one<OrderRow>(c, "SELECT * FROM orders WHERE capture_id = $1 FOR UPDATE", [captureId]);
  const done = order ? await apply(c, type, order, resource) : null;
  return done ?? defer(c, eventId, captureId, type, resource);
}

/** Called right after a capture is linked or credited (caller holds lockCapture and the order row). */
export async function applyDeferredTx(c: pg.PoolClient, captureId: string) {
  const events = await c.query<{ event_id: string; event_type: CaptureEventType; resource: CaptureResource }>(
    "SELECT event_id, event_type, resource FROM deferred_payment_events WHERE capture_id = $1 AND applied_at IS NULL ORDER BY created_at FOR UPDATE",
    [captureId],
  );
  for (const e of events.rows) {
    // Re-read each time: a reversal changes the order's status for the events after it.
    const order = await one<OrderRow>(c, "SELECT * FROM orders WHERE capture_id = $1", [captureId]);
    if (!order) return;
    if ((await apply(c, e.event_type, order, e.resource)) === null) continue; // still waiting for credit
    await c.query("UPDATE deferred_payment_events SET applied_at = now() WHERE event_id = $1 AND capture_id = $2", [e.event_id, captureId]);
  }
}

/** The capture id a PayPal order will be linked under (same pick as verifyCapture), for taking the lock early. */
export function captureIdOf(ppOrder: { purchase_units?: { payments?: { captures?: { id: string }[] } }[] }) {
  return ppOrder.purchase_units?.[0]?.payments?.captures?.[0]?.id ?? null;
}
