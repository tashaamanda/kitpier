import { demo } from "@/lib/agent-actions";
import { route } from "@/lib/http";
import { agentScope } from "../../caller";

// With the demo connection on: the bookings and emails a test booking produced.
export const GET = route(async (req: Request) => demo(await agentScope(req)));
