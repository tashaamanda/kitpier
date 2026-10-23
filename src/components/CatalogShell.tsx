import Link from "next/link";
import TopBar from "./TopBar";

// Page shell for catalog, listing and pricing pages. Server-only (TopBar reads the session), so it lives apart
// from the badge helpers in Catalog.tsx, which client components import.
export function CatalogShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="ct-page">
      <TopBar />
      <div className="ct-inner">{children}</div>
      <footer className="ct-inner border-t border-line pt-4 text-xs text-muted" style={{ letterSpacing: "0.03em", lineHeight: 1.7 }}>
        Kitpier is not affiliated with, endorsed by, or sponsored by the providers listed. Provider names are used
        only to identify their services. Estimates are for planning; each provider&apos;s own pricing applies.{" "}
        <Link href="/judges" className="underline">
          For hackathon judges →
        </Link>
      </footer>
    </main>
  );
}
