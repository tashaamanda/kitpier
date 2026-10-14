import type { Metadata } from "next";
import Link from "next/link";
import { CATEGORIES, LISTINGS } from "@/lib/catalog";
import { CatalogShell, ListingCard } from "@/components/Catalog";
import BuildBox from "@/components/BuildBox";

export const metadata: Metadata = { title: "Catalog — Kitpier" };

export default function CatalogPage() {
  const available = LISTINGS.filter((l) => l.type !== "soon");
  const soon = LISTINGS.filter((l) => l.type === "soon");
  const categories = CATEGORIES.filter((c) => available.some((l) => l.category === c));

  return (
    <CatalogShell>
      <header className="space-y-2">
        <h1 className="text-4xl font-semibold">The app store for AI-built software</h1>
        <p className="max-w-2xl text-lg text-muted">
          Tell us what you&apos;re building. We&apos;ll find everything your product needs.
        </p>
      </header>
      <BuildBox />

      <section className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold">Or browse yourself</h2>
          <p className="text-sm text-muted">{CATEGORIES.join(" · ")}</p>
        </div>
        {categories.map((c) => (
          <div key={c} className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{c}</h3>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {available
                .filter((l) => l.category === c)
                .map((l) => (
                  <li key={l.slug}>
                    <ListingCard l={l} />
                  </li>
                ))}
            </ul>
          </div>
        ))}
        <p className="text-sm text-muted">
          + {soon.length} providers being added:{" "}
          {soon.map((l, i) => (
            <span key={l.slug}>
              {i > 0 && ", "}
              <Link href={`/catalog/${l.slug}`} className="underline">
                {l.name}
              </Link>
            </span>
          ))}
        </p>
      </section>
    </CatalogShell>
  );
}
