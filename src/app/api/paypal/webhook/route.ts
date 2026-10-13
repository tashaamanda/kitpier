import { NextResponse } from "next/server";
import { clientIp } from "@/lib/session";
import { rateLimit } from "@/lib/http";
import { verifyWebhookSignature } from "@/lib/paypal";
import { handleVerifiedEvent, type PayPalEvent } from "@/lib/webhooks";

// Public by necessity; authenticated by PayPal's signature (SPEC §11). No origin check: server-to-server.
export async function POST(req: Request) {
  try {
    await rateLimit(`webhook:${await clientIp()}`, 300, 60_000);
  } catch {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }
  const raw = await req.text();
  let event: PayPalEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!event?.id || !event?.event_type) return NextResponse.json({ error: "bad event" }, { status: 400 });
  let verified = false;
  try {
    verified = await verifyWebhookSignature(req.headers, event);
  } catch (e) {
    console.error("webhook verify error", e);
    return NextResponse.json({ error: "verify unavailable" }, { status: 503 }); // PayPal retries
  }
  if (!verified) return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  try {
    const outcome = await handleVerifiedEvent(event);
    console.log(`webhook ${event.event_type} ${event.id}: ${outcome}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("webhook processing failed", e);
    return NextResponse.json({ error: "processing failed" }, { status: 500 }); // PayPal retries
  }
}
