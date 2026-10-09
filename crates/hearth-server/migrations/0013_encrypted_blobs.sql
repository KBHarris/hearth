-- Only opaque identifiers, ciphertext length/digest, audience and lease/status metadata.
CREATE TABLE encrypted_blobs (
 id TEXT PRIMARY KEY,
 conversation_id TEXT NOT NULL REFERENCES conversations(id),
 account_id TEXT NOT NULL REFERENCES accounts(id),
 device_key TEXT NOT NULL,
 cipher_bytes BIGINT NOT NULL CHECK(cipher_bytes BETWEEN 17 AND 8388736),
 digest TEXT NOT NULL,
 ready BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX encrypted_blobs_owner ON encrypted_blobs(account_id);
