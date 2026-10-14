// Versioned server-side price card (SPEC §4.3). Every debit records the version it was priced with;
// estimate_cost reads this table. Amounts are integer micro-USD and never come from the client or the model.
// Receptionist prices are provisional until the 20-conversation model eval sets them.

export const PRICE_CARD_VERSION = "2026-10-14.1";

export const PRICES = {
  "receptionist.message": { micros: 20_000, unit: "chat message", note: "Each visitor message the assistant answers" },
  "receptionist.booking": { micros: 50_000, unit: "booking", note: "Each confirmed booking written to your database" },
} as const;

export type PriceId = keyof typeof PRICES;

// Typical monthly usage for one small booking site, used for plan-level estimates.
export const TYPICAL_MONTH = { "receptionist.message": 400, "receptionist.booking": 60 } as const satisfies Record<
  PriceId,
  number
>;

export function monthlyEstimateMicros(usage: Partial<Record<PriceId, number>> = TYPICAL_MONTH) {
  let total = 0;
  for (const [id, count] of Object.entries(usage) as [PriceId, number][]) total += PRICES[id].micros * count;
  return total;
}
