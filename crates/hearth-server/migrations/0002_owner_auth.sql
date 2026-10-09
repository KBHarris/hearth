-- Credential envelopes and authentication metadata only; never plaintext content.
CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL CHECK (username ~ '^[a-z0-9_]{3,32}$'),
    owner BOOLEAN NOT NULL DEFAULT FALSE,
    opaque_profile TEXT NOT NULL,
    password_file BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_instance_owner ON accounts (owner) WHERE owner;

CREATE TABLE auth_login_exchanges (
    id_hash BYTEA PRIMARY KEY,
    account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    opaque_state BYTEA NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '2 minutes'
);
CREATE INDEX auth_login_expiry ON auth_login_exchanges (expires_at);

CREATE TABLE auth_sessions (
    token_hash BYTEA PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auth_session_expiry ON auth_sessions (expires_at);
