/**
 * Kitpier's public origin from APP_URL (e.g. https://kitpier.com), with a stray trailing dot or slash ignored.
 * Throws when unset: links, redirects and origin checks must never fall back to request headers.
 */
export function appOrigin() {
  const raw = process.env.APP_URL;
  if (!raw) throw new Error("APP_URL must be set");
  const url = new URL(raw);
  url.hostname = url.hostname.replace(/\.$/, "");
  return url.origin;
}
