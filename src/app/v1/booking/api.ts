import { z } from "zod";
import { requireApiKey } from "@/lib/apikeys";
import { rateLimit } from "@/lib/http";

// Shared by the /v1/booking endpoints: server-to-server, authenticated by the mk_ key (no cookies, so no origin check).
// The builder's server should pass its customer's IP so per-visitor limits apply to each visitor, not to the server.
export const CustomerIp = z.string().trim().min(1).max(64).optional();

/** Key first, so unauthenticated callers learn nothing from input errors. */
export async function caller(req: Request) {
  const k = await requireApiKey(req);
  await rateLimit(`api-key:${k.keyId}`, 600, 60 * 60_000);
  return { widgetId: k.widgetId, ip: (customerIp?: string) => `api:${k.keyId}:${customerIp ?? "server"}` };
}
