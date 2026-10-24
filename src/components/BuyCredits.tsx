"use client";

import { useState } from "react";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { api, usd } from "@/lib/client";

const CLIENT_ID = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
const PACKS = [
  { id: "p10", micros: 10_000_000 },
  { id: "p25", micros: 25_000_000 },
  { id: "p50", micros: 50_000_000 },
] as const;

type PackId = (typeof PACKS)[number]["id"];

/**
 * With topUpId, the pack is fixed by the assistant's top-up card and the picker is hidden. budgetSeenMicros is the
 * monthly budget the card showed; the server refuses checkout if it changed since (and approvalId must still be live).
 */
export default function BuyCredits({
  projectId,
  onPaid,
  fixedPack,
  topUpId,
  budgetSeenMicros,
  approvalId,
}: {
  projectId: string;
  onPaid: () => void;
  fixedPack?: PackId;
  topUpId?: string;
  budgetSeenMicros?: number | null;
  approvalId?: string;
}) {
  const [picked, setPack] = useState<PackId>("p10");
  const pack = fixedPack ?? picked;
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  if (!CLIENT_ID)
    return <p className="text-sm text-danger">PayPal isn&apos;t configured (NEXT_PUBLIC_PAYPAL_CLIENT_ID).</p>;

  return (
    // Packs and the PayPal button fill the card edge to edge; disableMaxWidth lifts PayPal's 750px cap.
    <div className="space-y-3">
      {!fixedPack && (
      <div className="grid grid-cols-3 gap-2">
        {PACKS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPack(p.id)}
            className={`min-h-11 rounded-full border px-5 text-sm ${pack === p.id ? "border-ink bg-ink text-white" : "border-line bg-card"}`}
          >
            {usd(p.micros)}
          </button>
        ))}
      </div>
      )}
      <PayPalScriptProvider options={{ clientId: CLIENT_ID, currency: "USD", intent: "capture" }}>
        <PayPalButtons
          forceReRender={[pack]}
          style={{ layout: "vertical", shape: "pill", label: "pay", height: 45, disableMaxWidth: true }}
          fundingSource="paypal"
          createOrder={async () => {
            setMsg(null);
            const { paypalOrderId } = await api<{ paypalOrderId: string }>("/api/orders", {
              body: topUpId ? { projectId, pack, topUpId, budgetSeenMicros: budgetSeenMicros ?? null, approvalId } : { projectId, pack },
            });
            return paypalOrderId;
          }}
          onApprove={async (data) => {
            try {
              const r = await api<{ status: string }>(`/api/orders/${data.orderID}/capture`, {
                method: "POST",
                body: {},
              });
              setMsg(
                r.status === "credited"
                  ? { kind: "ok", text: "Payment verified. Credits added." }
                  : { kind: "ok", text: "Payment is pending at PayPal. Credits appear when it clears." },
              );
              onPaid();
            } catch (e) {
              setMsg({ kind: "err", text: (e as Error).message });
            }
          }}
          onCancel={() => setMsg({ kind: "err", text: "Checkout cancelled. No credits were added." })}
          onError={(e) => setMsg({ kind: "err", text: String(e?.message ?? "PayPal couldn't complete the payment") })}
        />
      </PayPalScriptProvider>
      {msg && <p className={`text-sm ${msg.kind === "ok" ? "text-ink" : "text-danger"}`}>{msg.text}</p>}
      <p className="text-xs text-muted">
        Closed-loop service credits for Kitpier services. Sandbox: no real money moves.
      </p>
    </div>
  );
}
