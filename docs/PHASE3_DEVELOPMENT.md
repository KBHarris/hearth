# Phase 3 development

Development branch: `codex/phase3-navigation`. This branch is separate from the
frozen Phase 2 Windows/server bundle and its persistent server data.

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
own directory. Browser validation must finish before changing client source,
regenerating product WASM or running a build that reloads its Vite profiles.

With Docker and private S3 available, also run both acceptance scripts with
`--storage`. Database expiry does not validate physical S3 object deletion.
The scripts use isolated accounts and databases and never target bundle data.

## Remaining Phase 3 work

- Authenticated ownership transfer with pinned root continuity and history compatibility.
- Delegated moderation, kicks and server/user-wide bans, plus the complete endpoint matrix.
- Explicitly disclosed, verifiable encrypted reports and a moderator queue.
- Per-user data export and account deletion.
- Forum channels, encrypted polls and generic Web Push.
- Physical S3 retention acceptance, packaged desktop and hosted platform regressions.

Phase 3 is not complete until its exit criteria pass. The Phase 2 two-person and
50-person/week human tests remain separate, open checkpoints.
