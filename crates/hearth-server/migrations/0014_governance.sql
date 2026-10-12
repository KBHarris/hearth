-- Public, signed governance metadata; never decrypted message or report content.
ALTER TABLE communities ADD COLUMN governance JSONB;
CREATE TABLE community_audit (
    community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    revision BIGINT NOT NULL,
    actor_id TEXT NOT NULL REFERENCES accounts(id),
    action TEXT NOT NULL CHECK (action IN ('governance_update')),
    digest TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(community_id,revision)
);
CREATE TABLE community_rules_acceptance (
    community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    digest TEXT NOT NULL,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(community_id,account_id)
);

ALTER TABLE conversations ADD COLUMN governance_revision BIGINT NOT NULL DEFAULT 0;
