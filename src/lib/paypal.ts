// Minimal PayPal REST client (sandbox by default). Adapted from the arisan prototype (SPEC §18):
// payee is now the platform merchant, verified by merchant id instead of a per-winner email.

const BASE = process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com";

let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET not set");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status}`);
  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  cached = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cached.token;
}

export class PayPalError extends Error {
  constructor(
    public status: number,
    public issue: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: { method: string; body?: unknown; requestId?: string }): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      ...(init.requestId ? { "PayPal-Request-Id": init.requestId } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as {
    details?: { issue?: string }[];
  };
  if (!res.ok) {
    const issue = json.details?.[0]?.issue;
    throw new PayPalError(
      res.status,
      issue,
      `PayPal ${init.method} ${path} failed: ${res.status} ${issue ?? ""} (debug ${res.headers.get("paypal-debug-id")})`,
    );
  }
  return json as T;
}

export function microsToValue(micros: number) {
  return (micros / 1_000_000).toFixed(2);
}

export function valueToMicros(value: string) {
  // Exact for 2-decimal currency strings; avoids float drift.
  const [whole, frac = ""] = value.split(".");
  return Number(whole) * 1_000_000 + Number((frac + "000000").slice(0, 6));
}

export type OrderInput = {
  orderId: string; // our id → custom_id + reference_id
  amountMicros: number;
  currency: string;
  description: string;
  items: { name: string; amountMicros: number }[];
};

export async function createOrder(input: OrderInput) {
  const total = microsToValue(input.amountMicros);
  return call<{ id: string; status: string }>("/v2/checkout/orders", {
    method: "POST",
    requestId: `create-${input.orderId}`,
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: input.orderId,
          custom_id: input.orderId,
          description: input.description.slice(0, 127),
          amount: {
            currency_code: input.currency,
            value: total,
            breakdown: {
              item_total: { currency_code: input.currency, value: total },
            },
          },
          items: input.items.map((i) => ({
            name: i.name.slice(0, 127),
            quantity: "1",
            category: "DIGITAL_GOODS",
            unit_amount: {
              currency_code: input.currency,
              value: microsToValue(i.amountMicros),
            },
          })),
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW",
          },
        },
      },
    },
  });
}

export type PayPalOrder = {
  id: string;
  status: string;
  purchase_units: {
    reference_id?: string;
    custom_id?: string;
    payee?: { merchant_id?: string; email_address?: string };
    payments?: {
      captures?: {
        id: string;
        status: string;
        custom_id?: string;
        amount: { currency_code: string; value: string };
      }[];
    };
  }[];
};

export function captureOrder(paypalOrderId: string) {
  return call<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
    method: "POST",
    requestId: `capture-${paypalOrderId}`,
  });
}

export function getOrder(paypalOrderId: string) {
  return call<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`, { method: "GET" });
}

export type VerifiedCapture = {
  captureId: string;
  status: "COMPLETED" | "PENDING";
};

/**
 * Trust nothing from the browser: confirm the order (as re-read from PayPal) is ours and
 * matches what we sold. Returns the capture state; only COMPLETED may be credited.
 */
export function verifyCapture(
  order: PayPalOrder,
  expected: { orderId: string; amountMicros: number; currency: string },
): { ok: true; capture: VerifiedCapture } | { ok: false; reason: string } {
  const merchantId = process.env.PAYPAL_MERCHANT_ID;
  if (!merchantId) throw new Error("PAYPAL_MERCHANT_ID not set");
  const unit = order.purchase_units?.[0];
  const cap = unit?.payments?.captures?.[0];
  if (!unit || !cap) return { ok: false, reason: "no capture" };
  if (unit.payee?.merchant_id !== merchantId) return { ok: false, reason: "payee mismatch" };
  if (cap.custom_id !== expected.orderId && unit.custom_id !== expected.orderId)
    return { ok: false, reason: "order mismatch" };
  if (cap.amount.currency_code !== expected.currency || valueToMicros(cap.amount.value) !== expected.amountMicros)
    return { ok: false, reason: "amount mismatch" };
  if (cap.status === "COMPLETED") return { ok: true, capture: { captureId: cap.id, status: "COMPLETED" } };
  if (cap.status === "PENDING") return { ok: true, capture: { captureId: cap.id, status: "PENDING" } };
  return { ok: false, reason: `capture status ${cap.status}` };
}

/** Webhook authenticity via PayPal's verify API. The event must be passed exactly as received. */
export async function verifyWebhookSignature(h: Headers, event: unknown): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false; // fail closed
  const get = (k: string) => h.get(k);
  if (!get("paypal-transmission-id") || !get("paypal-transmission-sig")) return false;
  let res: { verification_status: string };
  try {
    res = await call<{ verification_status: string }>("/v1/notifications/verify-webhook-signature", {
      method: "POST",
      body: {
        auth_algo: get("paypal-auth-algo"),
        cert_url: get("paypal-cert-url"),
        transmission_id: get("paypal-transmission-id"),
        transmission_sig: get("paypal-transmission-sig"),
        transmission_time: get("paypal-transmission-time"),
        webhook_id: webhookId,
        webhook_event: event,
      },
    });
  } catch (e) {
    // PayPal rejecting the request (4xx: forged/garbled headers) means "not verified";
    // only outages (5xx/network) propagate so the caller can ask PayPal to retry.
    if (e instanceof PayPalError && e.status < 500) return false;
    throw e;
  }
  return res.verification_status === "SUCCESS";
}
