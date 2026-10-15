# Progress

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
