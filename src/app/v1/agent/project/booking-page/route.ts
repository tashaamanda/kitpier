import { proposeBookingPage } from "@/lib/agent-actions";
import { WidgetSpec } from "@/lib/booking";
import { body, route } from "@/lib/http";
import { agentScope } from "../../caller";

// Propose the hosted booking page. It goes live only after the person approves it.
export const POST = route(async (req: Request) => {
  const s = await agentScope(req);
  return proposeBookingPage(s, await body(req, WidgetSpec));
});
