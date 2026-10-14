import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BADGES, ESTIMATES_CHECKED, LISTINGS, getListing } from "@/lib/catalog";
import { PRICE_CARD_VERSION, PRICES, TYPICAL_MONTH } from "@/lib/pricecard";
import { usd } from "@/lib/client";
import { Badge, CatalogShell, Monogram } from "@/components/Catalog";

export function generateStaticParams() {
  return LISTINGS.map((l) => ({ slug: l.slug }));
}

export async function generateMetadata({ params }: PageProps<"/catalog/[slug]">): Promise<Metadata> {
  const l = getListing((await params).slug);
  return { title: l ? `${l.name} — Kitpier` : "Not found — Kitpier" };
}

export default async function ListingPage({ params }: PageProps<"/catalog/[slug]">) {
  const l = getListing((await params).slug);
  if (!l) notFound();

  return (
    <CatalogShell>
      <Link href="/catalog" className="text-sm text-muted underline">
        ← Catalog
      </Link>
      <header className="flex flex-wrap items-start gap-4">
        <Monogram name={l.name} />
        <div className="min-w-0 flex-1 space-y-2">
          <h1 className="text-3xl font-semibold">{l.name}</h1>
          <p className="text-muted">
            {l.category} · by {l.provider}
          </p>
          <Badge type={l.type} />
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <section className="space-y-4 rounded-2xl border border-line bg-card p-5 md:col-span-2">
          <p className="text-lg">{l.tagline}</p>
          <p className="text-muted">{l.description}</p>
          {l.features.length > 0 && (
            <ul className="list-disc space-y-1 pl-5">
              {l.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
          {l.setup && (
            <div>
              <h2 className="mb-2 font-semibold">How setup works</h2>
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                {l.setup.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>
          )}
        </section>

        <aside className="space-y-3 rounded-2xl border border-line bg-card p-5 text-sm">
          <h2 className="font-semibold">Pricing</h2>
          <p>{l.pricing}</p>
          {l.type === "buy" && (
            <>
              <ul className="divide-y divide-line">
                {Object.values(PRICES).map((p) => (
                  <li key={p.unit} className="flex justify-between py-1.5">
                    <span>per {p.unit}</span>
                    <span>{usd(p.micros)}</span>
                  </li>
                ))}
              </ul>
              {l.monthlyMicros !== undefined && (
                <p className="text-muted">
                  Typical small booking site: about {usd(l.monthlyMicros)}/month (
                  {TYPICAL_MONTH["booking.message"]} messages, {TYPICAL_MONTH["booking.created"]} bookings).
                </p>
              )}
              <p className="text-muted">Enforced: spending stops at your project budget. Price card {PRICE_CARD_VERSION}.</p>
            </>
          )}
          {l.type === "connect" && (
            <p className="text-muted">
              Billed by {l.provider}, not Kitpier, so Kitpier can&apos;t cap it. Estimate checked {ESTIMATES_CHECKED}.
            </p>
          )}
          <p className="text-muted">{BADGES[l.type].blurb}</p>
          {l.type !== "soon" && (
            <Link
              href="/"
              className="block rounded-xl bg-accent px-4 py-2 text-center font-semibold text-white hover:bg-accent-dark"
            >
              {l.type === "buy" ? "Add to a project" : "Connect in a project"}
            </Link>
          )}
          {l.website && (
            <a href={l.website} target="_blank" rel="noopener noreferrer" className="block text-muted underline">
              {l.provider} website ↗
            </a>
          )}
        </aside>
      </div>
    </CatalogShell>
  );
}
