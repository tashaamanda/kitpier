import { collectKey } from "@/lib/agent-actions";
import { noStore, route } from "@/lib/http";
import { agentScope } from "../../caller";

// Collect an approved key: only the agent that asked, once, within an hour. Store it in the app's server-side .env;
// it is never shown again.
export const POST = route(async (req: Request) => noStore(await collectKey(await agentScope(req))));
