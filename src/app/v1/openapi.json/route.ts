import { appOrigin } from "@/lib/app-url";

// Machine-readable description of the public agent and booking endpoints.
const err = { $ref: "#/components/responses/Error" };
const post = (summary: string, body?: object, extra: object = {}) => ({
  post: {
    summary,
    ...(body ? { requestBody: { required: true, content: { "application/json": { schema: body } } } } : {}),
    responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } }, default: err },
    ...extra,
  },
});
const obj = (props: Record<string, object>, required: string[] = Object.keys(props)) => ({ type: "object", properties: props, required });
const str = { type: "string" };
const open = { security: [] };

export function GET() {
  const spec = {
    openapi: "3.1.0",
    info: {
      title: "Kitpier agent API",
      version: "1.0.0",
      description:
        "Agents read, plan and propose; the person approves and pays in the browser via approval links. See /llms.txt for the flow.",
    },
    servers: [{ url: appOrigin() }],
    security: [{ agentToken: [] }],
    paths: {
      "/v1/catalog": { get: { summary: "List services and how each is paid for", security: [], responses: { "200": { description: "OK" } } } },
      "/v1/agent/connect": post("Start connecting; returns a url for the person and a poll_token", obj({ client_name: str, project_name: str }, ["client_name"]), open),
      "/v1/agent/connect/poll": post("Poll until the person allows; returns the agent token once", obj({ poll_token: str }), open),
      "/v1/agent/project": { get: { summary: "Project status, budget, proposals, setup, booking page, key and approvals", responses: { "200": { description: "OK" }, default: err } } },
      "/v1/agent/project/plan": post("Message Kitpier's planner", obj({ message: str })),
      "/v1/agent/project/setup": post("Propose creating the bookings database in the person's Supabase"),
      "/v1/agent/project/setup/advance": post("Run the next step of a setup the person approved"),
      "/v1/agent/project/booking-page": post(
        "Propose the hosted booking page",
        obj({ business_name: str, services: { type: "array", items: str, maxItems: 8 }, timezone: str }),
      ),
      "/v1/agent/project/key-request": post("Ask for a Booking API key (needs the person's approval)"),
      "/v1/agent/project/key": post("Collect an approved Booking API key: same agent that asked, once, within an hour of approval"),
      "/v1/agent/project/approval-link": post("Create a link for the person with everything waiting for approval"),
      "/v1/agent/project/demo": { get: { summary: "Demo inbox (demo connection only)", responses: { "200": { description: "OK" }, default: err } } },
      "/v1/agent/approvals/{id}": {
        get: {
          summary: "State of each item on an approval link",
          parameters: [{ name: "id", in: "path", required: true, schema: str }],
          responses: { "200": { description: "OK" }, default: err },
        },
      },
    },
    components: {
      securitySchemes: { agentToken: { type: "http", scheme: "bearer", description: "ka_… token from /v1/agent/connect/poll" } },
      responses: { Error: { description: "Error", content: { "application/json": { schema: obj({ error: str, code: str }, ["error"]) } } } },
    },
  };
  return Response.json(spec, { headers: { "cache-control": "public, max-age=300" } });
}
