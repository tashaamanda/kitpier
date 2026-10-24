import { askForKey } from "@/lib/agent-actions";
import { route } from "@/lib/http";
import { agentScope } from "../../caller";

// Ask for a Booking API key. It can spend credits, so the person approves it first (approval link), then POST /key.
export const POST = route(async (req: Request) => askForKey(await agentScope(req)));
