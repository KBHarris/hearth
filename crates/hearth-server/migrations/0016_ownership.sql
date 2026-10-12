-- An exact jointly signed root handoff; no message plaintext.
ALTER TABLE communities ADD COLUMN ownership_offer JSONB;
ALTER TABLE community_audit DROP CONSTRAINT community_audit_action_check;
ALTER TABLE community_audit ADD CONSTRAINT community_audit_action_check
    CHECK(action IN ('governance_update','ownership_transfer'));
