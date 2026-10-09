-- Authenticated community directory/authorization metadata; no message content.
CREATE TABLE communities (
    id TEXT PRIMARY KEY CHECK (id ~ '^[0-9a-f]{64}$'),
    name TEXT NOT NULL CHECK (octet_length(name) BETWEEN 1 AND 80),
    owner_id TEXT NOT NULL REFERENCES accounts(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX communities_owner ON communities(owner_id);
CREATE TABLE community_members (
    community_id TEXT NOT NULL REFERENCES communities(id),
    account_id TEXT NOT NULL REFERENCES accounts(id),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(community_id, account_id)
);
CREATE INDEX community_members_account ON community_members(account_id);
CREATE TABLE community_categories (
    id TEXT PRIMARY KEY CHECK (id ~ '^[0-9a-f]{64}$'),
    community_id TEXT NOT NULL REFERENCES communities(id),
    name TEXT NOT NULL CHECK (octet_length(name) BETWEEN 1 AND 80),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(community_id, id)
);
CREATE TABLE community_channels (
    id TEXT PRIMARY KEY CHECK (id ~ '^[0-9a-f]{64}$'),
    community_id TEXT NOT NULL REFERENCES communities(id),
    category_id TEXT,
    name TEXT NOT NULL CHECK (octet_length(name) BETWEEN 1 AND 80),
    kind TEXT NOT NULL CHECK(kind IN ('text', 'announcement')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY(community_id, category_id) REFERENCES community_categories(community_id, id)
);
CREATE INDEX community_channels_community ON community_channels(community_id);
CREATE TABLE community_invites (
    code_hash BYTEA PRIMARY KEY CHECK(octet_length(code_hash) = 32),
    community_id TEXT NOT NULL REFERENCES communities(id),
    created_by TEXT NOT NULL REFERENCES accounts(id),
    expires_at TIMESTAMPTZ NOT NULL,
    max_uses INTEGER NOT NULL CHECK(max_uses BETWEEN 1 AND 1000),
    uses INTEGER NOT NULL DEFAULT 0 CHECK(uses >= 0 AND uses <= max_uses),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX community_invites_community ON community_invites(community_id);
