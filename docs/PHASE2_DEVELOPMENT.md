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

## Current development, 2026-10-09

Owner-signed roots, account admissions and channel policies are verified by clients.
Joining the directory leaves a new identity pending until the owner compares its fingerprint
and approves it. Signed invites rotate epochs first and pin history cutoffs on the joining
client. Keep an existing owner device online for admission and history handoff. See
[ADR 0011](adr/0011-owner-signed-channel-admission.md) and
[ADR 0012](adr/0012-signed-history-and-encrypted-files.md).

Choose New messages only, Since invitation or Full retained history in a channel. Backfill
is explicit and device-bound. Messages predating archive enablement cannot be restored;
previously shared keys/plaintext cannot be recalled. Retained archive keys deliberately
reduce retrospective forward secrecy. Ordinary-member linked devices inherit the account
cutoff. Channels remain bounded to 128 devices; the 1k synthetic benchmark is separate.

The text layer includes reactions, owner pins, threads, safe Markdown, mentions, explicit
read markers, encrypted profiles/expiring presence, sender-written link previews and local
full-text search. No query or preview metadata request goes to the host. Raster custom emoji
are encrypted channel assets published by the owner; republish after new members join.

Encrypted files use local random keys and authenticated chunks, with optional locally
created encrypted thumbnails. Files are limited to 8 MiB. Private S3 URLs expire after five
minutes. The host sees IDs, encrypted lengths/digests and routing metadata, never filenames,
MIME, thumbnails, keys or file plaintext. Bootstrap creates private S3 credentials without
replacing matching secrets; do not copy these host files into a friend ZIP. Ready file
retention/deletion remains Phase 3 work. Windows packaged WebView2 acceptance passes ten checks, including real encrypted file
upload/download, history handoff, reactions and local search. Human testing and hosted validation of this expanded
slice are still pending.

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
node scripts/verify-auth.mjs --native-postgres --storage
node scripts/verify-community-ui.mjs --storage
```

The expanded HTTP/product-WASM suite passes 49 outcomes with authenticated disposable
S3 storage. History, files, encrypted thumbnails and custom emoji include adversarial
scope/tamper/restart checks and host canary scans. The earlier 42-outcome text slice also
passed 13 Chrome UI checks; all 18 expanded Chrome UI checks now pass, including real file downloads, custom emoji,
signed history handoff and profile/presence/embed controls.
Reports/screenshots are under `target/phase2-evidence`; committed evidence is in
`docs/evidence`. Existing hosted implementation `7f8aed2` passes all 12 jobs in
[run 37890119377](https://github.com/KBHarris/hearth/actions/runs/37890119377). New changes
have not yet been submitted to hosted CI. Two-house reachability and a 50-person community
running for a week remain human gates. A versioned replacement bundle follows validation;
only then will old Phase 1 bundle files be removed, preserving running server data.
