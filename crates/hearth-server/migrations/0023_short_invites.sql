-- The random share code and admission capabilities never reach this table.
CREATE TABLE invite_envelopes (
    id TEXT PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
    creator_id TEXT NOT NULL REFERENCES accounts(id),
    nonce TEXT NOT NULL CHECK (nonce ~ '^[a-f0-9]{24}$'),
    ciphertext TEXT NOT NULL CHECK (ciphertext ~ '^[a-f0-9]+$' AND length(ciphertext) BETWEEN 64 AND 8192 AND length(ciphertext) % 2 = 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours'
);
CREATE INDEX invite_envelopes_creator ON invite_envelopes(creator_id);
CREATE INDEX invite_envelopes_expiry ON invite_envelopes(expires_at);
CREATE TRIGGER invite_envelopes_live_creator BEFORE INSERT OR UPDATE ON invite_envelopes
    FOR EACH ROW EXECUTE FUNCTION hearth_live_account_write('creator_id');
