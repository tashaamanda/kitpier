// "Try the demo" accounts end DEMO_DAYS after they start. Every way into an account checks this (session cookie, resume
// link, agent token, API key, public booking page), so access stops on time even before the purge deletes the account
// (demo-purge.ts, run daily). No imports: session.ts and the auth paths all use it.
export const DEMO_DOMAIN = "demo.kitpier.invalid";
export const DEMO_DAYS = 45;

/** SQL, for a users row aliased `u`: true while that account may still be used. Real accounts never expire here. */
export const LIVE_ACCOUNT = `NOT (u.email LIKE '%@${DEMO_DOMAIN}' AND u.created_at < now() - interval '${DEMO_DAYS} days')`;
