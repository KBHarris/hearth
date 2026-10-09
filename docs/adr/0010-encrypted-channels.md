# ADR 0010: channel MLS groups and admission

Status: second Phase 2 slice implemented, 2026-10-09. Phase 2 remains ongoing.

Migration 0008 adds `conversations.channel_id`, a unique foreign key to a channel with
a constraint that the conversation ID equals the channel ID. Existing Phase 1 rows
retain a null binding and their fixed audience. Never rewrite committed migrations.
The server routes the same signed private MLS envelopes used for DMs; it never decrypts
messages, Welcome secrets or epoch keys. Metadata is documented in the threat model.

Authenticated community members can read `/api/v1/communities/channels/{id}/roster`:
one repeatable-read snapshot of the community, channel and account/device public proofs.
Instance ownership provides no implicit access. A channel conversation becomes visible
to members before their device has joined MLS, so the client can show a waiting state.
Commits require community membership for the actor and every account in their manifest,
approved cross-signed devices, retained existing members and an existing MLS actor for
subsequent commits. DMs still reject account expansion and are bounded to 32 devices.
Channel messages require both community and MLS membership. Announcement send, typing,
edit and delete uploads require the community owner; reading and rekeying remain open
to members. Role delegation and membership/device removal are later governance work.

The client uses one serialized messaging engine and durable outbox for DMs and channels.
It verifies and pins account identity/device proofs, drains ordered backlog before
rekeying, claims single-use packages, persists pending commits before upload and rolls
back only definite rejections. An active existing device adds newly admitted accounts
and approved devices. A first member may initialize a solo channel using a private MLS
self-update commit with no Welcome. If nobody with the existing epoch is online, a new
device waits; no server-side key generation or plaintext fallback is available.

History is `none`: a new account/device receives only messages sent after its Welcome.
Earlier ciphertext is not copied to its delivery queue. A message sent before a waiting
device joins is therefore unavailable to that device even if it already joined the
community directory. Local history on existing devices remains encrypted and survives
restart. `since-invite` and `full`, wrapped history handoff and attachments are unfinished.

This slice bounds a channel to 128 devices; the roster endpoint rejects communities
above 128 accounts. Directory capacity remains 1,024 accounts, which does not establish
that a community of that size can use this channel implementation. Wire payloads remain
256 KiB and sealed state 8 MiB. No large-channel benchmark is claimed.

Admission currently trusts the server's authenticated community directory. Cross-signed
proofs prevent the host from substituting devices under an already pinned account, but
they do not prove that the owner approved a newly listed account. A malicious host could
fabricate directory admission for a legitimately enrolled identity and induce an online
client to share a future epoch. This slice does not establish channel confidentiality
against such a hostile host. Owner-authorized, client-verifiable admission is a required
follow-up before that claim or Phase 2 completion. Existing fixed-audience DMs do not
gain automatic account admission.

The real HTTP/product-WASM suite passes 38 outcomes, including eight channel outcomes:
solo creation/idempotence, outsider denial/fixed DM audience, invite admission without
history, stale-epoch rejection, later accounts/devices, announcement restrictions,
sealed offline restart and plaintext canaries. Browser acceptance exercises two isolated
profiles and the normal community/channel controls; its current report is in the
development guide. This is local validation, not a two-house or large-community test.
The two-profile Chrome UI suite passes nine outcomes, including automatic joins/rekeys,
announcement read/publish controls and saved-history recovery after a directory outage.
