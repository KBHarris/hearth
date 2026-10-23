ALTER TABLE community_channels DROP CONSTRAINT community_channels_kind_check;
ALTER TABLE community_channels ADD CONSTRAINT community_channels_kind_check
    CHECK(kind IN ('text','announcement','forum','voice'));
ALTER TABLE group_media_capabilities DROP CONSTRAINT group_media_capabilities_format_check;
ALTER TABLE group_media_capabilities ADD CONSTRAINT group_media_capabilities_format_check CHECK(format IN (1,2,3));

-- Public room routing/occupancy only. Contributions are public ECDH points,
-- signed by approved devices; no shared secret, MLS exporter or media key.
CREATE TABLE voice_rooms (
    channel_id TEXT PRIMARY KEY REFERENCES community_channels(id) ON DELETE CASCADE,
    room_id TEXT NOT NULL,
    epoch BIGINT NOT NULL,
    revision BIGINT NOT NULL DEFAULT 1,
    relay_only BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE voice_presence (
    channel_id TEXT NOT NULL REFERENCES voice_rooms(channel_id) ON DELETE CASCADE,
    device_key TEXT NOT NULL REFERENCES account_devices(device_key) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    presence JSONB NOT NULL,
    PRIMARY KEY(channel_id,device_key)
);
