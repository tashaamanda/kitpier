import { projectView } from "@/lib/agent-actions";
import { route } from "@/lib/http";
import { agentScope } from "../caller";

// Everything the agent needs to decide its next step. Read-only: an approved database setup advances only through
// POST /v1/agent/project/setup/advance.
export const GET = route(async (req: Request) => projectView(await agentScope(req)));
