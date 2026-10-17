-- Decimal 50 MB plaintext plus 48 AEAD chunk tags; content remains opaque.
ALTER TABLE encrypted_blobs DROP CONSTRAINT encrypted_blobs_cipher_bytes_check;
ALTER TABLE encrypted_blobs ADD CONSTRAINT encrypted_blobs_cipher_bytes_check
    CHECK (cipher_bytes BETWEEN 17 AND 50000768);

-- Permanent opaque removal receipts prevent reuse after physical cleanup.
-- No file names, types, message text or decryption keys are stored here.
CREATE TABLE blob_removals (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    removed_by TEXT NOT NULL REFERENCES accounts(id),
    removed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
