-- Cascading device/account removal must advance the room even if its presence
-- row disappeared before a participant next reads the room.
ALTER TABLE voice_rooms ADD COLUMN roster_digest TEXT NOT NULL DEFAULT '';
