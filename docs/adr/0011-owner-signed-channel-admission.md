# ADR 0011: Client-verifiable community admission

Status: implemented; Phase 2 prototype, 2026-10-09.

The host directory alone cannot authorize a new account to receive channel secrets.
An invited account appears in the directory as pending. The community owner compares
its identity fingerprint and explicitly approves encrypted access. The client signs an
immutable admission binding that account and identity to this community. Subsequent
devices still require the account's cross-signed enrollment proof.

The owner signs a community authority and each channel's kind, history policy and
monotonic policy revision. Every channel commit carries these statements and admissions,
bound to its device signature and MLS authenticated data. Receiving clients verify the
proofs before accepting a Welcome or merging a commit, even if a modified host skips its
database authorization. Announcement readers independently reject publishing by another
account. A known DM cannot be relabeled as a channel.

The first community authority is trust on first use. Compare the owner's identity using
an independent channel to authenticate that first contact. Encrypted snapshots pin the
owner account and identity; a later host-supplied replacement fails closed. This does not
protect a first contact whose host and identity comparison are both compromised.

The server stores public authority, admission and policy JSON, validates approved issuers,
and checks exact stored statements at commit submission. It stores no private signing
keys, MLS secrets or content. Admissions currently remain append-only; revocation,
ownership transfer and granular permissions belong to Phase 3.

Phase 1 DMs preserve their prior canonical signature/AAD formats by omitting the optional
authorization field. Earlier unsigned Phase 2 prototype channel snapshots cannot silently
upgrade to this format. Use fresh Phase 2 test data until an explicit migration is tested.

Validation: 39 real HTTP/product-WASM checks, the real two-profile Chrome approval flow,
and a native crypto test that relays a cryptographically valid unauthorized announcement
from a client that bypasses its own guard. Forged admissions, server-owner implicit access,
known owner replacement and known DM relabeling are rejected.
