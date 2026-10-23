-- Format support is distinct from presence: an invited, upgraded device may
-- be offline without ending the other participants' call. No room/key data.
CREATE TABLE group_media_capabilities (
    device_key TEXT PRIMARY KEY REFERENCES account_devices(device_key) ON DELETE CASCADE
);
