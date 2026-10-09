-- Public routing/authorization metadata and opaque MLS bytes only.
ALTER TABLE account_devices ADD CONSTRAINT account_devices_unique_key UNIQUE(device_key);
CREATE TABLE mls_key_packages (
    package_hash TEXT PRIMARY KEY CHECK (package_hash ~ '^[0-9a-f]{64}$'),
    account_id TEXT NOT NULL REFERENCES accounts(id),
    device_key TEXT NOT NULL REFERENCES account_devices(device_key),
    package TEXT NOT NULL CHECK (length(package) <= 524288),
    claimed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '1 hour'
);
CREATE INDEX mls_packages_device ON mls_key_packages(device_key,claimed);
CREATE TABLE consumed_mls_packages (
    package_hash TEXT PRIMARY KEY CHECK (package_hash ~ '^[0-9a-f]{64}$'),
    device_key TEXT NOT NULL REFERENCES account_devices(device_key),
    consumed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE conversations (
    id TEXT PRIMARY KEY CHECK (id ~ '^[0-9a-f]{64}$'),
    epoch BIGINT NOT NULL CHECK (epoch >= 0 AND epoch <= 9007199254740991),
    members JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE conversation_accounts (
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    account_id TEXT NOT NULL REFERENCES accounts(id),
    PRIMARY KEY(conversation_id,account_id)
);
CREATE TABLE conversation_devices (
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    device_key TEXT NOT NULL REFERENCES account_devices(device_key),
    PRIMARY KEY(conversation_id,device_key)
);
CREATE TABLE delivery_operations (
    operation_id TEXT PRIMARY KEY CHECK (operation_id ~ '^[0-9a-f]{64}$'),
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    account_id TEXT NOT NULL REFERENCES accounts(id),
    device_key TEXT NOT NULL REFERENCES account_devices(device_key),
    action TEXT NOT NULL CHECK (action IN ('commit','send','edit','delete','typing')),
    target_id TEXT REFERENCES delivery_operations(operation_id),
    payload_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE device_delivery_cursors (
    device_key TEXT PRIMARY KEY REFERENCES account_devices(device_key),
    next_seq BIGINT NOT NULL DEFAULT 1 CHECK (next_seq > 0 AND next_seq <= 9007199254740991)
);
CREATE TABLE delivery_events (
    device_key TEXT NOT NULL REFERENCES account_devices(device_key),
    seq BIGINT NOT NULL CHECK (seq > 0 AND seq <= 9007199254740991),
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    operation_id TEXT NOT NULL REFERENCES delivery_operations(operation_id),
    data JSONB NOT NULL,
    ephemeral BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(device_key,seq),
    UNIQUE(device_key,operation_id)
);
