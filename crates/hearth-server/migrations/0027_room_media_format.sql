-- Format 4 adds encrypted, versioned camera/screen state to room heartbeats.
-- Audio-only format 3 devices must upgrade before a room can publish media.
-- Private group calls retain their existing format-2 wire/key context.
ALTER TABLE group_media_capabilities DROP CONSTRAINT group_media_capabilities_format_check;
ALTER TABLE group_media_capabilities ADD CONSTRAINT group_media_capabilities_format_check
    CHECK(format IN (1,2,3,4));
