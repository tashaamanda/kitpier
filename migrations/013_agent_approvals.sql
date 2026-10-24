-- Agent approvals (docs/agent-scope.md C/D).

-- An agent asks for a Booking API key; the owner approves it in the browser; the agent collects it once.
-- The key is minted only at collection, in the same transaction that marks the grant claimed.
CREATE TABLE key_grants (
  id                 text PRIMARY KEY,
  user_id            text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id         text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_token_id     text REFERENCES agent_tokens(id) ON DELETE SET NULL,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','claimed','superseded')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  decided_at         timestamptz,
  claimed_at         timestamptz
);
CREATE UNIQUE INDEX key_grants_one_open ON key_grants(project_id) WHERE status IN ('pending','approved');

-- A link the agent hands the person. Items are a snapshot (kind, target id, fingerprint of the exact details shown);
-- an item can be approved from the link only while the target still matches its fingerprint.
CREATE TABLE approval_links (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id      text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_token_id  text REFERENCES agent_tokens(id) ON DELETE SET NULL,
  items           jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL
);
CREATE INDEX approval_links_project_idx ON approval_links(project_id);

-- Which agent token proposed what (null = the person, in the web app).
ALTER TABLE stack_proposals ADD COLUMN agent_token_id text REFERENCES agent_tokens(id) ON DELETE SET NULL;
ALTER TABLE pending_actions ADD COLUMN agent_token_id text REFERENCES agent_tokens(id) ON DELETE SET NULL;
