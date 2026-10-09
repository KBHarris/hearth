# ADR 0012: signed history boundaries and encrypted files

Status: implemented; local HTTP/WASM, Chrome UI, packaged Windows and bundle checks pass.
All twelve hosted checks pass for `7cc8852`; human WAN/week acceptance remains pending.
Date: 2026-10-09.

## Decision

Owners choose `none`, `since_invite` or `full` per channel through a signed, monotonically
revised policy. Creating an invite first rotates each current channel and signs its epoch
cutoff. The typed invite capability hashes to the certificate's signed digest; joining
clients pin that certificate. Owner admission copies its exact history map. Later-created
channels sign an explicit list of existing invite digests, avoiding host timestamps as an
access decision. Later linked devices retain the account's cutoff.

Persistent messages have a second ciphertext encrypted under a per-epoch MLS exporter.
An online owner device wraps retained keys to a requester's ephemeral X25519 public key,
with server/channel/request/device context and XChaCha20 authentication, inside MLS.
The host serves bounded ciphertext pages and never obtains exporter keys. Receivers verify
cross-signed sender proofs, device signatures, policy floors and archive AEAD, and suppress
duplicate imports. Live updates take priority over old archives. Requests, key handoffs,
private file descriptors and keys survive only in the encrypted transaction snapshot.

Attachments use random per-file keys and 1 MiB XChaCha20 chunks. Descriptors carry private
filenames, MIME types, nonce prefixes, keys, ciphertext digests and optional locally created
thumbnails inside MLS. Public-to-local-UI views omit keys. Storage endpoints receive only
opaque IDs, encrypted byte counts/digests and routing/device metadata. They return five-minute
private S3 PUT/GET capabilities. PUT binds Content-Length; completion checks object size.
Recipients check digest, scope, AEAD and total length before downloading/decrypting.
Custom emoji are owner-published encrypted raster assets scoped to a channel; republish for
new members, or use permitted retained history to recover a previous definition.

Self-hosted SeaweedFS uses a generated credential configuration with no anonymous identity,
explicit CORS and telemetry disabled. Caddy forwards the bucket path without stripping it,
preserving SigV4 host/path binding. S3 stays private behind loopback or HTTPS. Bootstrap
preserves existing matching secrets and rejects conflicting configuration. The Phase 2
test bundle must use its own project/data; it does not migrate the live Phase 1 server.

## Limits and consequences

- History retention intentionally reduces retrospective forward secrecy for archives.
  A compromised device holding retained exporter keys can read that permitted history.
- Policy changes cannot recall shared keys/plaintext or archive unarchived messages.
  Backfill requires an online owner device that retained the requested keys. Initial
  limit: 512 retained epochs/channel and 16 outstanding local requests.
- Files are bounded to 8 MiB; account reservations to 128 MiB/2,048 objects, with 16 pending
  uploads. Incomplete leases expire after 20 minutes; ready object retention/deletion is
  future governance work. Existing signed URLs remain usable until their five-minute expiry.
- Ciphertext cache contains no plaintext or keys and evicts above 32 records/32 MiB.
  Decrypted file bytes enter JS only for the requested local preview/download. Web client
  compromise still exposes unlocked content; no independent audit is claimed.
- Product MLS capacity remains 128 devices. The native synthetic 1k-member benchmark
  measures OpenMLS commit cost, not 1k-member product/network/browser capacity.

## Evidence

The real HTTP/product-WASM suite passes encrypted file/thumbnail/custom-emoji, scope,
tamper, sealed restart and no-plaintext canary checks, including scans of S3 volume bytes.
History none/full/signed-since-invite and owner linked-device backfill pass over HTTP.
Native history tests also cover ordinary-member linked-device cutoffs and recipient-bound
handoff. The committed reports record 49 HTTP/WASM, 18 Chrome UI, ten packaged Windows
checks and eight assembled-bundle checks. All twelve hosted jobs pass for `7cc8852`,
including nine core native checks on each platform and ten isolated Linux repetitions.
