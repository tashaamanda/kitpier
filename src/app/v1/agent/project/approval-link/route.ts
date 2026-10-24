import { approvalLink } from "@/lib/agent-actions";
import { route } from "@/lib/http";
import { agentScope } from "../../caller";

// One link for the person with everything currently waiting for them.
export const POST = route(async (req: Request) => approvalLink(await agentScope(req)));
