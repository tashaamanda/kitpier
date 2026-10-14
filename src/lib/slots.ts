// Opening hours and slot math for the booking page. v1 rule: Monday–Saturday, 09:00–17:00, one-hour slots,
// in the business's timezone, up to 30 days ahead.

export const OPEN_HOUR = 9;
export const CLOSE_HOUR = 17;
export const DAYS_AHEAD = 30;

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Offset (ms) of a timezone at an instant: local wall time minus UTC. */
function offsetAt(utcMs: number, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(utcMs))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - utcMs;
}

/** Local wall-clock date + hour in tz → UTC Date. */
export function zonedToUtc(date: string, hour: number, tz: string) {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour);
  let t = guess - offsetAt(guess, tz);
  t = guess - offsetAt(t, tz);
  return new Date(t);
}

/** Today's date (YYYY-MM-DD) in tz. */
export function localToday(tz: string, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function weekday(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
}

/** Bookable start times for a date, given already-booked starts. Empty if closed, past or too far ahead. */
export function openSlots(date: string, tz: string, booked: Date[], now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || weekday(date) === 0) return [];
  const today = localToday(tz, now);
  const days = (Date.parse(date) - Date.parse(today)) / 86_400_000;
  if (!(days >= 0 && days <= DAYS_AHEAD)) return [];
  const taken = new Set(booked.map((b) => b.getTime()));
  const out: { time: string; startsAt: Date }[] = [];
  for (let h = OPEN_HOUR; h < CLOSE_HOUR; h++) {
    const startsAt = zonedToUtc(date, h, tz);
    if (startsAt.getTime() <= now.getTime() || taken.has(startsAt.getTime())) continue;
    out.push({ time: `${String(h).padStart(2, "0")}:00`, startsAt });
  }
  return out;
}
