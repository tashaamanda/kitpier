import { appOrigin } from "@/lib/app-url";
import { PRICES } from "@/lib/pricecard";

const price = (m: number) => `$${(m / 1_000_000).toFixed(2)}`;

// For AI agents: what Kitpier is and how to use it on someone's behalf. Plain text, public, no secrets.
export function GET() {
  const o = appOrigin();
  const text = `# Kitpier

> The app store for AI-built software. Kitpier plans the services an app needs, shows what each costs, and connects
> them after the person approves. Kitpier's own services are paid for with PayPal credits and stop at the person's
> monthly budget.

The rule: AI proposes. The person approves. Kitpier executes.
You (the agent) can read, plan and propose. You cannot approve, pay or connect accounts, and you can collect a Booking
API key only after the person explicitly approves it. For anything that needs the person, you get a link and hand it to
them. Never ask the person for their password, PayPal details or provider keys.

Today's catalog: Kitpier Booking API (bookings for a business, paid from Kitpier credits), plus the person's own
Supabase (database) and Resend (email). Catalog as JSON: ${o}/v1/catalog
API description (OpenAPI 3.1): ${o}/v1/openapi.json

## Costs
- Planning messages use Kitpier's free planner quota (20 per day per person). They don't spend credits.
- The Booking API spends the project's credits (${price(PRICES["booking.message"].micros)} per customer message, ${price(PRICES["booking.created"].micros)} per booking), only after the person
  approves a key, and pauses at the project's monthly budget.

## Flow
1. Connect: POST ${o}/v1/agent/connect {"client_name": "<your name>", "project_name": "<optional>"}
   Show the person the "url" and the "code" and ask them to open it. Then poll
   POST ${o}/v1/agent/connect/poll {"poll_token": "..."} every "interval" seconds until status is "approved".
   The response has "token" (ka_...). It is returned once. Save it straight to the file ~/.config/kitpier/token with
   permissions 600 (create the folder with 700), using a file write, not an echo in a shell command. Never print it in
   chat, put it in a committed file, or log it. Send it as "Authorization: Bearer <token>". If you lose it, start again.
   A token is for one project only. "slow_down" means poll less often.
2. Plan: POST ${o}/v1/agent/project/plan {"message": "<what the person is building>"}
   Returns the planner's reply and the proposed stack.
3. Ask for approval: POST ${o}/v1/agent/project/approval-link → {"url"}. Give the person the url. On that page they
   approve the stack, buy credits with PayPal, and connect accounts (or turn on the demo connection).
   Check progress: GET ${o}/v1/agent/approvals/{approval_id} and GET ${o}/v1/agent/project.
   An item marked "stale" changed after the link was made: create a new link.
4. Database: with the demo connection on, skip this. Otherwise, once Supabase is connected:
   POST ${o}/v1/agent/project/setup, then a new approval link. Once approved, call
   POST ${o}/v1/agent/project/setup/advance every few seconds until status.database_ready is true.
5. Booking page and key: POST ${o}/v1/agent/project/booking-page
   {"business_name": "...", "services": ["..."], "timezone": "America/New_York"}, then
   POST ${o}/v1/agent/project/key-request, then a new approval link for the person.
6. Collect the key once approved: POST ${o}/v1/agent/project/key → {"key", "env", "prompt"}. Only the agent that
   requested it can collect it, once, within an hour of approval. If the project's keys changed meanwhile, request again.
   Write "env" to the app's server-side .env (never to the browser, logs or git), then follow "prompt" to add the
   booking chat to the person's app. The hosted page is at booking_page.live.url in GET /v1/agent/project.
7. When bookings pause because the budget ran out, ask the planner for a top-up and send the person a new approval
   link to pay with PayPal.

## Using Kitpier as MCP tools (Claude Code and other MCP clients)
After step 1 has saved the token, write this to .mcp.json in the person's project (it names a variable, not the token,
so it is safe to commit):
{"mcpServers": {"kitpier": {"type": "http", "url": "${o}/mcp", "headers": {"Authorization": "Bearer \${KITPIER_AGENT_TOKEN}"}}}}
Then ask the person to restart Claude Code from that folder with:
  KITPIER_AGENT_TOKEN="$(cat ~/.config/kitpier/token)" claude
(the command reads the file, so the token never appears in shell history). The tools mirror the steps above:
search_catalog, project_status, plan_stack, propose_booking_page, propose_database_setup, advance_database_setup,
request_api_key, get_approval_link, check_approval, collect_api_key, demo_inbox. Without MCP, the HTTP calls above work
the same way. Only HTTPS is accepted (plain HTTP only on localhost during development).

## Errors
JSON {"error": "...", "code"?: "..."}. 401: missing or bad token. 404: not found, or not this project.
409: not possible yet (the message says what is needed). 429: too many requests, slow down.
`;
  return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" } });
}
