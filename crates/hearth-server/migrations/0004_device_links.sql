-- Only encrypted, short-lived identity handoffs. The code is never sent to the server.
CREATE TABLE device_link_offers (
    id TEXT PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    device_key TEXT NOT NULL,
    envelope TEXT NOT NULL CHECK (octet_length(envelope) <= 4096),
    signature TEXT NOT NULL CHECK (signature ~ '^[a-f0-9]{128}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '3 minutes',
    FOREIGN KEY (account_id,device_key) REFERENCES account_devices(account_id,device_key)
);
