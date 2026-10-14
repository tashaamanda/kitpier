-- Kitpier Booking API: hosted booking page, conversations, and per-turn billing (SPEC §5, §6).

CREATE TABLE widgets (
  id            text PRIMARY KEY,                 -- public id in /r/{id}; maps to (user, project) server-side
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id    text NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  business_name text NOT NULL,
  services      jsonb NOT NULL,
  timezone      text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversations (
  id          text PRIMARY KEY,
  widget_id   text NOT NULL REFERENCES widgets(id) ON DELETE CASCADE,
  turns       int NOT NULL DEFAULT 0,
  input_chars int NOT NULL DEFAULT 0,
  booked      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_widget_idx ON conversations(widget_id);

CREATE TABLE conversation_messages (
  id              bigserial PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user','assistant')),
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversation_messages_idx ON conversation_messages(conversation_id, id);

-- A reservation holds the customer price (credits) and, separately, the worst-case model cost (platform cap).
ALTER TABLE reservations
  ADD COLUMN platform_reserved_micros bigint NOT NULL DEFAULT 0,
  ADD COLUMN booked boolean NOT NULL DEFAULT false,
  ADD COLUMN conversation_id text;

ALTER TABLE pending_actions DROP CONSTRAINT pending_actions_kind_check;
ALTER TABLE pending_actions ADD CONSTRAINT pending_actions_kind_check CHECK (kind IN ('provision_supabase','create_widget'));
