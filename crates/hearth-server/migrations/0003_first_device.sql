-- Immutable initial account identity and public, cross-signed first device.
ALTER TABLE accounts ADD COLUMN identity_key TEXT
    CHECK (identity_key ~ '^[a-f0-9]{64}$');
CREATE TABLE account_devices (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    device_key TEXT NOT NULL CHECK (device_key ~ '^[a-f0-9]{64}$'),
    certificate TEXT NOT NULL CHECK (certificate ~ '^[a-f0-9]{128}$'),
    account_signature TEXT NOT NULL CHECK (account_signature ~ '^[a-f0-9]{128}$'),
    device_signature TEXT NOT NULL CHECK (device_signature ~ '^[a-f0-9]{128}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, device_key)
);
