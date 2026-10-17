# Progress

Preview closeout update, 2026-10-16: the user waived the real two-household and
provider/OS notification gates for this preview and authorized one full hosted
cross-platform pass after fixing the host configuration mismatch. These waivers
are not measured passes. The startup fix rejects missing original configuration
when persistent Docker data exists and verifies database credentials through the
service network before starting Hearth. Existing files, data and passwords stay
intact on failure. The real Docker regression passes nine outcomes, including
missing files, wrong credentials, successful retry and migration rollback. The
client header also displays its version; desktop reads the installed native
version, and browser builds use the Preview build version. New Preview host
packages use local port 8080 at the user's request. Host controls read existing
port overrides from .env, retaining compatibility with older packages and custom
ports; startup failures identify the configured port as a possible conflict.
Preview 0.3.2 passes [13 package/upgrade checks](evidence/windows-preview-0.3.2-2026-10-16.json)
and is installed locally. The user's current host was moved from 8183 to 8080
after they authorized closing the conflicting Open WebUI app. Its credentials,
data and identity were preserved; the client now uses the new local address.
The [0.3.2 release](https://github.com/KBHarris/hearth/releases/tag/v0.3.2) is public.
All eleven anonymous downloads match the tested files, the distribution secret
scan has no findings, and both live Preview update feeds resolve to 0.3.2. The
installed native updater confirms the app is current and offers the signed 0.3.2
server update. See the [publication record](evidence/preview-0.3.2-release-2026-10-16.json).
The authorized [full hosted run](https://github.com/KBHarris/hearth/actions/runs/38999371729)
is in progress against frozen source `96548d8`; Phase 3 closeout remains pending.

Current implementation pass, 2026-10-16: 50 MB encrypted files, server-owner file
removal, authorized member sidebar/profile fingerprints, encrypted 32-character
invite relays, desktop hosting controls and signed app/server updates are in
source and the tested Windows Preview 0.3.1 package. Local checks include
94 real HTTP/private-S3 outcomes, 51 broad two-client UI outcomes, 13 focused
readable-account-code outcomes, six Docker host/failed-migration rollback outcomes
and three signed host-package integrity outcomes. The Windows packaged suite
passes 19 outcomes, including an exact 50 MB encrypted transfer and owner removal.
The [sanitized local record](evidence/phase3-local-2026-10-16.json) captures these
results and their dates. The publication audit completed
and the repository is public. Native invite opening advances the Host/Join checkpoint.
All [19 installer/package checks](evidence/windows-preview-2026-10-16.json) pass,
including OS invite association, cold/warm handoff, native Start/Stop/setup-code
controls, all 23 migrations and private storage. The old local install/profile
were backed up and replaced with Preview; the new host package is selected for
local testing. No hosted Actions were dispatched. Following explicit approval,
[Preview 0.3.1 was published](https://github.com/KBHarris/hearth/releases/tag/v0.3.1)
on October 16. All eleven anonymous asset downloads match the tested hashes, and
both Preview update feeds resolve to 0.3.1. See the
[publication verification](evidence/preview-release-2026-10-16.json).

The [ordered checklist](PHASE3_REMAINING.md) records the two explicit preview
waivers and the remaining authorized cross-platform acceptance. Runtime prerequisite installation, independent external
reachability, fresh-host restore and clean-machine setup remain open checkpoint
work. Historical results below do not close these gates for the new build.

Phase 4 scope expanded on 2026-10-16 to include Railway native IaC, guided cloud
provisioning, configurable private S3 storage and optional production browser
hosting. It also explicitly includes direct P2P media, TURN fallback, relay-only
privacy and LiveKit for larger rooms, with separately hosted media where needed.
See [the Phase 4 hosting and media plan](PHASE4_HOSTING_AND_MEDIA.md) for work order
and acceptance. These are planning additions; no Railway deployment, browser
hosting or product media implementation is claimed. Phase 3 and the local
Host/Join installer checkpoint retain their existing acceptance requirements.

Actions policy was corrected on 2026-10-15 to prioritize the user's budget:
[local-first, manual-only hosted CI](CI_STANDARD.md). The default `checks` tier
uses one Linux job; explicitly requested `core` and `full` tiers select broader
acceptance. There are no push, PR, tag, merge-group or scheduled triggers.
Expensive platform matrices wait for Linux acceptance, fail fast, and use one-day
artifacts. Linux packaged acceptance runs once instead of ten repetitions.
The earlier blanket full-suite/merge-gate requirement has been superseded.
The workflow and policy changes remain local until pushed/merged. No hosted
workflow was dispatched and no billing settings were changed. Local validation
does not establish a successful hosted run or measured monetary savings.
The existing 0.3.0 package is unchanged.
Local actionlint/ShellCheck, the budget policy and all eleven suite-result tests
pass. Ten budget-breaking workflow mutations were rejected locally.

Phase 3 scope was updated on 2026-10-15. The [ordered remaining-work checklist](PHASE3_REMAINING.md)
adds 50 MB uploads, server-owner file deletion, a **Server Members** sidebar and
clickable fingerprint/profile modals before the remaining validation gates.
These are planning additions; the current 0.3.0 package has not changed.

The latest two-PC Windows package is ready (2026-10-15):
`target/manual-test/guided-efd4af6/Hearth_Test_efd4af6_Windows_x64.zip` is the
friend-only installer/guide/checksum ZIP. Both PCs install Hearth Test 0.3.0;
the matching host folder contains a pinned server archive and fresh
`hearth-guided-test` deployment on backend 8183/S3 18335. Old test bundles, server
data and profiles were retired on 2026-10-15.
[Fifteen local package checks](evidence/windows-buddy-bundle-2026-10-15.json)
pass, including real NSIS installation, the production WebView2 Host/Join screen,
native version/profile/IPC, latest input guard, bundled-server discovery through
owner setup, all 21 migrations, private S3, identity-preserving restart, HTTPS
configuration and temporary-install cleanup. Native account creation and actual
two-house reachability/messaging remain human acceptance. Follow
[the latest two-PC guide](TWO_PC_LATEST_TEST.md); send only the friend ZIP.

Guided Host/Join setup is in its first implementation pass on
`codex/guided-setup` (2026-10-15). Fresh clients choose Host or Join, inspect a real
server and explicitly confirm before changing servers. Invites carry an origin,
public identity and account/community capabilities without saving those secrets.
The account/device and signed community admission flows remain in force.
Host currently connects an existing deployment; automatic service installation,
native invite handling and independent outside reachability remain open. See
[the guided setup development notes](GUIDED_SETUP.md) for scope and remaining work.
The [dated setup record](evidence/guided-setup-2026-10-15.json) records 46 broad
two-client/private-S3 browser checks followed by 12 final guided-join checks and
seven mock-response failure/cancellation checks. Final npm verification passes
38 tests, typecheck, lint and production build using the existing Phase 3 WASM.
Rust fmt/clippy and 34 default tests pass; four PostgreSQL integration tests remain
ignored by the default Rust command. Windows installed-product smoke acceptance is
recorded above; clean-machine and current macOS/Linux packaging remain open.

The Phase 3 foundation has local validation dated 2026-10-12.
The local HTTP/product-WASM suite passes 90 checks with private S3, including
valid and rejected access across the complete REST inventory and every gateway
operation. Signed account deletion revokes linked sessions, fences late credential
writes, survives restart retries and physically erases retained file ciphertext.
The packaged Windows client passes 17 checks with private S3, including the full Phase 3 workflow
and native SQLCipher/credential cleanup. The native shutdown-barrier regression passes.

The second menu pass includes compact actions, aligned checkboxes, paperclip
attachments, automatic address-derived link cards with an off setting, clear
permission rows, useful empty states and explicit ownership device selection.
Successor-authority ordering and opening a newly created encrypted channel are
fixed. The sidebar now refreshes channel changes from another device without
resetting open management forms. All 41 two-client browser/private-S3 checks pass,
including ownership in both directions, selected reports, polls, account privacy,
exact deletion confirmation and narrow layout. Automated setup stays within the
real server rate limits. Sanitized local evidence is saved for
[HTTP/WASM](evidence/phase3-http-private-s3-2026-10-12.json),
[Windows](evidence/phase3-windows-private-s3-2026-10-12.json) and
[browser controls](evidence/phase3-ui-private-s3-2026-10-12.json).
[Haven parity and setup requirements](HAVEN_PARITY_AND_SETUP.md) now define a guided
Host/Join installation checkpoint before media expansion.
The 2026-10-12 hosted attempts returned `startup_failure` before any job started.
Current macOS/Linux packaged validation remains pending.

## Test workspace cleanup (2026-10-15)

Superseded Phase 1/2 packages, disposable server fixtures, old operator configuration,
ten unused Docker server volumes, nine old image tags, three legacy Windows profiles
and nine saved test credentials were removed at the operator's request. Old staging
guides, bundle scripts and dated reports were retired. Architecture decisions and
reusable acceptance tools remain in source; earlier reports remain in Git history.
The current 0.3.0 bundle and its pinned server image are preserved. All 17 bundle
files retained their SHA-256 hashes across cleanup. New testing starts with fresh
accounts and server data using the latest guide above.

Cleanup validation passes: all local Markdown links resolve, retired paths are
absent, and all 13 manifest checksums match. `npm run verify` passes with local
networking enabled (the sandbox blocked its disposable HTTP fixtures). Rust
fmt/clippy and 34 tests pass, with four PostgreSQL tests ignored by default.
