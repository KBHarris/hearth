# Phase 4 closeout checkpoint - 2026-10-27

**Current installed state:** Preview 0.4.3 is published and installed on the
Windows client and original selected server, from frozen source `e462db9`.
https://github.com/KBHarris/hearth/releases/tag/v0.4.3

The user closed Hearth before installation. All 16 packaged upgrade checks pass;
all 14 public assets match the validated signed bundle. The native server update
completed backup/restore rehearsal and applied migration 32. Fresh before/after
comparison confirms operator credentials, signing/OPAQUE keys, accounts/devices,
durable encrypted history and storage are preserved. Native profile and host
selection checks pass. The actual installed client bytes match the frozen build
with the verified NSIS marker substitution. Server is healthy; SFU/relay run.
See `docs/evidence/preview-0.4.3-publication-upgrade-2026-10-27.json`.

Deletion controls have six passing real-browser checks, three isolated database
checks (including concurrent access/deletion and account ownership), 159 client,
49 SDK, 15 deployment and 17 server unit tests, plus server clippy/format. See
`docs/COMMUNITY_MANAGEMENT.md`. Category deletion keeps channels; channel/community
deletion revokes access while retaining encrypted content and identifiers. No
installed user community/channel was deleted during validation. The client is
closed after diagnostic checks; normal Start-menu launch/sign-in and physical
device/network/platform acceptance remain manual.

The validated bundle is `target/manual-test/release/guided-e462db9`. Version-scoped
helpers/evidence remain under ignored `target/phase4-sfu-evidence/*deletion*`.
Never overwrite `target/phase4-private-state/before-deletion-0.4.3.json` or the
earlier 0.4.0 baseline. Railway/hosted CI remain paused; Spotify remains disabled.
No further rebuild or broad 25-person media run is required for this patch.

## Earlier recovery and 0.4.0 checkpoints (2026-10-25)

The following records retain their original historical scope.

**Latest real-use result:** the user confirms normal-profile recovery works in
local 0.4.2. The reported missing-history startup issue is resolved by user
acceptance; see `docs/evidence/windows-history-recovery-user-acceptance-2026-10-25.json`.
Recovery saves the verified history in the normal profile using the existing key;
it is a one-time repair, not a normal launch step. Repeat launches and reboot
have not yet been observed. Existing broader media/network/platform manual gates
remain open. At that recovery checkpoint the published release/server were
0.4.0 and the local client was 0.4.2.

**Local automated release work is complete.** Preview 0.4.0 is published:
https://github.com/KBHarris/hearth/releases/tag/v0.4.0

- Frozen application source: `df97a1e`; acceptance source: `eeb4b2a`.
- Complete 25-person SFU run: all 16 checks pass, including 600 directed decoded
  audio paths, camera/screen/computer audio, load, wrong-key observer, membership
  changes, targeted permission removal, track cleanup and unchanged request limits.
- The acceptance audit now scans every captured frame (up to 4,521) rather than
  treating traffic above 4,096 as a privacy failure. A never-joined device owning
  no publisher keys is supported. Both regressions pass; prior failed reports
  remain unchanged. No production permission/media watchdog was relaxed.
- Required npm verification: 151 client tests plus SDK/deployment/type/lint/build
  checks pass. Windows/private/stage/TURN-TLS/image/packaging evidence is retained.
- Frozen sanitized local evidence: `docs/evidence/phase4-release-local-2026-10-25.json`
  (23 passing reports). Actual bundle/Windows upgrade validation: 19 checks pass.
- All 14 published assets download with matching checksums, including signed
  catalogs and installer. Public latest server catalog reports 0.4.0/source df97a1e.
- Actual installed Windows client and selected existing server: **0.4.0**.
  Native source/version match. Client bytes match the frozen binary with only
  Tauri's verified `UNK` to `NSS` installer-marker substitution.
- The signed server update completed backup/restore rehearsal. Protected baseline
  comparison passes for original operator credentials, signing/OPAQUE keys,
  accounts/devices, durable encrypted history/objects and storage image.
- The selected server is healthy; SFU and relay services are running. Local media
  settings avoid Windows-reserved relay ports. No router/firewall rule was changed.
- Sanitized actual publication/upgrade proof:
  `docs/evidence/preview-0.4.0-publication-upgrade-2026-10-25.json`.

**No further broad acceptance run or rebuild is needed for this release.** The
user's remaining device/network/platform/Start-menu checks are in
`docs/PHASE4_RELEASE_CHECKLIST.md` and `docs/TWO_PC_LATEST_TEST.md`. Start Hearth
normally from the Windows menu to test the real saved-server sidebar; isolated
Codex/WebView diagnostics do not prove normal profile access. Never merge or
regenerate user profiles/keys to make that test pass.

Railway and hosted CI remain paused. Spotify is disabled. Real two-household
WSS/TURN-TLS reachability, physical device capture/output, clean installation,
reboot/fresh-host restore and remaining platform gates are not established by
local automated checks. The full hosted/platform Phase 4 exit remains open.

Private raw operator results and the immutable original preservation baseline
are under ignored `target/phase4-*`; never publish those private files or overwrite
`target/phase4-private-state/before.json`. The signed release bundle remains
`target/manual-test/release/guided-df97a1e`.
