import { putCredential } from "./credentials";
import { HttpError } from "./session";

// Resend connect (SPEC §7): the pasted full-access key is used once to mint a send-only key, then dropped.
// Only the scoped key is stored (encrypted). Provider response bodies are never echoed: they can hold keys.

const API = "https://api.resend.com";
type Scope = { userId: string; projectId: string };

async function call(key: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: r.status, json };
}

export async function connectResend(s: Scope, fullKey: string) {
  // A full-access key can list domains; a sending-only key gets 401 restricted_api_key.
  const domains = await call(fullKey, "GET", "/domains");
  if (domains.status === 401 && domains.json.name === "restricted_api_key")
    throw new HttpError(400, "That key can only send email. Create a key with Full access in Resend and paste that one.", "restricted_api_key");
  if ([400, 401, 403].includes(domains.status)) throw new HttpError(400, "Resend didn't accept that key. Check you copied all of it.");
  if (domains.status !== 200) throw new HttpError(502, `Resend is unavailable (${domains.status}). Please try again.`);

  const list = (domains.json.data as { name?: string; status?: string }[] | undefined) ?? [];
  const verified = list.filter((d) => d.status === "verified").map((d) => String(d.name).slice(0, 100)).slice(0, 10);

  const minted = await call(fullKey, "POST", "/api-keys", { name: `kitpier-${s.projectId.slice(-8)}`, permission: "sending_access" });
  const token = minted.json.token;
  if (minted.status !== 201 && minted.status !== 200) throw new HttpError(502, `Resend couldn't create a send-only key (${minted.status}).`);
  if (typeof token !== "string") throw new HttpError(502, "Resend returned no key.");

  await putCredential(s, "resend_send_key", token, {
    key_name: `kitpier-${s.projectId.slice(-8)}`,
    verified_domains: verified,
  });
  return { verified_domains: verified };
}
