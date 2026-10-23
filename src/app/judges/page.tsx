import type { Metadata } from "next";
import Link from "next/link";
import { CatalogShell } from "@/components/CatalogShell";
import { JUDGE_BOOKING_PAGE_ID, JUDGE_EMAIL, JUDGE_PROJECT_ID } from "@/lib/judge";

export const metadata: Metadata = { title: "For judges · Kitpier" };

const project = `/projects/${JUDGE_PROJECT_ID}`;
const bookingPage = `/r/${JUDGE_BOOKING_PAGE_ID}`;

// A 3-minute guided path, not documentation. Logins stay in Devpost's private testing field: this page is public.
export default function JudgesPage() {
  return (
    <CatalogShell>
      <header className="grid gap-5">
        <h1 className="ct-title">
          For <i>judges</i>
        </h1>
        <p className="ct-lead">
          The fastest way to test the whole flow: AI planning, a real PayPal sandbox payment, and a booking that spends
          credits under a budget cap. About three minutes.
        </p>
      </header>

      <section className="ct-cat" aria-labelledby="fast-h">
        <h2 id="fast-h">Fast path</h2>
        <ol className="ct-rows m-0 list-none p-0">
          <li className="ct-row ct-static">
            <span className="name">1. Sign in</span>
            <Link href="/signin" className="kp-btn-outline kp-btn-xs">
              Sign in
            </Link>
            <span className="tag">
              Use the judge account ({JUDGE_EMAIL}). The password is in the Devpost testing instructions.
            </span>
          </li>
          <li className="ct-row ct-static">
            <span className="name">2. Open Sam&apos;s Barbershop</span>
            <Link href={project} className="kp-btn-outline kp-btn-xs">
              Open project
            </Link>
            <span className="tag">
              A booking page Kitpier already planned and set up, on the demo connection: no Supabase or Resend account
              needed.
            </span>
          </li>
          <li className="ct-row ct-static">
            <span className="name">3. Buy $10 of credits</span>
            <span className="kp-kind buy micro">PayPal sandbox</span>
            <span className="tag">
              On the project page, choose $10 and pay with the PayPal sandbox buyer from the Devpost instructions.
              Kitpier verifies the payment with PayPal before adding credits; it appears in the ledger.
            </span>
          </li>
          <li className="ct-row ct-static">
            <span className="name">4. Book a haircut</span>
            <Link href={bookingPage} className="kp-btn-outline kp-btn-xs">
              Booking page
            </Link>
            <span className="tag">
              Type: &ldquo;A haircut on Tuesday at 10am. I&apos;m Jo, jo@example.com.&rdquo; The assistant checks open
              times and shows a booking card.
            </span>
          </li>
          <li className="ct-row ct-static">
            <span className="name">5. Get the code</span>
            <span className="kp-kind micro">Demo inbox</span>
            <span className="tag">
              Tap &ldquo;Email me a confirmation&rdquo;. Demo emails are captured, not sent: find the 6-digit code in the
              Demo inbox on the project page, then confirm the booking.
            </span>
          </li>
          <li className="ct-row ct-static">
            <span className="name">6. Check the result</span>
            <Link href={project} className="kp-btn-outline kp-btn-xs">
              Back to project
            </Link>
            <span className="tag">
              The booking is in the Demo inbox, the confirmation email beside it, and the ledger shows each message and
              the booking charged against the $30 monthly cap.
            </span>
          </li>
        </ol>
      </section>

      <section className="ct-cat" aria-labelledby="full-h">
        <h2 id="full-h">Full path</h2>
        <p className="ct-lead m-0">
          Prefer to start from nothing? <Link href="/signin" className="underline">Create your own account</Link>, then
          describe an app on the <Link href="/catalog#build" className="underline">catalog</Link>, approve the stack the
          planner proposes, switch on &ldquo;Use demo connection&rdquo;, approve the booking page, buy credits and book.
          About eight minutes. Sandbox purchases are limited to one pack per account per day, so your own account also
          avoids sharing that limit with other judges.
        </p>
      </section>

      <section className="ct-cat" aria-labelledby="what-h">
        <h2 id="what-h">What you&apos;re testing</h2>
        <div className="ct-rows">
          <div className="ct-row ct-static">
            <span className="name">AI planning</span>
            <span />
            <span className="tag">
              Claude turns a plain description into the services an app needs and proposes a stack with prices. It can
              only propose; nothing is bought or created until you approve.
            </span>
          </div>
          <div className="ct-row ct-static">
            <span className="name">PayPal</span>
            <span />
            <span className="tag">
              Credit packs use PayPal Orders v2 in sandbox. Each payment is verified server-side with PayPal (and by
              signed webhooks) before credits are added, exactly once.
            </span>
          </div>
          <div className="ct-row ct-static">
            <span className="name">Budget enforcement</span>
            <span />
            <span className="tag">
              Kitpier services spend from credits against a monthly cap. At the cap, bookings pause before going over and
              the assistant offers a PayPal top-up.
            </span>
          </div>
        </div>
      </section>
    </CatalogShell>
  );
}
