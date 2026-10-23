-- Forgot password. Links carry a random token; only its SHA-256 is stored, so a database leak can't reset anyone.
-- One live token per user (a new request replaces the old), 30-minute expiry, deleted when used.
CREATE TABLE password_resets (
  token_hash  text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_user_idx ON password_resets(user_id);

-- Sessions are sealed cookies; bumping this on password reset signs out every other device.
ALTER TABLE users ADD COLUMN session_version integer NOT NULL DEFAULT 0;
