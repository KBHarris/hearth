# Phase 2 development and the preserved DM test

Started 2026-10-08 on `codex/phase2-communities`, in the attached managed worktree.
The original checkout stays on Phase 1. Its pending two-PC test uses the frozen
`target/manual-test/phase1-43ac92b` folder in that original checkout, including its
versioned client ZIP and digest-pinned server image. Use [the test guide](TWO_PC_DM_TEST.md)
from the original checkout; do not rebuild its server from Phase 2 source.

## First iteration

Implemented authenticated community creation/listing, member-only category/channel
navigation, owner-only structure management, text/announcement channel records and
community invites with expiry and maximum new-member uses. The client creates/joins
communities, manages structure, creates/hides invites and exposes real failure/retry UI.
Community invitations require an existing account on the same server; they are separate
from owner-issued account registration invitations.

## Second iteration, 2026-10-09

Channel IDs now bind to MLS groups. Open a channel to initialize or join its encrypted
conversation. An existing online participant adds newly admitted accounts and approved
devices through signed private commits. Text, replies, edits, deletes, typing and offline
delivery use the Phase 1 encrypted engine/outbox. Only the community owner can publish
announcements; members can decrypt new announcements and help rekey. Messaging startup
failures have a retry control that reopens the preserved encrypted store.

History is `none`: messages sent before a device receives its Welcome are unavailable to
that device, including messages sent while it is waiting after a directory join. Keep an
existing device signed in and wait for the new client's channel status to say **Encrypted**
before testing a message for it. Channels currently have a 128-device bound, and roster
reads reject communities above 128 accounts. No large-channel capacity is verified.

New-account admission currently trusts the server's community directory. A malicious
host could fabricate membership for a valid enrolled identity and induce a future rekey.
Client-verifiable owner admission is the next security gate; fixed-audience DMs still
reject new accounts. See [ADR 0010](adr/0010-encrypted-channels.md). History policies,
attachments and the remaining text features are unfinished.

## Separate development data

Run these commands only in the Phase 2 worktree. Do not copy the original `deploy/.env`,
server keys or data volumes. The development overlay uses project `hearth-phase2`,
backend `127.0.0.1:18088`, independent PostgreSQL/server/storage volumes and client port
5174. It does not start the public HTTPS proxy.

```powershell
node deploy/setup.mjs --init-only
# Set HEARTH_PORT=18088 in this worktree's fresh deploy/.env; keep its new password.
notepad deploy/.env
docker compose -f deploy/compose.yaml -f deploy/compose.development.yaml up -d --build --wait
$env:HEARTH_DEV_SERVER='http://127.0.0.1:18088'
$env:HEARTH_DEV_CLIENT_PORT='5174'
npm run dev -- --host 127.0.0.1
```

Retrieve this separate server's owner code:

```powershell
docker compose -f deploy/compose.yaml -f deploy/compose.development.yaml exec -T server hearth-server --setup-code
```

Use fresh development accounts. A different server signing key scopes the native client
store independently; a separate browser origin scopes IndexedDB independently. Avoid
replacing the installed Phase 1 client while its human test is pending. Development
acceptance runs below use disposable native PostgreSQL clusters, random ports and fresh
server keys instead of either persistent stack.

## Verification

```powershell
npm ci
npm run verify
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test
npm run protocol:check
cargo check -p hearth-wasm --target wasm32-unknown-unknown
$env:PGBIN='C:/Program Files/PostgreSQL/17/bin'
$env:HEARTH_TEST_DATABASE_URL=''
node scripts/verify-auth.mjs --native-postgres
node scripts/verify-community-ui.mjs
```

The HTTP/product-WASM suite passes 38 outcomes, including seven community outcomes:
membership secrecy, category scope/types, no implicit server-owner access, competing
single-use joins, owner controls/expiry, multi-use retries and restart/session revocation.
Eight channel outcomes cover solo initialization/replay, outsider denial and fixed DM
audiences, post-Welcome history, stale epochs, later accounts/devices, announcements,
offline restart and plaintext canaries. The headless Chrome UI check passes nine outcomes
with two isolated browser profiles and real controls: setup/navigation, categories/types,
invitations, solo messages, a real member join and automatic rekey, announcements with
disabled member publishing, directory retry, messaging retry with saved history, and
narrow layout. The outage is deliberately injected in the test profile.
Screenshots and reports are under `target/phase2-evidence`; committed reports are in
`docs/evidence`. The workflow now runs the community/channel UI test on Windows.

The earlier directory implementation `a590d32` passes 11 of 12 hosted jobs in
[run 37870006242](https://github.com/KBHarris/hearth/actions/runs/37870006242), including
HTTP acceptance, macOS/Linux desktop, browser media, Docker and Podman. Packaged Windows
messaging passes, but Windows WebView2 media fails at publisher ICE connection on both
attempts. No media packets flow; this is unresolved and the check has not been weakened.
Those jobs do not validate this new channel slice. Hosted channel validation and
other-platform community UI validation remain pending. The two-house DM test, 50-person
week, admission hardening and remaining Phase 2 exit criteria are not met.
