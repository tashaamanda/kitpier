import type { Metadata } from "next";
import Link from "next/link";
import { CATEGORIES, LISTINGS } from "@/lib/catalog";
import { CatalogShell, ListingRow } from "@/components/Catalog";
import BuildBox from "@/components/BuildBox";

export const metadata: Metadata = { title: "Catalog — Kitpier" };

export default function CatalogPage() {
  const available = LISTINGS.filter((l) => l.type !== "soon");
  const soon = LISTINGS.filter((l) => l.type === "soon");
  const categories = CATEGORIES.filter((c) => available.some((l) => l.category === c));

  return (
    <CatalogShell>
      <header className="grid gap-5">
        <h1 className="ct-title">
          The <i>catalog</i>
        </h1>
        <p className="ct-lead">
          Tell us what you&apos;re building and Kitpier plans the stack to your budget. Or browse every service
          yourself.
        </p>
      </header>
      <BuildBox />

      <section className="grid gap-8" aria-label="Services by category">
        {categories.map((c) => (
          <div key={c} className="ct-cat">
            <h2>{c}</h2>
            <div className="ct-rows">
              {available
                .filter((l) => l.category === c)
                .map((l) => (
                  <ListingRow key={l.slug} l={l} />
                ))}
            </div>
          </div>
        ))}
        <div className="ct-cat" id="soon">
          <h2>Arriving soon</h2>
          <p className="ct-soon m-0">
            {soon.map((l, i) => (
              <span key={l.slug}>
                {i > 0 && " · "}
                <Link href={`/catalog/${l.slug}`}>{l.name}</Link>
              </span>
            ))}
          </p>
        </div>
      </section>
    </CatalogShell>
  );
}
