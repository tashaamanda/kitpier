import { proposeSetup } from "@/lib/agent-actions";
import { route } from "@/lib/http";
import { agentScope } from "../../caller";

// Propose creating the bookings database in the person's Supabase. Nothing happens there until they approve.
export const POST = route(async (req: Request) => proposeSetup(await agentScope(req)));
