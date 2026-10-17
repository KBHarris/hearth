CREATE TABLE user_blocks (
    account_id TEXT NOT NULL REFERENCES accounts(id),
    blocked_id TEXT NOT NULL REFERENCES accounts(id),
    PRIMARY KEY(account_id,blocked_id),
    CHECK(account_id<>blocked_id)
);
CREATE TABLE server_bans (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id),
    issuer_id TEXT NOT NULL REFERENCES accounts(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
