import { z } from "zod";
import { plan } from "@/lib/agent-actions";
import { body, route } from "@/lib/http";
import { agentScope } from "../../caller";

const Input = z.object({ message: z.string().trim().min(1).max(2000) });

// Talk to Kitpier's planner. Same free quota as the web app; a stack it proposes still needs the person's approval.
export const POST = route(async (req: Request) => {
  const s = await agentScope(req);
  return plan(s, (await body(req, Input)).message);
});
