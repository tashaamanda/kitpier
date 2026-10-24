import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import * as act from "@/lib/agent-actions";
import { HttpError } from "@/lib/session";
import type { Scope } from "@/lib/stack";
import { agentScope } from "../v1/agent/caller";

// Kitpier as an MCP server (docs/agent-scope.md E). Stateless Streamable HTTP with JSON responses: every request carries
// the agent's Authorization: Bearer ka_… header (HTTPS in production) and gets a fresh server bound to that token's one
// project. The tools are the REST agent API (src/lib/agent-actions.ts): read and propose only.

const INSTRUCTIONS = `Kitpier plans the services an app needs, shows their cost, and connects them after the person approves.
The rule: you propose, the person approves, Kitpier executes. You cannot approve, pay or connect accounts. When something
needs the person (approve a stack, pay with PayPal, connect Supabase, approve a booking page or a Booking API key), call
get_approval_link and give them the URL, then check_approval or project_status until it's done. A Booking API key can be
collected only by the agent that requested it, once, within an hour of approval; store it only in the app's server-side
.env, never in chat, logs or git.`;

type Out = { content: { type: "text"; text: string }[]; isError?: boolean };

/** Runs an action and turns its result, or a refusal, into tool output. Internals never leak. */
async function run(fn: () => Promise<unknown>): Promise<Out> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await fn()) }] };
  } catch (e) {
    if (e instanceof HttpError) return { content: [{ type: "text", text: JSON.stringify({ error: e.message, code: e.code }) }], isError: true };
    if (e instanceof z.ZodError) return { content: [{ type: "text", text: JSON.stringify({ error: "Invalid input", issues: e.issues }) }], isError: true };
    console.error(e);
    return { content: [{ type: "text", text: JSON.stringify({ error: "Something went wrong" }) }], isError: true };
  }
}

function server(s: Scope) {
  const mcp = new McpServer({ name: "kitpier", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  const tool = (name: string, description: string, inputSchema: z.ZodRawShape, fn: (i: Record<string, unknown>) => Promise<unknown>) =>
    mcp.registerTool(name, { description, inputSchema }, async (i: Record<string, unknown>) => run(() => fn(i)));

  tool("search_catalog", "Services Kitpier offers and how each is paid for.", { category: z.string().max(40).optional(), query: z.string().max(100).optional() }, async (i) =>
    act.catalog({ category: i.category as string | undefined, query: i.query as string | undefined }),
  );
  tool("project_status", "The connected project: credits, budget, connections, stack, setup, booking page, key and open approvals.", {}, () => act.projectView(s));
  tool("plan_stack", "Describe what you're building; Kitpier's planner proposes a stack with prices (needs the person's approval).", { message: z.string().min(1).max(2000) }, (i) =>
    act.plan(s, String(i.message)),
  );
  tool(
    "propose_booking_page",
    "Propose the hosted booking page. Goes live only after the person approves it.",
    { business_name: z.string().min(1).max(80), services: z.array(z.string().min(1).max(60)).min(1).max(8), timezone: z.string().min(1).max(64) },
    (i) => act.proposeBookingPage(s, i),
  );
  tool("propose_database_setup", "Propose creating the bookings database in the person's Supabase (needs approval; skip with the demo connection).", {}, () => act.proposeSetup(s));
  tool("advance_database_setup", "Run the next step of a database setup the person approved. Call every few seconds until database_ready.", {}, () => act.advanceSetup(s));
  tool("request_api_key", "Ask for a Booking API key for the person's own site. It spends credits, so the person must approve it.", {}, () => act.askForKey(s));
  tool("get_approval_link", "One link for the person with everything waiting for their approval or payment.", {}, () => act.approvalLink(s));
  tool("check_approval", "State of each item on an approval link: pending, approved, rejected or stale (stale → make a new link).", { approval_id: z.string().min(1).max(64) }, (i) =>
    act.approvalState(s, String(i.approval_id)),
  );
  tool("collect_api_key", "Collect an approved Booking API key, once. Write `env` to the app's server-side .env and follow `prompt`.", {}, () => act.collectKey(s));
  tool("demo_inbox", "With the demo connection on: bookings and emails a test booking produced.", {}, () => act.demo(s));
  return mcp;
}

async function handle(req: Request) {
  let s: Scope;
  try {
    s = await agentScope(req);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return Response.json({ error: e instanceof HttpError ? e.message : "Something went wrong" }, { status, headers: { "cache-control": "no-store" } });
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server(s).connect(transport);
  const res = await transport.handleRequest(req);
  res.headers.set("cache-control", "no-store"); // tool results can carry a one-time API key
  return res;
}

export const POST = handle;
// Stateless with JSON responses: no server-sent event stream and no sessions to close.
const notAllowed = () => new Response(null, { status: 405, headers: { allow: "POST" } });
export const GET = notAllowed;
export const DELETE = notAllowed;
