import { z } from "zod";
import { pollLink } from "@/lib/agents";
import { body, noStore, rateLimit, requireHttps, route } from "@/lib/http";
import { clientIp } from "@/lib/session";

const Input = z.object({ poll_token: z.string().min(1).max(100) });

// Step 3: the agent polls until the person decides. The token is returned once; poll faster than `interval` → slow_down.
export const POST = route(async (req: Request) => {
  requireHttps(req);
  await rateLimit(`agent-poll:${await clientIp()}`, 300, 60 * 60_000);
  const { poll_token } = await body(req, Input);
  return noStore(await pollLink(poll_token));
});
