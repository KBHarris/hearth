-- Keep routing tombstones so an old channel can never be reinterpreted as a DM.
-- Ciphertext/local history retention is independent from directory deletion.
ALTER TABLE communities ADD COLUMN deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE community_channels ADD COLUMN deleted BOOLEAN NOT NULL DEFAULT FALSE;
