import type { Metadata } from "next";
import Link from "next/link";
import { getListing } from "@/lib/catalog";
import { PACKS } from "@/lib/packs";
import { PRICE_CARD_VERSION, PRICES, TYPICAL_MONTH, monthlyEstimateMicros } from "@/lib/pricecard";
import { usd } from "@/lib/client";
import { CatalogShell } from "@/components/CatalogShell";

export const metadata: Metadata = { title: "Pricing · Kitpier" };

// Every number here comes from the same tables the server charges from (packs.ts, pricecard.ts, catalog.ts).
export default function PricingPage() {
  const connect = (["supabase", "resend"] as const).map((s) => getListing(s)!);
  return (
    <CatalogShell>
      <header className="grid gap-5">
        <h1 className="ct-title">
          Simple, <i>capped</i> pricing
        </h1>
        <p className="ct-lead">
          Buy credits once with PayPal. Kitpier services spend from them and stop at the budget you set. Services in your
          own accounts are billed by the provider, never through Kitpier.
        </p>
      </header>

      <section className="ct-cat" aria-labelledby="packs-h">
        <h2 id="packs-h">Credit packs</h2>
        <div className="ct-rows">
          {Object.values(PACKS).map((p) => (
            <div key={p.label} className="ct-row ct-static">
              <span className="name" style={{ fontVariantNumeric: "tabular-nums" }}>
                {usd(p.amountMicros)}
              </span>
              <span className="kp-kind buy micro">PayPal</span>
              <span className="tag">{p.label}. Closed-loop service credits for Kitpier services.</span>
              <span className="price">one payment</span>
            </div>
          ))}
        </div>
      </section>

      <section className="ct-cat" aria-labelledby="usage-h">
        <h2 id="usage-h">Kitpier services</h2>
        <div className="ct-rows">
          <Link href="/catalog/booking-api" className="ct-row">
            <span className="name">Booking API</span>
            <span className="kp-kind buy micro">Capped by Kitpier</span>
            <span className="tag">
              {Object.values(PRICES)
                .map((p) => `${usd(p.micros)} per ${p.unit}`)
                .join(" · ")}
              . A typical small booking site ({TYPICAL_MONTH["booking.message"]} messages,{" "}
              {TYPICAL_MONTH["booking.created"]} bookings) is about {usd(monthlyEstimateMicros())} a month.
            </span>
            <span className="price">budget enforced</span>
          </Link>
        </div>
      </section>

      <section className="ct-cat" aria-labelledby="own-h">
        <h2 id="own-h">Your own accounts</h2>
        <div className="ct-rows">
          {connect.map((l) => (
            <Link key={l.slug} href={`/catalog/${l.slug}`} className="ct-row">
              <span className="name">{l.name}</span>
              <span className="kp-kind micro">Billed by {l.provider}</span>
              <span className="tag">{l.pricing}.</span>
              <span className="price">estimate</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="ct-cat" aria-labelledby="cap-h">
        <h2 id="cap-h">The budget cap</h2>
        <p className="ct-lead m-0">
          Each project has a monthly budget. When Kitpier services reach it, bookings pause before you go over and the
          assistant offers a PayPal top-up. Kitpier can&apos;t cap what Supabase or Resend bill you, so those are shown
          as estimates. Price card {PRICE_CARD_VERSION}; payments run in PayPal sandbox during the hackathon.
        </p>
      </section>
    </CatalogShell>
  );
}
