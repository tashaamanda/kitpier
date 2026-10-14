-- "What are you building?" planner (SPEC §1, §5 platform guardrails, §8).

-- Plain-text conversation per project. Rendered as text only; never HTML.
CREATE TABLE plan_messages (
  id          bigserial PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id  text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('user','assistant')),
  body        text NOT NULL,
  proposal_id text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plan_messages_project_idx ON plan_messages(project_id, id);

-- Stack cards. Items come from the catalog and all money figures from the price card, never from the model.
CREATE TABLE stack_proposals (
  id                   text PRIMARY KEY,
  user_id              text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id           text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  items                jsonb NOT NULL,
  usage                jsonb NOT NULL,
  enforced_micros      bigint NOT NULL,
  external_paid_micros bigint NOT NULL,
  budget_cap_micros    bigint NOT NULL CHECK (budget_cap_micros > 0),
  price_version        text NOT NULL,
  status               text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','superseded')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  decided_at           timestamptz
);
CREATE INDEX stack_proposals_project_idx ON stack_proposals(project_id);

-- Platform-paid model usage (the free planner). Reserves against platform_daily_spend, never the user's credits.
CREATE TABLE platform_usage (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id      text REFERENCES projects(id) ON DELETE SET NULL,
  purpose         text NOT NULL CHECK (purpose IN ('planner')),
  day             date NOT NULL,
  reserved_micros bigint NOT NULL CHECK (reserved_micros > 0),
  cost_micros     bigint NOT NULL DEFAULT 0,
  input_tokens    int NOT NULL DEFAULT 0,
  output_tokens   int NOT NULL DEFAULT 0,
  iterations      int NOT NULL DEFAULT 0,
  state           text NOT NULL DEFAULT 'open' CHECK (state IN ('open','settled','expired_settled')),
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_usage_open_idx ON platform_usage(day) WHERE state = 'open';
