import { describe, expect, it } from "vitest";
import { openSlots, zonedToUtc } from "./slots";

describe("slots", () => {
  it("converts local times across zones and DST", () => {
    expect(zonedToUtc("2026-10-20", 10, "Asia/Makassar").toISOString()).toBe("2026-10-20T02:00:00.000Z");
    expect(zonedToUtc("2026-07-01", 9, "America/New_York").toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(zonedToUtc("2026-12-01", 9, "America/New_York").toISOString()).toBe("2026-12-01T14:00:00.000Z");
  });

  it("offers 9–17 Mon–Sat, skips taken, past, Sundays and far dates", () => {
    const now = new Date("2026-10-19T03:30:00Z"); // Mon 11:30 in Makassar
    const tz = "Asia/Makassar";
    const tue = openSlots("2026-10-20", tz, [zonedToUtc("2026-10-20", 10, tz)], now).map((s) => s.time);
    expect(tue).toEqual(["09:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]);
    expect(openSlots("2026-10-19", tz, [], now).map((s) => s.time)[0]).toBe("12:00");
    expect(openSlots("2026-10-25", tz, [], now)).toEqual([]); // Sunday
    expect(openSlots("2026-12-30", tz, [], now)).toEqual([]);
    expect(openSlots("2026-10-18", tz, [], now)).toEqual([]);
  });
});
