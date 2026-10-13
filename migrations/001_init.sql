-- Walking skeleton schema (SPEC.md §4, §5). Money is integer micro-USD everywhere.

CREATE TABLE users (
  id            text PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  frozen        boolean NOT NULL DEFAULT false,  -- dispute hold / reversal (§4.2)
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id                  text PRIMARY KEY,
  user_id             text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                text NOT NULL,
  description         text NOT NULL DEFAULT '',
  budget_micros       bigint,                       -- optional monthly cap
  daily_cap_micros    bigint NOT NULL DEFAULT 3000000, -- $3/day default (§5)
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_user_idx ON projects(user_id);

-- One row per PayPal order we create. Amount always comes from the server pack table.
CREATE TABLE orders (
  id             text PRIMARY KEY,                -- our id, also custom_id + request-id seed
  paypal_order_id text UNIQUE,
  user_id        text NOT NULL REFERENCES users(id),
  project_id     text NOT NULL REFERENCES projects(id),
  pack_id        text NOT NULL,
  amount_micros  bigint NOT NULL CHECK (amount_micros > 0),
  currency       text NOT NULL DEFAULT 'USD',
  status         text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created','approved','capture_pending','credited','failed','cancelled','reversed')),
  capture_id     text UNIQUE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_user_idx ON orders(user_id);

-- Per-user credit ledger. `source` is the idempotency key for every external effect:
-- capture:<id>, refund:<id>, reversal:<id>, usage:<reservation_id>.
CREATE TABLE ledger_entries (
  id            bigserial PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users(id),
  project_id    text REFERENCES projects(id),
  source        text NOT NULL UNIQUE,
  kind          text NOT NULL CHECK (kind IN ('purchase','refund','reversal','usage','adjustment')),
  amount_micros bigint NOT NULL,
  price_version text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_user_idx ON ledger_entries(user_id);

-- Serializes reserves per user (§5 Tx1 locks this row). Balance is derived from the ledger.
CREATE TABLE user_balances (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);

-- Verified webhook events only (never dedupe on unverified ones, §4.1).
CREATE TABLE webhook_events (
  id          text PRIMARY KEY,
  event_type  text NOT NULL,
  resource_id text,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- Global daily AI spend, locked first in every reserve (§5).
CREATE TABLE platform_daily_spend (
  day              date PRIMARY KEY,
  reserved_micros  bigint NOT NULL DEFAULT 0,
  committed_micros bigint NOT NULL DEFAULT 0,
  exposure_micros  bigint NOT NULL DEFAULT 0
);

CREATE TABLE reservations (
  id            text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users(id),
  project_id    text NOT NULL REFERENCES projects(id),
  day           date NOT NULL,
  amount_micros bigint NOT NULL CHECK (amount_micros > 0),
  state         text NOT NULL DEFAULT 'open' CHECK (state IN ('open','settled','expired_settled')),
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reservations_open_idx ON reservations(user_id) WHERE state = 'open';

CREATE TABLE usage_events (
  reservation_id text NOT NULL REFERENCES reservations(id),
  iteration      int NOT NULL,
  model          text NOT NULL,
  input_tokens   int NOT NULL,
  output_tokens  int NOT NULL,
  cost_micros    bigint NOT NULL,
  PRIMARY KEY (reservation_id, iteration)
);

CREATE TABLE refund_requests (
  id             text PRIMARY KEY,
  user_id        text NOT NULL REFERENCES users(id),
  capture_id     text NOT NULL,
  amount_micros  bigint NOT NULL CHECK (amount_micros > 0),
  state          text NOT NULL DEFAULT 'held' CHECK (state IN ('held','sent','completed','failed')),
  paypal_refund_id text UNIQUE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Postgres-backed fixed-window rate limits (§11).
CREATE TABLE rate_limits (
  key        text PRIMARY KEY,
  count      int NOT NULL,
  reset_at   timestamptz NOT NULL
);
