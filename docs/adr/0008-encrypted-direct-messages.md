# ADR 0008: Device-authenticated MLS delivery and durable encrypted DMs

Date: 2026-10-07. Status: implemented and verified, 2026-10-08. All twelve hosted jobs
pass for implementation `43ac92b`; see PROGRESS for the evidence and manual-test checkpoint.

## Protocol and identity

Product messaging uses OpenMLS 0.9 with the RustCrypto provider, suite
`MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`, private handshake messages and the
ratchet-tree extension. Each leaf's BasicCredential contains an account ID and its
account/server-scoped, cross-signed device enrollment. Its signature key must match
the enrolled device. Clients verify every leaf and pin account identity roots in the
encrypted local snapshot. Changed roots block new device additions and conversation
creation and display a comparison warning. First use still requires independent
fingerprint comparison to detect a malicious initial directory.

KeyPackages are validated as actual signed MLS packages, including lifetime and leaf
identity. Each approved device advertises at most four unexpired packages. Claims
are atomic and single-use; the pool expires after one hour. Accepted commits consume
claimed packages and leave hash tombstones so delayed upload retries cannot advertise
already-consumed secrets. The client persists private package state and its upload
outbox before advertisement. A received Welcome consumes any corresponding pending
upload locally. Unused private package material currently remains in encrypted state;
compaction is future work.

Conversations have two to ten fixed accounts and at most 32 devices. A current device
can add another approved device belonging to an existing participant. Changing the
account audience requires a separate conversation. Creation/addition is an MLS commit
with a Welcome for each added device. The server serializes commits and applications
under a conversation row lock, compares the expected epoch, and commits the roster,
single-use packages, operation receipt and per-device fan-out together. Global random
operation IDs permit exact retries; conflicting reuse fails. The encrypted MLS AAD
and outer device signature bind the operation ID, server, conversation, epoch, action,
target and public roster. Clients compare the resulting authenticated MLS roster to
the signed public manifest before accepting the transaction.

## Gateway and backlog

The gateway sends its existing protocol Hello and a fresh 256-bit challenge. Identify
requires an expiring account token and an enrolled-device signature over a domain
context, token hash, challenge and server key. Its Ready scope ID identifies the
account/device stream and conveys no authority. Resume rejects another scope or a
cursor ahead of the device's highest allocated sequence. Authentication is checked
throughout the connection, so revoked sessions close live sockets.

Fan-out allocates a gap-free, device-wide sequence in sorted device-lock order.
HTTP backlog and WebSocket delivery read the same ordered queue. The gateway sends
at most 128 unacknowledged events, checks heartbeat liveness, and bounds connection,
frame, input-rate and send-time resources. Clients acknowledge only after encrypted
storage commits. Already-persisted duplicates from overlapping HTTP and WebSocket
reads are acknowledged without processing their MLS ratchet again.

The client drains backlog before rekeying. A committer can still accept an epoch
while a preceding-epoch application is in flight; retain one prior epoch's application
secrets for that window. New devices receive only a fresh Welcome and subsequent
messages. There is no old-history handoff. OpenMLS's bounded sender-ratchet limits
remain in force; an excessive missing-generation gap fails visibly instead of
discarding keys or resetting identity.

## Local transaction and storage

The WASM worker owns the identity, device key, MLS provider, account pins, plaintext
history, cursor and pending operations. A versioned XChaCha20-Poly1305 snapshot binds
the server/account/device and format context and uses the install's random local
store key. Raw private keys and provider snapshots never cross the worker boundary.
The UI necessarily receives decrypted text and typing indicators for display.

Product WASM uses the optimized release profile. Linux WebKitGTK intermittently
rejects valid OPAQUE registration exchanges with the debug artifact; the optimized
artifact passes ten isolated packaged runs. The OPAQUE/Argon2 profile remains fixed,
and a real HTTP/WASM compatibility gate verifies credentials and encrypted identity
vaults created by the debug build still open with the optimized build. Worker failures
carry only fixed classes to the bundled diagnostic entry; exception text is never
exported or logged.

Every crypto operation snapshots provider/client state and rolls it back on rejected
input, including failed ciphertext authentication, AAD and roster checks. A queued
send is sealed before HTTP upload. Its exact ciphertext is retried after an unknown
network outcome; only a definite rejection discards it. Accepted content enters local
history, and accepted commits merge, before saving the next snapshot. A crash in that
window reopens the previous pending operation and uses the server's idempotent receipt.

