import { requireAgentToken } from "@/lib/agents";
import { rateLimit, requireHttps } from "@/lib/http";
import type { Scope } from "@/lib/stack";

// Shared by /v1/agent/* and /mcp: Bearer ka_ only (no cookies, so no origin check), HTTPS in production. The project
// comes from the token, never from the request. Everything reads or proposes; approving and paying happen only in the
// person's browser.
export async function agentScope(req: Request): Promise<Scope> {
  requireHttps(req);
  const t = await requireAgentToken(req);
  await rateLimit(`agent:${t.tokenId}`, 300, 60 * 60_000);
  return { userId: t.userId, projectId: t.projectId, agentTokenId: t.tokenId };
}
