import { z } from "zod";
import { agentConnectOpen, startLink } from "@/lib/agents";
import { body, noStore, rateLimit, requireHttps, route } from "@/lib/http";
import { HttpError, clientIp } from "@/lib/session";

const Input = z.object({ client_name: z.string().min(1).max(200), project_name: z.string().max(200).optional() });

// Step 1 of agent access: no auth. Returns a link for the person and a poll token for the agent.
export const POST = route(async (req: Request) => {
  requireHttps(req);
  if (!agentConnectOpen()) throw new HttpError(503, "Agent connections aren't open yet", "agent_connect_closed");
  await rateLimit(`agent-connect:${await clientIp()}`, 10, 60 * 60_000);
  // Backstop if the per-IP limit is ever dodged: a ceiling on new connections across everyone.
  await rateLimit("agent-connect:all", 500, 60 * 60_000);
  const i = await body(req, Input);
  return noStore(await startLink({ clientName: i.client_name, projectName: i.project_name }));
});
