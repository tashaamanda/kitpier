-- Codex auth review fixes (2026-10-24), docs/agent-review-brief.md.

-- A connection is tied to the user's session version when allowed; a password reset revokes it.
ALTER TABLE agent_links DROP CONSTRAINT agent_links_state_check;
ALTER TABLE agent_links ADD CONSTRAINT agent_links_state_check CHECK (state IN ('pending','approved','denied','redeemed','revoked'));
ALTER TABLE agent_links ADD COLUMN user_version integer;

-- An approved key grant records exactly what was approved: the key it replaces (NULL = none) and until when it can be
-- collected. Collection re-checks both under the project lock.
ALTER TABLE key_grants ADD COLUMN approved_live_prefix text;
ALTER TABLE key_grants ADD COLUMN approved_until timestamptz;
