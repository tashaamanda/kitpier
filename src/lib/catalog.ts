// The marketplace catalog (SPEC §2). Static, server-side, public read.
// Users browse by service category; the listing type (how you pay) is a badge on each card, not the page structure.
// Provider names identify third-party services only; Kitpier is not affiliated with them.
// External prices are planning estimates checked on the date below; the provider's own pricing page wins.

import { monthlyEstimateMicros } from "./pricecard";

export type ListingType = "buy" | "connect" | "soon";

export const BADGES: Record<ListingType, { label: string; blurb: string }> = {
  buy: {
    label: "Buy with PayPal",
    blurb: "Run by Kitpier. Paid from your PayPal credits, and your project budget is enforced.",
  },
  connect: {
    label: "Connect account",
    blurb: "Your own account, billed directly by the provider. Kitpier sets it up; costs are estimates only.",
  },
  soon: { label: "Coming soon", blurb: "Not available yet." },
};

export const CATEGORIES = ["AI", "Database", "Email", "Hosting", "Auth", "Cache & queues", "SMS & voice", "Analytics"];
export type Category = (typeof CATEGORIES)[number];

export const ESTIMATES_CHECKED = "2026-10-14";

export type Listing = {
  slug: string;
  name: string;
  provider: string;
  type: ListingType;
  category: Category;
  tagline: string;
  description: string;
  features: string[];
  /** Short price line for cards: enforced price ("buy") or provider-billed estimate ("connect"). */
  priceSummary: string;
  /** Typical-month cost from the price card ("buy" only). */
  monthlyMicros?: number;
  /** Provider-billed estimate ("connect" only): free tier available, paid plans start here. Not enforced. */
  paidFromMicros?: number;
  pricing: string;
  setup?: string[];
  website?: string;
};

export const LISTINGS: Listing[] = [
  {
    slug: "booking-api",
    name: "Kitpier Booking API",
    provider: "Kitpier",
    type: "buy",
    category: "AI",
    tagline: "Understands booking requests and turns them into confirmed appointments.",
    description:
      "Task-specific booking intelligence for appointment businesses. It reads a customer's message, extracts the service, day and time, checks open slots, writes the booking to your database and sends a fixed confirmation through your email provider. It only schedules: it declines other questions and never stores free-text reasons.",
    features: [
      "Call it from your app with a project key, or use the hosted booking page",
      "Writes to a single managed bookings table in your Supabase",
      "Confirmations through your Resend, to verified addresses only",
      "Spending stops at your project budget: no surprise bills",
    ],
    priceSummary: "$0.05 / booking",
    monthlyMicros: monthlyEstimateMicros(),
    pricing: "$0.05 per booking plus $0.02 per message, paid from PayPal credits",
    setup: ["Buy a credit pack with PayPal", "Connect a database and an email provider", "Approve the booking widget"],
  },
  {
    slug: "supabase",
    name: "Supabase",
    provider: "Supabase",
    type: "connect",
    category: "Database",
    tagline: "Postgres database for your customers and appointments.",
    description:
      "Connect your Supabase account with OAuth. Connecting creates nothing: when your stack needs a database, Kitpier proposes a project (or a dedicated schema in one you pick) and builds it only after you approve, from fixed templates.",
    features: [
      "OAuth: you never paste a database password",
      "Access is not authority: every change waits for your approval",
      "New project, or a dedicated schema in one you choose",
    ],
    priceSummary: "Free plan · paid from ~$25/mo",
    paidFromMicros: 25_000_000,
    pricing: "Free plan available; paid plans from about $25/month, billed by Supabase",
    setup: ["Authorize Kitpier in Supabase", "Approve the proposed project or schema", "Wait for provisioning"],
    website: "https://supabase.com",
  },
  {
    slug: "resend",
    name: "Resend",
    provider: "Resend",
    type: "connect",
    category: "Email",
    tagline: "Transactional email for booking confirmations.",
    description:
      "Paste a Resend key once. Kitpier uses it to create a send-only key and discards the original, so only a scoped key is ever stored.",
    features: ["Send-only scoped key", "Your sender, your account", "Fixed confirmation template, no model-written email"],
    priceSummary: "Free tier · paid from ~$20/mo",
    paidFromMicros: 20_000_000,
    pricing: "Free tier available; paid plans from about $20/month, billed by Resend",
    setup: ["Create a full-access key in Resend", "Paste it into Kitpier once", "Kitpier mints a send-only key"],
    website: "https://resend.com",
  },
  ...(
    [
      ["neon", "Neon", "Database", "Serverless Postgres with branching.", "https://neon.com"],
      ["upstash", "Upstash", "Cache & queues", "Serverless Redis and message queues.", "https://upstash.com"],
      ["vercel", "Vercel", "Hosting", "Deploy and host your front end.", "https://vercel.com"],
      ["clerk", "Clerk", "Auth", "Sign-in and user management.", "https://clerk.com"],
      ["twilio", "Twilio", "SMS & voice", "Text message reminders.", "https://www.twilio.com"],
      ["posthog", "PostHog", "Analytics", "Product analytics and session replay.", "https://posthog.com"],
    ] as const
  ).map(
    ([slug, name, category, tagline, website]): Listing => ({
      slug,
      name,
      provider: name,
      type: "soon",
      category,
      tagline,
      description: `${name} is being added. The planning assistant knows about it, but you can't buy or connect it yet.`,
      features: [],
      priceSummary: "Coming soon",
      pricing: "Not available yet",
      website,
    }),
  ),
];

export function getListing(slug: string) {
  return LISTINGS.find((l) => l.slug === slug);
}
