// The marketplace catalog (SPEC §2). Static, server-side, public read.
// Provider names identify third-party services only; Kitpier is not affiliated with them.
// External prices are estimates for planning, checked on the date below; the provider's own pricing page wins.

import { monthlyEstimateMicros } from "./pricecard";

export type ListingType = "buy" | "connect" | "soon";

export const BADGES: Record<ListingType, { label: string; blurb: string }> = {
  buy: {
    label: "Buy with PayPal",
    blurb: "Run by Kitpier. Paid from your credits, and your project budget is enforced.",
  },
  connect: {
    label: "Connect your existing account",
    blurb: "Your own account, billed by the provider. Kitpier sets it up; costs shown are estimates.",
  },
  soon: { label: "Coming soon", blurb: "Listed so you can plan around it. Not available yet." },
};

export const ESTIMATES_CHECKED = "2026-10-14";

export type Listing = {
  slug: string;
  name: string;
  provider: string;
  type: ListingType;
  category: string;
  tagline: string;
  description: string;
  features: string[];
  /** Enforced monthly cost from the price card ("buy"), or a typical-month estimate ("connect"). */
  monthlyMicros?: number;
  pricing: string;
  setup?: string[];
  website?: string;
};

export const LISTINGS: Listing[] = [
  {
    slug: "receptionist-ai",
    name: "Receptionist AI",
    provider: "Kitpier",
    type: "buy",
    category: "AI assistant",
    tagline: "A booking assistant that chats with your visitors and books appointments.",
    description:
      "A task-specific assistant for salons, barbers and other appointment businesses. It checks open slots, books the visit into your database and sends a fixed confirmation email to the address the visitor verified. It only schedules: it declines other questions and never stores free-text reasons.",
    features: [
      "Hosted booking page, or call it from your own app with a project key",
      "Books into a single managed table in your Supabase",
      "Confirmation through your Resend account, to verified addresses only",
      "Spend stops at your project budget: no surprise bills",
    ],
    monthlyMicros: monthlyEstimateMicros(),
    pricing: "$0.02 per message, $0.05 per booking, paid from PayPal credits",
    setup: ["Buy a credit pack with PayPal", "Connect Supabase and Resend", "Approve the widget, then share the link"],
  },
  {
    slug: "supabase",
    name: "Supabase",
    provider: "Supabase",
    type: "connect",
    category: "Database",
    tagline: "Postgres database for your bookings and app data.",
    description:
      "Connect your Supabase account with OAuth. Kitpier creates a project (or a dedicated schema in one you pick) and sets up only the tables a listing needs, from fixed templates you approve.",
    features: [
      "OAuth: you never paste a database password",
      "New project, or a dedicated schema in one you choose",
      "Every change waits for your approval",
    ],
    monthlyMicros: 0,
    pricing: "Free plan available; paid plans billed by Supabase",
    setup: ["Authorize Kitpier in Supabase", "Approve the project or schema", "Wait for provisioning to finish"],
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
    monthlyMicros: 0,
    pricing: "Free tier available; paid plans billed by Resend",
    setup: ["Create a full-access key in Resend", "Paste it into Kitpier once", "Kitpier mints a send-only key"],
    website: "https://resend.com",
  },
  ...(
    [
      ["neon", "Neon", "Database", "Serverless Postgres with branching.", "https://neon.com"],
      ["upstash", "Upstash", "Cache & queues", "Serverless Redis and message queues.", "https://upstash.com"],
      ["vercel", "Vercel", "Hosting", "Deploy and host your front end.", "https://vercel.com"],
      ["clerk", "Clerk", "Authentication", "Sign-in and user management.", "https://clerk.com"],
      ["twilio", "Twilio", "SMS", "Text message reminders.", "https://www.twilio.com"],
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
      description: `${name} is on the roadmap. It is listed so the planning assistant can account for it, but you can't buy or connect it yet.`,
      features: [],
      pricing: "Not available yet",
      website,
    }),
  ),
];

export function getListing(slug: string) {
  return LISTINGS.find((l) => l.slug === slug);
}
