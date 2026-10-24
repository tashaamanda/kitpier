-- Codex full audit, 24 Oct 2026 (docs/security-and-submission-audit-2026-10-24.md). Additive.

-- F1: a request is bound to its operation and exact input, and to the reservation it charges. A request that has a
-- reservation is never forgotten: a retry gets the stored or reconciled result, never a second charge.
ALTER TABLE turn_requests ADD COLUMN op_hash text;
ALTER TABLE turn_requests ADD COLUMN reservation_id text REFERENCES reservations(id) ON DELETE SET NULL;

-- F2: a booking is charged only once its write is confirmed. 'claimed' = about to write, outcome unknown if we stop
-- there; it is never charged. Replaces the reservations.booked flag (kept for old rows, no longer read).
ALTER TABLE reservations ADD COLUMN booking_state text CHECK (booking_state IN ('claimed', 'confirmed'));
UPDATE reservations SET booking_state = 'claimed' WHERE booked AND state = 'open';

-- F3: refund, reversal and dispute events for a capture we haven't linked to an order yet. Kept until the capture is
-- linked, then applied in the same transaction; never marked processed while unmatched.
CREATE TABLE deferred_payment_events (
  event_id    text NOT NULL,
  capture_id  text NOT NULL,
  event_type  text NOT NULL,
  resource    jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  applied_at  timestamptz,
  PRIMARY KEY (event_id, capture_id)
);
CREATE INDEX deferred_payment_events_open_idx ON deferred_payment_events(capture_id) WHERE applied_at IS NULL;

-- F6: the expiry sweep looks across all days.
CREATE INDEX reservations_expired_open_idx ON reservations(expires_at) WHERE state = 'open';
CREATE INDEX platform_usage_expired_open_idx ON platform_usage(expires_at) WHERE state = 'open';
