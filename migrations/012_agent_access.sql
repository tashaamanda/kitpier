-- Agent access (docs/agent-scope.md B). An agent asks for a link, the signed-in owner picks one project and allows it,
-- and the agent's poll redeems it once for a ka_ token. Codes, poll tokens and token secrets are stored as SHA-256 only.
CREATE TABLE agent_links (
  id            text PRIMARY KEY,
  code_hash     bytea NOT NULL UNIQUE,
  poll_hash     bytea NOT NULL UNIQUE,
  client_name   text NOT NULL,          -- self-reported by the agent, never shown as verified
  project_name  text,                   -- suggested name for a new project
  state         text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','denied','redeemed')),
  user_id       text REFERENCES users(id) ON DELETE CASCADE,
  project_id    text REFERENCES projects(id) ON DELETE CASCADE,
  last_poll_at  timestamptz,
  expires_at    timestamptz NOT NULL,
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ka_<prefix>_<secret>: one user, one project. Expires after 30 days; a token never used within 24 hours stops working.
CREATE TABLE agent_tokens (
  id           text PRIMARY KEY,
  link_id      text NOT NULL UNIQUE REFERENCES agent_links(id) ON DELETE CASCADE,
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id   text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  client_name  text NOT NULL,
  prefix       text NOT NULL UNIQUE,
  secret_hash  bytea NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX agent_tokens_project_idx ON agent_tokens(project_id);
