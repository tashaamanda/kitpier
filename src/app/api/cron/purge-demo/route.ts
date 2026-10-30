import { createHash, timingSafeEqual } from "node:crypto";
import { purgeDemoData } from "@/lib/demo-purge";
import { noStore, requireHttps, route } from "@/lib/http";
import { HttpError } from "@/lib/session";

const sha = (s: string) => createHash("sha256").update(s).digest();

// Daily demo-data cleanup, called by the scheduled GitHub workflow with CRON_SECRET. Fails closed: with no secret
// configured (or a short one) nothing can run it. Not a browser route, so no origin check; the secret is the auth.
export const POST = route(async (req: Request) => {
  requireHttps(req);
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) throw new HttpError(503, "Cleanup isn't configured");
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!timingSafeEqual(sha(given), sha(secret))) throw new HttpError(401, "Unauthorized", "unauthorized");
  try {
    return noStore(await purgeDemoData());
  } catch (e) {
    console.error(e);
    throw new HttpError(502, "Cleanup didn't finish; it will retry on the next run");
  }
});
