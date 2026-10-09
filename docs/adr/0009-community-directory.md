# ADR 0009: authenticated community structure

Status: first Phase 2 slice implemented and locally verified, 2026-10-08.

Community structure is navigation/authorization metadata. Add migration 0007 with
communities, account membership, categories, text/announcement channel records and
hashed invitation capabilities. Never alter committed Phase 1 migrations. The
[metadata inventory](../THREAT_MODEL.md) documents every stored field and retention.

`/api/v1/communities` GET/POST lists or creates communities. Authenticated members
read `/{id}`; its response contains one repeatable-read snapshot of community,
categories and channels. Only the community owner creates categories, channels and
invitations. Instance ownership conveys no implicit access to another account's
community. Governance, roles, overrides, transfer, removal and deletion follow later.

Names are printable UTF-8 metadata of 1–80 bytes. Channels may reference only a category
in their own community, enforced both by the API and a composite PostgreSQL foreign key.
Response validators reject duplicate IDs, malformed enums and foreign/missing category
references. Wire types and TypeScript declarations come from the permissive protocol
crate; application/SQL logic stays in the AGPL server and client.

Invite codes are random 256-bit capabilities shown only at creation; PostgreSQL stores
SHA-256 digests, creator, deadline and use counters. Invites last 60 seconds–7 days and
admit 1–1,000 new members. Joining requires an existing server account. Account-row
locks serialize the per-account community bound; community and invite locks serialize
capacity and consumption. Account locks use `FOR NO KEY UPDATE` so foreign-key checks
can still acquire key-share locks. Expiry checks use wall-clock time after waiting for
locks. An already-joined account does not consume another use while the invitation
remains valid; unknown/expired/exhausted invitations cannot admit new members.

Bound the directory to 100 communities/account, 1,024 members/community, 256 categories,
512 channels and 32 active invites. Authenticated budgets, operation admission, explicit
CORS origins, no-store responses and a 4 KiB body limit cover these endpoints.
These are resource bounds, not evidence for large-channel MLS performance.

No channel conversation or content route is added in this slice. Joining the directory
does not enroll a device, change an MLS roster or share any epoch keys/history. Text and
announcement types currently classify channel records only. The next slice must bind
channel IDs to MLS groups, authorize and synchronize the cryptographic roster, and keep
an explicit no-history default. Later history handoff must preserve the existing
client-only encryption and server-blind content invariant.

Local acceptance passes 30 real HTTP/product-WASM outcomes (seven community outcomes)
and five headless Chrome UI outcomes. Tests cover outsider/owner boundaries, two-account
single-use races, duplicate joins, multi-use invites, expired invites, cross-community
category references, restart persistence, logout and rejection of content-shaped fields.
The UI test verifies real controls, literal text rendering, invite hiding and outage
retry; it does not replace two-house or native packaged testing. Phase 2 remains ongoing.
