# Phase 3 development

Current development branch: `codex/guided-setup`, published through PR #4's
`codex/phase3-navigation` branch. Hearth Preview 0.3.2 is public; use
[the latest two-PC guide](TWO_PC_LATEST_TEST.md) for hosting and client updates.

The [ordered remaining-work checklist](PHASE3_REMAINING.md) is the current Phase 3
queue. The 50 MB uploads, server-owner file deletion, **Server Members** sidebar,
clickable member profiles, readable invites and desktop hosting/update controls
are implemented. Preview 0.3.2 also guards original host configuration, displays
the installed client version and defaults new hosts to port 8080. The authorized
full hosted acceptance is in progress; two-household and actual OS push gates
were explicitly waived for this preview, rather than recorded as measured passes.

The web client has a persistent server/community/channel sidebar and focused
dialogs for server selection, account recovery, server settings, community settings,
channels, members, search and DMs. Add Server validates discovery before switching;
invalid addresses and changed identities preserve the current chat session.

Community settings → Roles & moderation contains roles, member assignments,
channel overrides, bans/timeouts, slow mode, rules screening, retention and audit.
Channel overrides and role changes are signed by the pinned community owner.
Keep an owner device signed in while channel encryption rotates after changes.
Management remains separate from daily chat. See
[ADR 0013](adr/0013-signed-community-governance.md) for security boundaries and limits.

## Local validation

```powershell
$env:PGBIN='C:\Program Files\PostgreSQL\17\bin'
npm run verify
cargo fmt --all --check
cargo clippy --all-targets --target-dir target/phase3-build -- -D warnings
cargo test --target-dir target/phase3-build
cargo check -p hearth-wasm --target wasm32-unknown-unknown
npm run protocol:check
node scripts/verify-auth.mjs --native-postgres --phase3
node scripts/verify-community-ui.mjs --phase3
```

The separate native target directory avoids overwriting an older executable while
its preview is running. Disposable `--serve` fixtures copy the binary into their
own directory. Isolated CI sets `HEARTH_TEST_TARGET_DIR=target` to reuse its normal
Cargo cache. Browser validation must finish before changing client source,
regenerating product WASM or running a build that reloads its Vite profiles.

With Docker and private S3 available, also run both acceptance scripts with
`--storage`. Database expiry does not validate physical S3 object deletion.
The scripts use isolated accounts and databases and never target bundle data.

### Packaged Windows fixture

Use the installed MSVC Build Tools and a complete Strawberry Perl installation
for vendored OpenSSL; an incomplete Git/MSYS Perl installation may fail.
The acceptance features are fixture-only and do not enable a production test API.
Build the harness before starting browser validation; rebuilding can reload its
Vite profiles.

```powershell
$env:PGBIN='C:\Program Files\PostgreSQL\17\bin'
$env:PERL='C:\Strawberry\perl\bin\perl.exe'
$env:OPENSSL_NO_ASM='1'
$env:HEARTH_PHASE1_HARNESS='1'
npm run build
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --features phase1-acceptance,phase1-storage-test
node scripts/verify-auth.mjs --desktop --native-postgres --phase3 --storage
Remove-Item Env:\HEARTH_PHASE1_HARNESS
```

The private-S3 variant requires running Docker. Its accounts, database, credentials,
files and storage container are disposable. The native report confirms outstanding
storage calls have drained before fixture credentials and files are removed.

## Current Phase 3 implementation

Ownership offers require a currently approved successor device in every channel.
Choose the accepting device explicitly when a member has several; they can compare
its public Device ID in Account & devices. Acceptance requires that exact device.
The outgoing owner signs the exact public authorization digest set, and the successor
explicitly accepts. The owner signing root advances after the HTTP compare-and-swap
succeeds; historical epochs keep their original authorization. A moderation edit after
an offer invalidates it. See [ADR 0014](adr/0014-community-ownership-transfer.md).

