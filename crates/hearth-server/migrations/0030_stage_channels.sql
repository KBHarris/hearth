ALTER TABLE community_channels DROP CONSTRAINT community_channels_kind_check;
ALTER TABLE community_channels ADD CONSTRAINT community_channels_kind_check
    CHECK(kind IN ('text','announcement','forum','voice','stage'));
