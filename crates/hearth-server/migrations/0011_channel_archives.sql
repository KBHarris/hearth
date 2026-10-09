-- Public ordering and signed, opaque client ciphertext. No MLS or archive key reaches the host.
CREATE TABLE channel_archives (
    seq BIGSERIAL PRIMARY KEY,
    operation_id TEXT NOT NULL UNIQUE REFERENCES delivery_operations(operation_id),
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    epoch BIGINT NOT NULL CHECK (epoch BETWEEN 0 AND 9007199254740991),
    upload JSONB NOT NULL
);
CREATE INDEX channel_archives_page ON channel_archives(conversation_id,seq);
