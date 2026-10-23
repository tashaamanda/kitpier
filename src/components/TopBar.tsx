import Link from "next/link";

// Logo left, tagline centre, menu right (Sign in as the one pill). Plain facts never share the menu's styling.
export default function TopBar({ signedIn = false }: { signedIn?: boolean }) {
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
        <Link href="/#how">How it works</Link>
        <Link href="/catalog">Catalog</Link>
        <Link href="/catalog/booking-api">Pricing</Link>
        {signedIn ? (
          <Link href="/" className="kp-pill">
            Your projects
          </Link>
        ) : (
          <Link href="/signin" className="kp-pill">
            Sign in
          </Link>
        )}
      </nav>
    </div>
  );
}
