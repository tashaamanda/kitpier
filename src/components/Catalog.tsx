import Link from "next/link";
import { BADGES, type Listing, type ListingType } from "@/lib/catalog";
import TopBar from "./TopBar";

// Listing type as small uppercase text with a dot (design system: no boxed badges).
// Filled dot = run and capped by Kitpier; ring = your own account; dashed = arriving soon.
export function Badge({ type }: { type: ListingType }) {
  return <span className={`kp-kind micro ${type === "buy" ? "buy" : ""}`}>{BADGES[type].label}</span>;
}

// Text monogram instead of provider logos: identification only, no brand assets.
export function Monogram({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="font-display flex size-11 shrink-0 items-center justify-center rounded-full border border-line text-lg"
    >
      {name[0]}
    </span>
  );
}

export function ListingRow({ l }: { l: Listing }) {
  return (
    <Link href={`/catalog/${l.slug}`} className="ct-row">
      <span className="name">{l.name}</span>
      <Badge type={l.type} />
      <span className="tag">{l.tagline}</span>
      <span className="price">
        {l.priceSummary}
        {l.type === "buy" ? " · budget enforced" : l.type === "connect" ? " · estimate" : ""}
      </span>
    </Link>
  );
}

export function CatalogShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="ct-page">
      <TopBar />
      <div className="ct-inner">{children}</div>
      <footer className="ct-inner border-t border-line pt-4 text-xs text-muted" style={{ letterSpacing: "0.03em", lineHeight: 1.7 }}>
        Kitpier is not affiliated with, endorsed by, or sponsored by the providers listed. Provider names are used
        only to identify their services. Estimates are for planning; each provider&apos;s own pricing applies.
      </footer>
    </main>
  );
}
