CREATE TABLE moderation_keys (
    community_id TEXT NOT NULL REFERENCES communities(id),
    account_id TEXT NOT NULL REFERENCES accounts(id),
    device_key TEXT NOT NULL,
    value JSONB NOT NULL,
    FOREIGN KEY(account_id,device_key) REFERENCES account_devices(account_id,device_key),
    PRIMARY KEY (community_id,device_key)
);
CREATE TABLE moderation_reports (
    id TEXT PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
    community_id TEXT NOT NULL REFERENCES communities(id),
    channel_id TEXT NOT NULL REFERENCES community_channels(id),
    reporter_id TEXT NOT NULL REFERENCES accounts(id),
    recipient_id TEXT NOT NULL REFERENCES accounts(id),
    recipient_device TEXT NOT NULL,
    envelope JSONB NOT NULL,
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY(recipient_id,recipient_device) REFERENCES account_devices(account_id,device_key)
);
CREATE INDEX moderation_reports_queue ON moderation_reports(community_id,recipient_id,created_at);
