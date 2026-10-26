# Phase 4 closeout checkpoint - 2026-10-25

**Latest real-use issue:** normal sign-in to 0.4.0 cannot open encrypted messaging.
The saved server is visible. A signed local 0.4.1 diagnostic patch is installed; five profile-preserving
installation checks pass. The actual storage failure is not yet identified or
repaired. The next step requires a normal Windows-menu launch and user sign-in,
then the exact new error text. No broad media rerun or server update is needed. See
`docs/MESSAGING_STARTUP_RECOVERY.md`; preserve original keys, databases and profiles.
The completed release/upgrade checkpoint below does not establish this manual gate.

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
