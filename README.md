# Kitpier

**The app store for AI-built software.** Describe your app; an AI planner proposes the services it needs, you pay
once with PayPal, connect your own accounts, and the purchased service works in your app while Kitpier keeps the
spend under a budget you set.

- **Live:** [kitpier.com](https://kitpier.com)
- **Judges:** a 3-minute guided path at [kitpier.com/judges](https://kitpier.com/judges) (logins are in the
  Devpost testing instructions)
- Built for the PayPal AI Hackathon. Payments run in **PayPal sandbox**.

## What it does

1. **Describe your app**, e.g. "a booking page for my barbershop that emails customers a confirmation".
2. **The planner (Claude) proposes a stack** from the catalog with prices: Kitpier's Booking API, plus Supabase and
   Resend in your own accounts. Each service is labelled as *capped by Kitpier* or *billed by the provider*
   (shown as an estimate).
3. **You approve.** Nothing is bought, created or connected before that.
4. **Pay once with PayPal**: credit packs of $10 / $25 / $50 buy closed-loop service credits.
5. **Connect accounts**: Supabase by OAuth, Resend with a key Kitpier swaps for a send-only key, or the **demo
   connection** (a shared demo database and a Demo inbox, so nobody needs their own accounts to try it).
6. **Ship it**: a hosted booking page (`/r/{widget}`), or paste one prompt into your AI coding tool and your site
   calls the Booking API with a server-side key. Bookings land in your database; confirmations go from your email
   account.
7. **Budget enforcement**: each project has a monthly cap. At the cap, bookings pause before going over and the
   assistant offers a PayPal top-up.

## Agents

Your AI coding agent can do the same through Kitpier, while you keep the approvals and payments:

- **`/llms.txt`** explains the flow to any agent; `/v1/catalog` and `/v1/openapi.json` are public.
- **Connect:** the agent calls `POST /v1/agent/connect` and shows you a link. You sign in, pick one project and press
  Allow; the agent's poll returns a `ka_…` token for that project only (30 days, revocable on the project page).
- **Agent API** (`/v1/agent/*`, `Authorization: Bearer ka_…`): read status, plan, propose a booking page or database
  setup, request a Booking API key, and get an **approval link**. On that page you approve the stack, pay with PayPal,
  connect accounts and approve the key. The agent then collects the key once.
- **MCP:** the same tools at `/mcp` (Streamable HTTP). Claude Code setup, with the token read from a private file:
  ```json
  { "mcpServers": { "kitpier": { "type": "http", "url": "https://kitpier.com/mcp",
      "headers": { "Authorization": "Bearer ${KITPIER_AGENT_TOKEN}" } } } }
  ```
  then start Claude Code with `KITPIER_AGENT_TOKEN="$(cat ~/.config/kitpier/token)" claude`.
- Agent tokens can't approve, pay, connect accounts or rotate keys; those routes take only your browser session. Code:
  `src/lib/agents.ts`, `src/lib/approvals.ts`, `src/lib/agent-actions.ts`, `src/app/mcp/route.ts`.

## How PayPal is used

| What | Where |
|---|---|
| **Orders v2** (intent `CAPTURE`): create, capture, then **GET-verify** (merchant id, our `custom_id`, amount, currency) before any credit | `src/lib/paypal.ts`, `src/lib/orders.ts` |
| Amounts come only from the server's price table, never from the browser or the model | `src/lib/packs.ts` |
| **JavaScript SDK** checkout button | `src/components/BuyCredits.tsx` (`@paypal/react-paypal-js`) |
| **Webhooks** `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, refunds/reversals/disputes, verified with `/v1/notifications/verify-webhook-signature` | `src/app/api/paypal/webhook/route.ts`, `src/lib/webhooks.ts` |
| **Exactly-once credits**: the browser capture and both webhooks converge on `applyVerifiedOrderTx`; every ledger entry has a UNIQUE `source` | `src/lib/orders.ts`, `src/lib/ledger.ts` |
| **In-conversation top-up** when a project hits its budget | `src/lib/topup.ts` |

## How AI is used

- **Claude Haiku 5.5** (`claude-haiku-5-5`) through the Anthropic SDK tool runner, for two task-specific jobs:
  - **Stack planner**: turns a description into a proposed stack with prices from the catalog
    (`src/lib/planner.ts`, `src/lib/stack.ts`).
  - **Kitpier Booking API**: the booking assistant checks open slots and extracts the appointment
    (`src/lib/booking.ts`, endpoints under `src/app/v1/booking/` and `src/app/r/`).
- **The model can only propose.** Approvals, payments and database writes run in server code the model has no tool
  for. A booking is written only when the customer presses Confirm on the server-recorded card.
- Spend on the model is metered per turn and capped per platform per day (`src/lib/billing.ts`,
  `src/lib/platform.ts`). No raw model access is resold.

## Sponsor tools

- **Render**: Kitpier runs on a Render web service at kitpier.com (custom domain, managed TLS), auto-deployed from
  this repo. `render.yaml` is a Blueprint for one-click deploys of your own copy.

## Safety and security

- Provider credentials encrypted at rest with AES-256-GCM (`src/lib/credentials.ts`); Resend keys are exchanged for
  a send-only key; Booking API keys (`mk_…`) are stored hashed and never reach a browser (`src/lib/apikeys.ts`).
- Supabase changes only through approved actions, confined to tables Kitpier created from fixed SQL templates
  (`src/lib/supabase.ts`, `src/lib/templates.ts`, `src/lib/provision.ts`).
- Confirmation emails use a fixed template and go only to an address verified by a one-time code
  (`src/lib/email.ts`).
- Same-origin checks on every state-changing route, rate limits in Postgres, owner-only project access
  (`src/lib/http.ts`, `src/lib/session.ts`, `src/lib/projects.ts`).
- Password reset with one-time, hashed, 30-minute tokens that end other sessions and all agent access
  (`src/lib/password-reset.ts`).
- Agent access: one-project tokens stored hashed, consent links that expire and work once, approval links bound to
  exactly what they showed, HTTPS-only in production (`src/lib/agents.ts`, `src/lib/approvals.ts`).

## Run it locally

Requirements: Node 20+, PostgreSQL 16+.

```bash
npm install
cp .env.example .env.local && chmod 600 .env.local   # then fill in the values (see below)

# Postgres: any local server works; this is the project-local cluster used in development
initdb -D .pgdata -U kitpier --auth=trust
pg_ctl -D .pgdata -o "-p 5433 -k /tmp -c listen_addresses=127.0.0.1" -l .pgdata/server.log start
createdb -h 127.0.0.1 -p 5433 -U kitpier kitpier
createdb -h 127.0.0.1 -p 5433 -U kitpier kitpier_test

npm run db:migrate                                                            # app database
MIGRATE_URL=postgres://kitpier@127.0.0.1:5433/kitpier_test node scripts/migrate.mjs   # test database
npm run dev                                                                   # http://localhost:3005
```

### Environment

Every variable is listed in `.env.example`:

- `SESSION_SECRET` (`openssl rand -hex 32`) and `CREDENTIALS_MASTER_KEY` (`openssl rand -base64 32`).
- **PayPal sandbox** (developer.paypal.com → Apps & Credentials → Sandbox): `PAYPAL_CLIENT_ID`,
  `PAYPAL_CLIENT_SECRET`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID` (same id), `PAYPAL_MERCHANT_ID` (your sandbox business
  account), and `PAYPAL_WEBHOOK_ID` after registering `<APP_URL>/api/paypal/webhook` for the events above.
  Webhooks need a public URL; locally use a tunnel.
- `ANTHROPIC_API_KEY` and `PLATFORM_DAILY_AI_CAP_MICROS` (daily model-spend cap in micro-USD).
- Production only: `CLIENT_IP_SOURCE` (required; which edge header holds the client IP) and `AGENT_CONNECT_ENABLED`
  (`1` opens agent connections). See Deploy.
- Optional: `SUPABASE_OAUTH_CLIENT_ID/SECRET` (a Supabase OAuth app with redirect
  `<APP_URL>/api/connect/supabase/callback`), `RESEND_API_KEY` + `MAIL_FROM` (password-reset email),
  `DEMO_SUPABASE_REF` + `DEMO_SUPABASE_SECRET_KEY` (demo connection; the table SQL is `DEMO_BOOKINGS_SQL` in
  `src/lib/demo.ts`).

### Checks

```bash
npx tsc --noEmit && npx eslint src && npx vitest run && npm audit --omit=dev
```

The tests run against the local test database (`TEST_DATABASE_URL`).

### Deploy

On Render: create a Blueprint from `render.yaml` and set the secret variables. Then:

1. Run the migrations against the hosted database before the deploy that needs them. Supply the URL without putting it
   in shell history: `read -rs MIGRATE_URL && export MIGRATE_URL`, paste, `node scripts/migrate.mjs`,
   `unset MIGRATE_URL`. Migrations are additive.
2. Set `CLIENT_IP_SOURCE` (on Render: `cf-connecting-ip`; `xff-first` is forgeable there), leave
   `AGENT_CONNECT_ENABLED` unset, deploy.
3. Verify the edge: send a sign-in with a made-up email, `Origin: <APP_URL>` and forged `X-Forwarded-For` /
   `X-Real-IP` values, then check which `login:<ip>` key appeared in `rate_limits`. It must be your real IP, not a
   forged one. (Render's Cloudflare edge rejects a forged `CF-Connecting-IP` outright with error 1000.) Also check that
   `http://` redirects to `https://` at the edge.
4. Set `AGENT_CONNECT_ENABLED=1`.

To end all agent access at once: unset `AGENT_CONNECT_ENABLED`, then run `node scripts/revoke-agent-access.mjs`
(same `MIGRATE_URL` handling). That revokes credentials only; to roll back code, redeploy the previous release.
`scripts/seed-judge.mjs [base-url]` builds the judges' demo account through the app's own API.

## Example: your own site calling the Booking API

`examples/barbershop-site` is a small site whose server calls `/v1/booking/converse`, `/code` and `/confirm` with a
Booking API key. See its README.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · PostgreSQL (Neon in production) · node-postgres ·
zod · iron-session · Anthropic SDK · PayPal Orders v2 + JS SDK · Supabase Management API · Resend · Vitest · Render.

## Prior work

Built during the hackathon submission period. A few helpers (PayPal client, session and HTTP helpers, and the agent
pattern) were adapted from a prototype I wrote on Oct 13, 2026, also inside the submission period. The Booking API
was written fresh for this project.

## License

[Apache License 2.0](LICENSE). Provider names are used only to identify their services; Kitpier is not affiliated
with, endorsed by, or sponsored by them.
