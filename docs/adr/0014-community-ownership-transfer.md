# ADR 0014: Jointly signed community ownership transfer

Status: implemented; acceptance in progress, 2026-10-12.

Changing a database owner ID is insufficient: clients pin the owner identity and
verify channel policy, admission and historical epoch certificates against it.

The outgoing owner signs an offer under `hearth/v1/ownership-handoff`, binding the
server key, exact previous authority, approved successor device and sorted SHA-256
digests of every existing admission, channel policy and governance snapshot. The
successor signs the new authority containing that offer, a governance revision that
preserves settings, and an explicit admission for a founding former owner.
Existing invitation-bound admissions remain unchanged on subsequent transfers.

The server locks the community, compares the stored offer, previous authority and
current endorsement set, and atomically changes owner/authority/governance and records
an audit digest. The nominated approved device must already belong to every channel's
MLS audience. Unused community invite codes are invalidated. Cancellation and any
intervening change to endorsed state invalidate acceptance. An identical successful
retry returns the accepted authority without a second audit entry.

Clients advance pins only along a verified exact authority lineage. Historical epoch
snapshots remain bound to their original owner and permission policy. Legacy
identity-only pins can migrate when the verified lineage includes the pinned identity;
new pins retain the full authority. Old-owner signed objects remain valid only when
their exact digests are endorsed at every subsequent handoff. This prevents a former
owner from minting new grants or replacing a channel policy with an unendorsed signature.
Fresh governance must be signed by the successor and advance the existing revision.
New publishing waits for an MLS epoch with that governance revision.

The encrypted client snapshot contains a retryable acceptance outbox. Preparing it
does not advance the root pin: a failed network request or stale server CAS therefore
does not strand the client on an unaccepted root. The authoritative response is pinned
and persisted before ordinary channel refresh.

Lineage is bounded to eight handoffs and 2,048 endorsed objects per handoff; community
requests have a one-MiB body bound. Existing messaging snapshot and delivery bounds
still apply. Reaching a bound fails explicitly and preserves state. There is no host
override for an unavailable owner; offline recovery or an approved linked device is
required. Initial owner trust still requires fingerprint comparison. This does not
transfer the home-server operator account or recall content already received.

Validation includes native, product-WASM/HTTP and UI transfer, tampered signatures,
stale/canceled offers, sealed/client and server restarts, repeated transfers, former
owner denial, historical epochs and unchanged settings. Hosted Phase 3 acceptance
remains required before closing the phase.
