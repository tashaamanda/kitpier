import Link from "next/link";
import { PRICES } from "@/lib/pricecard";
import { usd } from "@/lib/client";
import TopBar from "./TopBar";

// Signed-out home (kitpier-design.md). The stack below the fold is an example, labelled as one.
export default function Landing() {
  return (
    <main>
      <section className="lp-hero" aria-label="Kitpier">
        <TopBar />
        <div className="lp-mid">
          <div>
            <h1 className="lp-wordmark" aria-label="Kitpier">
              <i>k</i>i<span className="kern">t</span>
              <i>p</i>ier
            </h1>
            <p className="lp-sub">
              Your AI built the app. Kitpier docks the database, email and AI it needs, under one budget you control.
            </p>
            <div className="lp-cta">
              <Link className="kp-btn" href="/catalog#build">
                Describe your app
              </Link>
              <span className="micro">We&apos;ll plan the stack to your budget</span>
            </div>
          </div>
        </div>
        <div className="lp-bot">
          <div className="lp-links" aria-label="Services">
            <Link href="/catalog/booking-api">
              <span>Booking API</span>
              <span aria-hidden="true">↗</span>
            </Link>
            <Link href="/catalog/supabase">
              <span>Supabase</span>
              <span aria-hidden="true">↗</span>
            </Link>
            <Link href="/catalog/resend">
              <span>Resend</span>
              <span aria-hidden="true">↗</span>
            </Link>
            <Link href="/catalog">
              <span>Full catalog</span>
              <span aria-hidden="true">↗</span>
            </Link>
          </div>
          <div aria-hidden="true" />
          <div className="micro lp-legal">
            <span>Kitpier © 2026</span>
            <span>Not affiliated with listed providers</span>
          </div>
        </div>
      </section>

      <section className="lp-section lp-how" id="how" aria-labelledby="how-h">
        <div className="lp-inner">
          <div className="lp-head">
            <h2 id="how-h">
              From prompt
              <br />
              to <i>production</i>
            </h2>
            <p>Three steps, one checkout. Kitpier never holds your provider bills and never touches data it wasn&apos;t given.</p>
          </div>
          <div className="lp-steps">
            <div className="lp-step">
              <span className="n" aria-hidden="true">1</span>
              <h3>Describe it</h3>
              <p>&ldquo;A booking page for my barbershop.&rdquo; Kitpier proposes the services and what each will cost.</p>
            </div>
            <div className="lp-step">
              <span className="n" aria-hidden="true">2</span>
              <h3>Pay once</h3>
              <p>Buy credits with PayPal. Connect your own Supabase and Resend in a click; Kitpier sets them up.</p>
            </div>
            <div className="lp-step">
              <span className="n" aria-hidden="true">3</span>
              <h3>Ship it</h3>
              <p>Paste one prompt into your AI coding tool. Bookings land in your database, emails go from your account.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-section lp-stack" aria-labelledby="stack-h">
        <div className="lp-inner">
          <div className="lp-stack-grid">
            <div className="lp-ask">
              <span className="micro" style={{ color: "var(--muted)" }}>
                Example request
              </span>
              <p className="q" id="stack-h">
                A booking page for a barbershop <i>that emails a confirmation.</i>
              </p>
              <p>
                Every service is labelled: what Kitpier runs and caps, and what lives in your own account at the
                provider&apos;s price.
              </p>
            </div>
            <div className="lp-card" role="group" aria-label="Example stack">
              <div className="for micro">
                <span>Sam&apos;s Barbershop · example</span>
                <span>3 services</span>
              </div>
              <div className="lp-item">
                <span className="name">Booking API</span>
                <span className="price">
                  {usd(PRICES["booking.created"].micros)}
                  <span className="micro" style={{ color: "var(--muted)" }}>
                    {" "}
                    / booking
                  </span>
                </span>
                <span className="meta">AI booking assistant · {usd(PRICES["booking.message"].micros)} per message</span>
                <span className="kp-kind buy micro">Kitpier · capped</span>
              </div>
              <div className="lp-item">
                <span className="name">Supabase</span>
                <span className="price">Free tier</span>
                <span className="meta">Database for your bookings</span>
                <span className="kp-kind micro">Your account</span>
              </div>
              <div className="lp-item">
                <span className="name">Resend</span>
                <span className="price">Free tier</span>
                <span className="meta">Confirmation emails</span>
                <span className="kp-kind micro">Your account</span>
              </div>
              <div className="lp-budget">
                <span className="big">
                  $30<i> / month</i>
                </span>
                <span className="note">Hard cap on Kitpier services. Bookings pause before you go over.</span>
              </div>
              <div className="lp-approve">
                <Link className="kp-btn" href="/catalog#build">
                  Start your own stack
                </Link>
                <span className="lp-paywith micro">
                  Checkout with
                  {/* Official PayPal logo from paypalobjects.com, unmodified (PayPal brand guidelines) */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/brand/paypal.svg" alt="PayPal" width={71} height={20} />
                  <span>· sandbox</span>
                </span>
              </div>
            </div>
          </div>
          <div className="lp-trust micro">
            <div>
              <strong className="lp-trust-pp">
                One checkout
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/paypal.svg" alt="PayPal" width={64} height={18} />
              </strong>
              Credits via PayPal, no cards on Kitpier
            </div>
            <div>
              <strong>Budgets enforced</strong>The server stops spend at your cap
            </div>
            <div>
              <strong>Your keys stay yours</strong>Encrypted, never sent to the browser
            </div>
          </div>
        </div>
      </section>

      <footer className="lp-section lp-foot">
        <div className="lp-inner">
          <p style={{ margin: 0, maxWidth: "90ch" }}>
            Kitpier is not affiliated with, endorsed by, or sponsored by the providers listed. Provider names are used
            only to identify their services. Estimates are for planning; each provider&apos;s own pricing applies.
            Payments run in PayPal sandbox during the hackathon.
          </p>
        </div>
      </footer>
    </main>
  );
}
