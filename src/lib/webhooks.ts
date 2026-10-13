import type pg from "pg";
import { one, pool, tx } from "./db";
import { post } from "./ledger";
import { applyVerifiedOrderTx, type OrderRow } from "./orders";
import { PayPalError, captureOrder, getOrder, valueToMicros, type PayPalOrder } from "./paypal";
import { HttpError } from "./session";

export type PayPalEvent = {
  id: string;
  event_type: string;
  resource: {
    id?: string;
    status?: string;
    amount?: { value: string; currency_code: string };
    custom_id?: string;
    supplementary_data?: { related_ids?: { order_id?: string } };
    links?: { href: string; rel: string }[];
    disputed_transactions?: { seller_transaction_id?: string }[];
  };
};

const CAPTURE_EVENTS = new Set(["PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.PENDING"]);
const APPROVED = "CHECKOUT.ORDER.APPROVED";

/** Records the event id; returns false if we've already processed it (duplicate delivery). */
async function claim(c: pg.PoolClient, e: PayPalEvent) {
  const r = await c.query(
    "INSERT INTO webhook_events (id, event_type, resource_id) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
    [e.id, e.event_type, e.resource.id ?? null],
  );
  return r.rowCount === 1;
}

const orderByCapture = (c: pg.PoolClient, captureId: string) =>
  one<OrderRow>(c, "SELECT * FROM orders WHERE capture_id = $1 FOR UPDATE", [captureId]);

/**
 * Handles an event whose signature has ALREADY been verified. Any PayPal reads happen before the
 * transaction; the event claim and its effects then commit together (SPEC §4.1), so a crash
 * before commit means PayPal's retry is processed normally.
 */
export async function handleVerifiedEvent(e: PayPalEvent): Promise<string> {
  let ppOrder: PayPalOrder | null = null;
  let ourOrderId: string | null = null;
  if (e.event_type === APPROVED) {
    // The buyer approved but the browser may never call our capture route (popup closed, tab
    // killed). Capture server-side; same request id as the browser path, so it's idempotent.
    const row = e.resource.id
      ? await one<{ id: string; status: string }>(pool, "SELECT id, status FROM orders WHERE paypal_order_id = $1", [
          e.resource.id,
        ])
      : undefined;
    if (!row) return "ignored:unknown_order";
    if (row.status === "created" || row.status === "approved") {
      try {
        await captureOrder(e.resource.id!);
      } catch (err) {
        if (!(err instanceof PayPalError && err.issue === "ORDER_ALREADY_CAPTURED")) throw err;
      }
    }
    ourOrderId = row.id;
    ppOrder = await getOrder(e.resource.id!);
  } else if (CAPTURE_EVENTS.has(e.event_type)) {
    const ppOrderId = e.resource.supplementary_data?.related_ids?.order_id;
    const row = ppOrderId
      ? await one<{ id: string }>(pool, "SELECT id FROM orders WHERE paypal_order_id = $1", [ppOrderId])
      : undefined;
    if (!row) return "ignored:unknown_order";
    ourOrderId = row.id;
    ppOrder = await getOrder(ppOrderId!); // re-read from PayPal; same checks as the sync path
  }

  return tx(async (c) => {
    if (!(await claim(c, e))) return "duplicate";
    switch (e.event_type) {
      case APPROVED:
      case "PAYMENT.CAPTURE.COMPLETED":
      case "PAYMENT.CAPTURE.PENDING": {
        try {
          return `order:${await applyVerifiedOrderTx(c, ourOrderId!, ppOrder!)}`;
        } catch (err) {
          if (err instanceof HttpError && err.code === "verify_failed") return "rejected:verify_failed";
          throw err;
        }
      }
      case "PAYMENT.CAPTURE.DECLINED": {
        const ppOrderId = e.resource.supplementary_data?.related_ids?.order_id;
        await c.query(
          "UPDATE orders SET status = 'failed', updated_at = now() WHERE paypal_order_id = $1 AND status <> 'credited'",
          [ppOrderId],
        );
        return "order:failed";
      }
      case "PAYMENT.CAPTURE.REFUNDED": {
        // resource = the refund; its "up" link points at the capture.
        const up = e.resource.links?.find((l) => l.rel === "up")?.href ?? "";
        const captureId = up.split("/captures/")[1]?.split(/[/?]/)[0];
        const order = captureId ? await orderByCapture(c, captureId) : undefined;
        if (!order || !e.resource.id || !e.resource.amount) return "ignored:unknown_capture";
        await post(c, {
          userId: order.user_id,
          projectId: order.project_id,
          source: `refund:${e.resource.id}`,
          kind: "refund",
          amountMicros: -valueToMicros(e.resource.amount.value),
        });
        await c.query(
          "UPDATE refund_requests SET state = 'completed', updated_at = now() WHERE paypal_refund_id = $1 AND state IN ('held','sent')",
          [e.resource.id],
        );
        return "refund:posted";
      }
      case "PAYMENT.CAPTURE.REVERSED": {
        const order = e.resource.id ? await orderByCapture(c, e.resource.id) : undefined;
        if (!order) return "ignored:unknown_capture";
        await post(c, {
          userId: order.user_id,
          projectId: order.project_id,
          source: `reversal:${order.capture_id}`,
          kind: "reversal",
          amountMicros: -order.amount_micros,
        });
        await c.query("UPDATE orders SET status = 'reversed', updated_at = now() WHERE id = $1", [order.id]);
        await c.query("UPDATE users SET frozen = true WHERE id = $1", [order.user_id]);
        return "reversal:posted";
      }
      case "CUSTOMER.DISPUTE.CREATED": {
        const ids = (e.resource.disputed_transactions ?? []).map((t) => t.seller_transaction_id).filter(Boolean);
        const r = await c.query(
          "UPDATE users SET frozen = true WHERE id IN (SELECT user_id FROM orders WHERE capture_id = ANY($1))",
          [ids],
        );
        return `dispute:frozen:${r.rowCount}`;
      }
      default:
        return "ignored:event_type";
    }
  });
}
