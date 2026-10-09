-- Public owner signatures; private signing keys remain in client vaults.
ALTER TABLE communities ADD COLUMN authority JSONB;
ALTER TABLE community_members ADD COLUMN admission JSONB;
ALTER TABLE community_channels ADD COLUMN policy JSONB;
