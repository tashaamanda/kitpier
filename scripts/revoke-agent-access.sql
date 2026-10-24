-- Containment: end all agent access at once (docs/deploy-agent-access.md). Run only after AGENT_CONNECT_ENABLED is
-- unset, so no new connections start. One transaction, links first: the UPDATE waits for any poll that holds a link
-- row; a token that poll minted is committed by then, so the token UPDATE below (a later statement) sees and revokes it.
BEGIN;
UPDATE agent_links SET state = 'revoked' WHERE state IN ('pending', 'approved');
UPDATE agent_tokens SET revoked_at = now() WHERE revoked_at IS NULL;
UPDATE key_grants SET status = 'superseded', decided_at = now() WHERE status IN ('pending', 'approved');
COMMIT;
