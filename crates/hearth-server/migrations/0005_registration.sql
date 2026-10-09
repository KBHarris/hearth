INSERT INTO instance_settings(key,value) VALUES('registration_mode','"invite"'::jsonb) ON CONFLICT DO NOTHING;
CREATE TABLE account_invites (
    code_hash BYTEA PRIMARY KEY CHECK (octet_length(code_hash)=32),
    issuer_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '24 hours'
);
