-- Booking emails (SPEC §6): one-time codes prove the customer owns the address; confirmations only go to
-- a verified address, from a fixed template, once per booking.

CREATE TABLE email_codes (
  id              text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  pending_id      text NOT NULL,          -- bound to the exact booking card; new details = new card = old code void
  email           text NOT NULL,
  code_hash       text NOT NULL,
  attempts        int NOT NULL DEFAULT 0,
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_codes_conv_idx ON email_codes(conversation_id);

CREATE TABLE email_sends (
  id              bigserial PRIMARY KEY,
  project_id      text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  conversation_id text REFERENCES conversations(id) ON DELETE SET NULL,
  kind            text NOT NULL CHECK (kind IN ('code','confirmation')),
  status          text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending','sent','failed')),
  provider_id     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- At most one confirmation per booking conversation.
CREATE UNIQUE INDEX email_sends_one_confirmation ON email_sends(conversation_id) WHERE kind = 'confirmation';
