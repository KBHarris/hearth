-- Public owner-signed archive epoch cutoffs; capability plaintext is still never stored.
ALTER TABLE community_invites ADD COLUMN certificate JSONB;
ALTER TABLE community_members ADD COLUMN invitation JSONB;
