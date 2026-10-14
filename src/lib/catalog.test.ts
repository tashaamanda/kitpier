import { describe, expect, it } from "vitest";
import { BADGES, LISTINGS, getListing } from "./catalog";
import { PRICES, monthlyEstimateMicros } from "./pricecard";

describe("catalog", () => {
  it("has unique URL-safe slugs", () => {
    const slugs = LISTINGS.map((l) => l.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9-]+$/);
  });

  it("shows all three badges, with the v1 live listings", () => {
    for (const type of Object.keys(BADGES)) expect(LISTINGS.some((l) => l.type === type)).toBe(true);
    expect(getListing("booking-api")?.type).toBe("buy");
    expect(getListing("supabase")?.type).toBe("connect");
    expect(getListing("resend")?.type).toBe("connect");
    expect(LISTINGS.filter((l) => l.type === "buy").map((l) => l.slug)).toEqual(["booking-api"]);
  });

  it("never uses 'App Store' or 'PayPal' as a listing name", () => {
    for (const l of LISTINGS) expect(l.name).not.toMatch(/app store|paypal/i);
  });
});

describe("price card", () => {
  it("prices are positive integer micros", () => {
    for (const p of Object.values(PRICES)) {
      expect(Number.isInteger(p.micros)).toBe(true);
      expect(p.micros).toBeGreaterThan(0);
    }
  });

  it("estimates usage from the table", () => {
    expect(monthlyEstimateMicros({ "booking.message": 10, "booking.created": 2 })).toBe(
      10 * PRICES["booking.message"].micros + 2 * PRICES["booking.created"].micros,
    );
  });
});
