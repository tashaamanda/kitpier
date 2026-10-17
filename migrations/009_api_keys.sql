-- Server-to-server Booking API keys (SPEC §6): mk_<prefix>_<secret>. Looked up by the non-secret prefix,
-- only a SHA-256 of the secret is stored, compared in constant time. One live key per project; a new key revokes the old.
CREATE TABLE api_keys (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id   text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  widget_id    text NOT NULL REFERENCES widgets(id) ON DELETE CASCADE,
  prefix       text NOT NULL UNIQUE,
  secret_hash  bytea NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX api_keys_project_idx ON api_keys(project_id);
CREATE UNIQUE INDEX api_keys_one_live ON api_keys(project_id) WHERE revoked_at IS NULL;
