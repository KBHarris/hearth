-- Public control-format support only, never a room, participation or media key.
-- Existing announcements are version 1 and must be refreshed by an upgraded client.
ALTER TABLE group_media_capabilities
    ADD COLUMN format SMALLINT NOT NULL DEFAULT 1 CHECK (format IN (1,2));
