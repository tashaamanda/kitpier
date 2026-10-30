import type { Metadata } from "next";
import { CatalogShell } from "@/components/CatalogShell";
import { ResumeDemo } from "@/components/TryDemo";

export const metadata: Metadata = { title: "Open your demo · Kitpier", robots: { index: false } };

// Target of a demo's private resume link. The key is in the URL fragment, read in the browser only.
export default function ResumePage() {
  return (
    <CatalogShell>
      <header className="grid gap-5">
        <h1 className="ct-title">
          Open your <i>demo</i>
        </h1>
        <ResumeDemo />
      </header>
    </CatalogShell>
  );
}
