import Link from "next/link";
import { BADGES, type Listing, type ListingType } from "@/lib/catalog";

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
