-- Provider connections and the approval gate (SPEC.md §7, §8).

-- Third-party secrets, AES-256-GCM. AAD = id|user_id|project_id|kind. Plaintext never leaves the server tool.
CREATE TABLE credentials (
  id                 text PRIMARY KEY,
  user_id            text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id         text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('supabase_oauth','supabase_secret_key','resend_send_key')),
  key_version        int  NOT NULL,
  iv                 bytea NOT NULL,
  ciphertext         bytea NOT NULL,
  tag                bytea NOT NULL,
  meta               jsonb NOT NULL DEFAULT '{}',  -- non-secret display data only (e.g. org names)
  refresh_lock_until timestamptz,                   -- one refresh at a time (refresh tokens rotate)
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, kind)
);
CREATE INDEX credentials_user_idx ON credentials(user_id);

-- PKCE state for an OAuth round trip: single use, short-lived, bound to the user who started it.
CREATE TABLE oauth_states (
  state      text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider   text NOT NULL CHECK (provider IN ('supabase')),
  verifier   text NOT NULL,
  expires_at timestamptz NOT NULL
);

-- The only Supabase projects Kitpier may touch. Every Management API call checks membership; fail closed.
CREATE TABLE managed_supabase_refs (
  user_id        text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id     text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ref            text NOT NULL,
  schema_name    text,              -- set when reusing an existing project (stackapp_<id>)
  created_by_us  boolean NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, ref)
);

-- Agent tools only insert these. Side effects run only via POST /api/actions/:id/approve.
CREATE TABLE pending_actions (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id  text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('provision_supabase','create_widget')),
  spec        jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','done','failed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz
);
CREATE INDEX pending_actions_project_idx ON pending_actions(project_id);

-- Async provisioning, idempotent per (user, project).
CREATE TABLE provision_jobs (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id  text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  action_id   text REFERENCES pending_actions(id),
  state       text NOT NULL DEFAULT 'requested'
    CHECK (state IN ('requested','creating','healthy','schema_ready','failed')),
  ref         text,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, project_id)
);
