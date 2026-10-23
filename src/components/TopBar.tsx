import Link from "next/link";
import { Suspense } from "react";
import { currentUser } from "@/lib/session";

// Logo left, tagline centre, menu right (one pill). The menu depends on who's looking:
// signed out: How it works · Catalog · Pricing · [Sign in]; signed in: Catalog · Pricing · [Your projects].
// "How it works" is a section of the signed-out home page, so signed-in users (whose home is the dashboard) don't get it.
function SignedOutMenu() {
  return (
    <>
      <Link href="/#how">How it works</Link>
      <Link href="/catalog">Catalog</Link>
      <Link href="/pricing">Pricing</Link>
      <Link href="/signin" className="kp-pill">
        Sign in
      </Link>
    </>
  );
}

async function Menu() {
  const user = await currentUser();
  if (!user) return <SignedOutMenu />;
  return (
    <>
      <Link href="/catalog">Catalog</Link>
      <Link href="/pricing">Pricing</Link>
      <Link href="/" className="kp-pill">
        Your projects
      </Link>
    </>
  );
}

export default function TopBar() {
  return (
    <div className="kp-top">
      <Link className="kp-logo" href="/" aria-label="Kitpier home">
        <i>k</i>it<i>p</i>ier
      </Link>
      <div className="micro kp-tagline">
        <span>The app store for</span>
        <span>AI-built software</span>
      </div>
      <nav className="micro kp-nav" aria-label="Main">
        {/* reads the session cookie: streams in after the static shell (Cache Components) */}
        <Suspense fallback={<SignedOutMenu />}>
          <Menu />
        </Suspense>
      </nav>
    </div>
  );
}
