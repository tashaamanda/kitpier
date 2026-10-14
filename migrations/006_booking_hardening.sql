-- Booking hardening (review 2026-10-14): server-recorded confirmation, per-conversation lease,
-- and idempotent message requests.

ALTER TABLE conversations
  ADD COLUMN pending     jsonb,          -- booking details the customer is asked to confirm (set by propose_booking)
  ADD COLUMN lease_until timestamptz;    -- one request at a time per conversation

-- Each customer message carries a client-generated id. Retries return the stored result instead of re-running.
CREATE TABLE turn_requests (
  widget_id   text NOT NULL REFERENCES widgets(id) ON DELETE CASCADE,
  request_id  text NOT NULL,
  status      text NOT NULL DEFAULT 'running' CHECK (status IN ('running','done')),
  response    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (widget_id, request_id)
);
