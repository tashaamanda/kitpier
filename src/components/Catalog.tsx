import Link from "next/link";
import { BADGES, type Listing, type ListingType } from "@/lib/catalog";

const BADGE_STYLE: Record<ListingType, string> = {
  buy: "bg-accent text-white",
  connect: "border border-accent text-accent",
  soon: "border border-line text-muted",
};

export function Badge({ type }: { type: ListingType }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${BADGE_STYLE[type]}`}>
      {BADGES[type].label}
    </span>
  );
}

// Text monogram instead of provider logos: identification only, no brand assets.
export function Monogram({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-paper text-lg font-semibold"
    >
      {name[0]}
    </span>
  );
}

export function ListingCard({ l }: { l: Listing }) {
  return (
    <Link
      href={`/catalog/${l.slug}`}
      className={`flex h-full flex-col gap-3 rounded-2xl border border-line bg-card p-4 hover:border-accent ${
        l.type === "soon" ? "opacity-70" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        <Monogram name={l.name} />
        <div className="min-w-0">
          <p className="font-semibold">{l.name}</p>
          <p className="text-sm text-muted">{l.category}</p>
        </div>
      </div>
      <p className="flex-1 text-sm">{l.tagline}</p>
      <div>
        <Badge type={l.type} />
      </div>
    </Link>
  );
}

export function CatalogShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-8 px-5 py-10">
      <nav className="flex items-center justify-between text-sm">
        <Link href="/catalog" className="text-lg font-semibold">
          Kitpier
        </Link>
        <Link href="/" className="text-muted underline">
          Your projects
        </Link>
      </nav>
      {children}
      <footer className="border-t border-line pt-4 text-xs text-muted">
        Kitpier is not affiliated with, endorsed by, or sponsored by the providers listed. Provider names are used
        only to identify their services. Estimates are for planning; each provider&apos;s own pricing applies.
      </footer>
    </main>
  );
}
