# ADR 0013: Signed community governance and epoch-bound permissions

Status: implemented for the initial Phase 3 governance slice, 2026-10-11.

## Problem

Host authorization alone cannot protect a channel from a malicious delivery server
that fabricates roles or adds a formerly admitted member after access is revoked.
Changing permissions must also preserve legitimate messages already queued in an
older MLS epoch and the client-side history authentication introduced in Phase 2.

## Decision

The community owner signs a bounded governance snapshot using the domain
`hearth/v1/community-governance`. The signature includes the pinned server identity,
community ID, revision, roles, assignments, overrides, sanctions, channel limits,
rules and the owner's cross-signed device proof. Clients verify the pinned community
identity, retain the highest revision and reject removal, rollback or a different
snapshot at the same revision. The server serializes updates with a community row
lock and records their digest in a content-free audit log.

Permission resolution is owner access, default permissions plus assigned roles,
everyone override, aggregate role override, member override, then sanctions. Read,
send, react, attach, pin and audit permissions are active. Delegated invitations,
structure changes, governance edits and moderation are reserved for later work;
the UI does not offer those unsupported capabilities.

Every channel epoch binds its verified governance and actual MLS member roster.
Queued messages and imported history use the originating epoch's authorization,
not today's role assignments. History handoff includes deduplicated verified
authorization snapshots, encrypted to the recipient. Device signatures and
admission identity checks remain mandatory for both live and archived messages.

Read revocation immediately denies REST history, roster, conversation listing and
new blob leases. HTTP and gateway backlog share a filter and return ordering
markers for denied content. New publishing is blocked until an authorized online
device removes denied members with an MLS commit. Policy changes that preserve
the audience still require a new epoch before publishing with the new permissions.
An upgraded client captures its existing epoch before pinning its first governance
snapshot; existing queued Phase 2 messages remain readable.

Rules screening is a server-enforced read-only onboarding state. A member accepts
the SHA-256 digest of the signed rules they reviewed. Changed rules invalidate
that acceptance. Screening does not change the confidential channel audience.
Timeouts and slow mode also rely on host time; static role and read permissions
are independently checked by recipient crypto, without trusting a sender clock.

Retention is a signed per-channel number of days. Reads filter expired message
archives and backlog immediately. A worker redacts stored message events and
deletes archives every minute. It retains operation digests and cursor markers to
prevent delayed retries from recreating deleted ciphertext, and preserves MLS
Welcome/commit records required by offline members. Expired blob downloads receive
no new lease. Storage deletion must succeed before its database row is removed;
failures are retried. S3 object deletion is separate from database expiry evidence.

## Limits and verification

Revocation and retention cannot recall copies, keys or plaintext already received
by clients, host backups or a five-minute blob lease already issued. A malicious
host can retain ciphertext outside the product; the retention worker is an honest
host deletion control. Audit entries are not an external transparency log.

Snapshots currently allow 64 roles, 128 assignments/sanctions, 512 overrides/limits,
4,096 bytes of rules and up to 512 epoch authorizations for a channel with history.
The encrypted local store remains bounded at 8 MiB. At these limits clients fail
explicitly and preserve their store. An owner device must be online to rotate all
affected channel groups. Ownership transfer requires an authenticated root handoff
and is not implemented by editing the server's owner column.

Native Rust and real product-WASM/HTTP acceptance cover grant tampering, revision
rollback, scope checks, overrides, delegated pinning, slow mode, timeouts, read
revocation and removal, old queued messages, rules acknowledgement, restart,
database expiry and absence of message plaintext on the host. Browser and storage
evidence and remaining Phase 3 work are tracked in PROGRESS.md and ROADMAP.md.
