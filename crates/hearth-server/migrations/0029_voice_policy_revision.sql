-- Public signed policy fingerprint. A changed audience/publication policy moves
-- media to a new revision and fresh client-only keys; no content enters SQL.
ALTER TABLE voice_rooms ADD COLUMN policy_signature TEXT NOT NULL DEFAULT '';
