-- Codex Round 4 verification, 24 Oct 2026 (docs/round4-verification-2026-10-24.md). Additive.

-- R4-1: a top-up order records the monthly budget the owner saw when consenting. Its raise is applied only if the
-- budget is still that value at capture, and only once per top-up. Older in-flight top-up orders (NULL) credit the
-- purchase but don't raise the budget: no snapshot, no consent to check against.
ALTER TABLE orders ADD COLUMN budget_before_micros bigint;

-- R4-2: an open checkout holds its share of the per-account sandbox allowance until this time. A capture after the
-- hold lapsed re-checks the allowance before any money moves.
ALTER TABLE orders ADD COLUMN quota_until timestamptz;
