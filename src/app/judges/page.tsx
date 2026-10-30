import type { Metadata } from "next";
import Link from "next/link";
import { CatalogShell } from "@/components/CatalogShell";
import { TryDemoRow } from "@/components/TryDemo";

export const metadata: Metadata = { title: "For judges · Kitpier" };

// A 3-minute guided path, not documentation. The demo needs no login; only the PayPal sandbox buyer stays in Devpost's
// private testing field, since this page is public.
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
          <TryDemoRow />
          <li className="ct-row ct-static">
            <span className="name">2. Buy $10 of credits</span>
            <span className="kp-kind buy micro">PayPal sandbox</span>
            <span className="tag">
              On the project page, choose $10 and pay with the PayPal sandbox buyer from the Devpost instructions.
              Kitpier verifies the payment with PayPal before adding credits; it appears in the ledger.
            </span>
          </li>
          <li className="ct-row ct-static">
            <span className="name">3. Book a haircut</span>
            <span className="kp-kind micro">Booking page</span>
            <span className="tag">
              Open the booking page link on your project page and type: &ldquo;A haircut on Tuesday at 10am. I&apos;m Jo, jo@example.com.&rdquo; The assistant checks open
              times and shows a booking card.
            </span>
          </li>
          <li className="ct-row ct-static">
            <span className="name">4. Get the code</span>
            <span className="kp-kind micro">Demo inbox</span>
            <span className="tag">
              Tap &ldquo;Email me a confirmation&rdquo;. Demo emails are captured, not sent: find the 6-digit code in the
              Demo inbox on the project page, then confirm the booking.
            </span>
          </li>
          <li className="ct-row ct-static">
            <span className="name">5. Check the result</span>
            <span className="kp-kind micro">Your project</span>
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
          About eight minutes. Every account, demo or your own, has its own sandbox limit of three packs ($75) a day.
        </p>
      </section>

      <section className="ct-cat" aria-labelledby="agent-h">
        <h2 id="agent-h">Agent path</h2>
        {/* One right-hand column: the intro and the steps share its edges. */}
        <div className="grid gap-6">
        <p className="ct-lead m-0">
          The same flow, driven by your AI coding agent. About five minutes with Claude Code (any agent that can make
          HTTPS calls works). The agent plans and proposes; you approve and pay from links it hands you.
        </p>
        <ol className="ct-rows m-0 list-none p-0">
          <li className="ct-row ct-static">
            <span className="name">1. Connect</span>
            <span className="kp-kind micro">Your agent</span>
            <span className="tag">
              In an empty folder, ask: &ldquo;Read kitpier.com/llms.txt and connect to Kitpier, new project &lsquo;Agent
              test&rsquo;.&rdquo; Open the link it shows in the browser where you started the demo (or sign in to your own account), choose the project and press Allow.
              The agent saves its token to a private file, never in chat.
            </span>
          </li>
          <li className="ct-row ct-static">
            <span className="name">2. Plan and approve</span>
            <span className="kp-kind buy micro">PayPal sandbox</span>
            <span className="tag">
              Ask: &ldquo;Plan a booking page for my barbershop and send me the approval link.&rdquo; On that page approve
              the stack, switch on the demo connection and, if it asks, buy credits with the sandbox buyer.
            </span>
          </li>
          <li className="ct-row ct-static">
            <span className="name">3. Page and key</span>
            <span className="kp-kind micro">Approval link</span>
            <span className="tag">
              Ask: &ldquo;Propose the booking page, request an API key and send me a new link.&rdquo; Approve both. The agent
              then collects the key once and gives you the live booking page.
            </span>
          </li>
          <li className="ct-row ct-static">
            <span className="name">4. Optional: MCP tools</span>
            <span className="kp-kind micro">Claude Code</span>
            <span className="tag">
              Ask the agent to set up Kitpier&apos;s MCP config, approve its write to .mcp.json, then restart Claude Code in
              that folder with <span className="font-semibold">KITPIER_AGENT_TOKEN=&quot;$(cat ~/.config/kitpier/token)&quot; claude</span>. Kitpier&apos;s
              tools (project_status, plan_stack, get_approval_link and more) are now available.
            </span>
          </li>
        </ol>
        </div>
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
          <div className="ct-row ct-static">
            <span className="name">Agents</span>
            <span />
            <span className="tag">
              Agents get a token for one project that can read, plan and propose. Approving, paying and connecting
              accounts stay in your browser; a key that spends credits needs your explicit approval.
            </span>
          </div>
        </div>
      </section>
    </CatalogShell>
  );
}
