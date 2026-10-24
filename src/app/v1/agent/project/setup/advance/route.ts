import { advanceSetup } from "@/lib/agent-actions";
import { route } from "@/lib/http";
import { agentScope } from "../../../caller";

// Run the next step of a database setup the person already approved (at most one step per call). The setup's
// parameters were fixed at approval; this only executes them. Nothing happens if there's no approved setup.
export const POST = route(async (req: Request) => advanceSetup(await agentScope(req)));