Delegated moderators can sign timeouts, bans, kicks and slow mode within their granted
scope. They cannot change roles, rules, retention, owner identity or sanction owners
and peer moderators. INVITE, MANAGE_CHANNELS and MANAGE_ROLES remain reserved;
those operations require the community owner regardless of those bit values.
A kick permanently revokes invitations issued at or before its signed cutoff. Rejoining
requires a fresh signed invitation, owner admission and a fresh MLS Welcome. The
client retains previously readable messages but discards the removed group's keys
before accepting the new Welcome. Persistent kick entries count toward the 128-entry
sanction bound. Bans can be lifted; prior keys and recipient copies cannot be recalled.

Forum channels show posts with titled discussions and explicit replies. Poll questions,
choices, votes and closes travel inside MLS; votes are tied to approved participants,
replace previous votes, and can be withdrawn. Only the author closes a poll. An in-flight
vote received after close is consumed without reopening the poll or stopping delivery.

Reports disclose only the messages and context the reporter explicitly selects, with
signed sender evidence, encrypted for an approved moderator device. The server stores
opaque envelopes and a content-free resolved flag. Another moderator device cannot
open that device's report; reopening the same approved device works after restart.
See [ADR 0015](adr/0015-selected-encrypted-reports.md) for the attribution boundary.

Privacy & blocked people includes private DM blocking and account export. Export pages
contain account-owned metadata and opaque records, never passwords or private keys.
The optional readable-message checkbox adds plaintext from this device only. Large
exports exceeding 100 MiB require paginating the API. Pagination is a live view rather
than a snapshot; pause activity for a consistent manual export. Recovery kits are
separate. Operator bans revoke sessions and live gateways without granting community
key authority.

Browser push is explicit opt-in in a secure supported browser. The fixed notification
is `New activity in Hearth.`; no sender, channel name or plaintext enters the payload.
Native Web Push encryption has independent RFC 8291 vector and VAPID signature tests;
subscription ownership, provider validation, restart and disable are tested over HTTP.
The service-worker test rejects untrusted notification content and external navigation.
Actual provider acceptance and OS notification display still need a manual supported
browser check; local HTTP fixtures do not establish that external delivery works.

Account deletion is implemented and authorized for disposable-fixture testing.
It requires an approved signed request and current session, protects the server
operator and community owners, revokes linked sessions, erases retained authored
ciphertext and pins a public departure before MLS removal. Exact retry is safe after
restart. Files become unavailable immediately and physical cleanup waits for old
upload leases to expire. Received copies, local history and backups remain. See
[ADR 0016](adr/0016-signed-account-departure.md).

## Verification status

The current local HTTP/product-WASM suite passes 90 checks with private S3 on
2026-10-12, including the complete REST permission matrix, every gateway operation,
kick/rejoin, reports, export, push opt-in, blocks, bans and signed account deletion.
Linked-device revocation, late credential-write fencing, restart retry and physical
S3 ciphertext erasure pass. Windows packaged acceptance passes all 17 outcomes with private S3,
including forums, polls, reports, delegation, ownership transfer in both directions,
private blocks, export and account departure. Its native storage calls drain and
fixture credentials/files are removed; the shutdown-barrier regression passes.

The two-client browser/private-S3 workflow passes all 41 checks, including selected
reports, poll closure, exports, blocking, exact deletion confirmation and narrow
layout, with paced setup under the real rate limits. Sanitized dated local
[HTTP/WASM](evidence/phase3-http-private-s3-2026-10-12.json),
[Windows](evidence/phase3-windows-private-s3-2026-10-12.json) and
[browser](evidence/phase3-ui-private-s3-2026-10-12.json) reports are checked in.
GitHub returns `startup_failure` before any jobs start, including
manual dispatch; no cause is available through its API. Current macOS/Linux
packaged acceptance remains pending.

The `e5c99a8` checkpoint passes all twelve hosted jobs in run `38205711382`.
Those older artifacts contain 61 HTTP/WASM and 29 Chrome UI checks and packaged
messaging coverage; they do not validate the newer Phase 3 additions.

Phase 3 is not complete until its exit criteria pass. The current two-person test
and 50-person/week human checkpoint remain open.

## Menu refinements

The composer uses a compact, accessible paperclip button with selected-file removal.
Link cards appear automatically by default and can be disabled in Privacy & blocked
people. Cards use the address itself; no website metadata or images are fetched.
Checkboxes align with their labels, form actions fit their text, and management tabs
wrap without oversized buttons. Community ownership shares the management tab row.
