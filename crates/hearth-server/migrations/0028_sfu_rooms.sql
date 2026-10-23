-- Public topology/capability only. Media and wrapping keys remain client-side.
ALTER TABLE voice_rooms ADD COLUMN sfu BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE group_media_capabilities DROP CONSTRAINT group_media_capabilities_format_check;
ALTER TABLE group_media_capabilities ADD CONSTRAINT group_media_capabilities_format_check CHECK(format IN (1,2,3,4,5));
