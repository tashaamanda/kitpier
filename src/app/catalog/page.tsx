import type { Metadata } from "next";
import { BADGES, LISTINGS, type ListingType } from "@/lib/catalog";
import { CatalogShell, ListingCard } from "@/components/Catalog";

export const metadata: Metadata = { title: "Catalog — Kitpier" };

const SECTIONS: ListingType[] = ["buy", "connect", "soon"];

export default function CatalogPage() {
  return (
    <CatalogShell>
      <header className="space-y-2">
        <h1 className="text-4xl font-semibold">The app store for AI-built software</h1>
        <p className="max-w-2xl text-lg text-muted">
          Discover, buy, and connect the services your app needs. Every listing says how you pay and whether its
          budget is enforced.
        </p>
      </header>
      {SECTIONS.map((type) => (
        <section key={type} className="space-y-3">
          <div>
            <h2 className="text-xl font-semibold">{BADGES[type].label}</h2>
            <p className="text-sm text-muted">{BADGES[type].blurb}</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {LISTINGS.filter((l) => l.type === type).map((l) => (
              <li key={l.slug}>
                <ListingCard l={l} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </CatalogShell>
  );
}
