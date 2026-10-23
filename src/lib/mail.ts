// Kitpier's own emails (password reset), from Kitpier's Resend account and verified domain.
// Booking emails don't use this: they go through each business's own Resend (email.ts).

/** Plain-text email from MAIL_FROM. Returns false (and sends nothing) when mail isn't configured. */
export async function sendPlatformMail(to: string, subject: string, text: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) {
    console.error("Platform mail not configured (RESEND_API_KEY, MAIL_FROM); not sending:", subject);
    return false;
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, text }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!r?.ok) console.error("Platform mail failed:", subject, r?.status ?? "network");
  return !!r?.ok;
}
