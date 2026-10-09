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

This is community setup. Channel MLS groups, encrypted channel messaging, rekeying,
history policies, attachments and the remaining text features are not implemented yet.
Direct messages still use the Phase 1 encrypted delivery path. The next iteration is
channel-to-MLS binding and authenticated roster synchronization, with an explicit
no-history default until the history policies are implemented and tested.

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

The HTTP/product-WASM suite passes 30 outcomes, including seven community outcomes:
membership secrecy, category scope/types, no implicit server-owner access, competing
single-use joins, owner controls/expiry, multi-use retries and restart/session revocation.
The headless Chrome UI check passes five outcomes with real clicks and a fresh browser
profile: creation/navigation, category/channel management, invitation handling,
outage/retry and narrow layout. The outage is deliberately injected in the test profile.
Screenshots and reports are under `target/phase2-evidence`; committed reports are in
`docs/evidence`. This is local Windows validation; hosted Phase 2 CI and other-platform
community UI validation remain pending. The 50-person/week and remaining Phase 2 exit
criteria are not met.
