// Server-side price table for credit packs. Amounts never come from the client or the model (SPEC §4).
export const PACKS = {
  p10: { label: "Starter credits", amountMicros: 10_000_000 },
  p25: { label: "Builder credits", amountMicros: 25_000_000 },
  p50: { label: "Launch credits", amountMicros: 50_000_000 },
} as const;

export type PackId = keyof typeof PACKS;
export const PACK_IDS = Object.keys(PACKS) as [PackId, ...PackId[]];
export const CURRENCY = "USD";
