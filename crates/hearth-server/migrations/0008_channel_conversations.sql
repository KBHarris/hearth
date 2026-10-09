-- Stable channel/MLS routing binding; payloads and epoch secrets remain client-only.
ALTER TABLE conversations ADD COLUMN channel_id TEXT UNIQUE REFERENCES community_channels(id);
ALTER TABLE conversations ADD CONSTRAINT conversation_channel_id_matches CHECK(channel_id IS NULL OR channel_id=id);