Web storage uses IndexedDB `hearth-messages-v1`, keyed by public server/account/device
IDs, containing only an encrypted envelope and revision. A strict-durability
read/write transaction compares and increments the revision. Competing tabs fail
closed before upload. Desktop storage uses real bundled SQLCipher with an additional
random database key held only in the OS credential store under
`chat.hearth.message-store.v1`. SHA-256 scope filenames avoid Windows path limits.
Cross-process file locks and an IMMEDIATE SQLCipher transaction enforce the same CAS.
SQLCipher version detection and authenticated page reads occur before mutation;
missing keys, damage, wrong keys and stale revisions preserve existing state.

The Cargo graph pins rusqlite 0.32.1 and libsqlite3-sys 0.30.1 to share SQLx 0.8's native
link identity. That package bundles SQLCipher **4.5.7**, rather than the latest release;
its compatibility/update work remains explicit. The snapshot provides independent
AEAD protection. Vendored OpenSSL currently resolves to 3.6.3. Windows builds require
a complete Perl distribution; a verified portable Strawberry Perl tool was used for
local compilation, with no change to the user's installed Perl.

Storage failure stops delivery and acknowledgements and preserves the previous
snapshot. The current snapshot has an 8 MiB plaintext bound, and text is limited to
16,000 UTF-8 bytes. History pagination/compaction and backup rollback detection are
not implemented. Copying an old encrypted store onto an active install can roll back
ratchets; filesystem/profile compromise is outside this phase's guarantees. Library
provider clones and displayed JavaScript text cannot promise complete memory erasure.

## Text behavior and server visibility

Text, reply IDs and edit text are encrypted application content. Edit/delete targets
and action kinds are public routing metadata; only the original author account can
edit/delete a stored send. Deletes replace server copies of the original and edits
with sequence-preserving redaction markers. Existing recipient copies and backups
cannot be recalled. New-device clients ignore unavailable old edit/delete targets.
Typing is encrypted, does not enter local history and expires from display; server
reads hide it after ten seconds and cleanup redacts its payload.

The server sees accounts, devices, conversation membership, operation/action/target
IDs, epochs, package hashes, ciphertext sizes, sequence numbers and timing. It never
decrypts message content. The threat model inventories these fields. No attachment,
community, removal/revocation, moderation, search, media or federation claim follows
from this slice.

## Acceptance

`node scripts/verify-auth.mjs` exercises actual PostgreSQL, product WASM, native HTTP
and WebSockets: owner races, recovery/linking/invitations, restart persistence,
three-account group DMs, typing, edits/deletes/replies, offline resume, linked-device
new messages, forged gateway proofs and live session revocation. A full data-only
database dump and server logs are scanned for plaintext canaries; gateway frames and
encrypted snapshots are scanned as well. SQL tests cover concurrent claims,
idempotent fan-out, ACLs, signatures, stale epochs and consumed-package upload retries.

The opt-in `phase1-acceptance` desktop feature bundles a separate test entry using the
product AuthCrypto worker, SDK, MessagingSession and native storage commands. A fresh
loopback server and database plus dedicated test credential services isolate its data.
It verifies native identity persistence, SQLCipher CAS/history, offline delivery,
recovery and new-device rekeying. Reports contain boolean checks only, and owned
fixture storage/credentials are cleaned. Normal product builds expose none of its
configuration/report commands or harness assets. This is packaged runtime acceptance,
not a native UI click/permission test or an independent security audit.

Native storage calls hold fixture operation leases through their blocking work. Finish
rejects new calls and waits for existing calls before removing test credentials/files;
an aborted JavaScript promise does not cancel a running native call. A regression test
checks this ordering, and reports distinguish drained calls, credentials and files with
boolean outcomes. Optimized Linux evidence (historical report in Git history)
records all ten independent runs.

Primary references checked 2026-10-07:
[OpenMLS configuration](https://book.openmls.tech/user_manual/group_config.html),
[BasicCredential signer](https://docs.rs/openmls_basic_credential/0.6.0/),
[rusqlite bundled feature documentation](https://github.com/rusqlite/rusqlite),
[SQLCipher key and verification API](https://www.zetetic.net/sqlcipher/sqlcipher-api/).
