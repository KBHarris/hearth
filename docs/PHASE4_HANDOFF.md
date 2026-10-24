# Phase 4 release checkpoint - 2026-10-24

Frozen application source: `df97a1e` (full SHA in the candidate manifest).
Latest documentation checkpoint: `ac5a063`. Railway remains paused; Spotify is disabled.
Publication and the installed client/server upgrades are authorized, but neither
has occurred. The installed client remains 0.3.6; the selected existing host is
untouched apart from restarting Docker. Its protected identity/history baseline
still matches. Never overwrite `target/phase4-private-state/before.json`.

## Passing evidence

- Required npm checks: 149 client tests, SDK/deployment tests, types, lint and build.
  Log: `target/phase4-sfu-evidence/npm-final-upload-conflict-utf8-2026-10-24.log`.
- Windows SFU media/TURN-TCP: 20 checks (`native-sfu-final-policy-2026-10-24`).
- Private camera/screen/computer audio/device/MLS recovery: 16 checks
  (`private-media-final-policy-2026-10-24`).
- Complete stage consent/promotion/demotion/revocation: 10 checks
  (`stage-final-bounded-2026-10-24`). Its previous timeout was the test
  controller budget; product watchdogs were not extended.
- Serialized room upload conflict: 11 checks (`sfu-conflict-isolated-2026-10-24`).
  One simulated HTTP 409 after encryption exercises actual Rust outbox rollback,
  fresh verified admission and decoded survivor audio. Forbidden/malformed room
  controls and ordinary chat remain terminal. Periodic key-repeat regression passes.
- Corrected production images: 8 restore/isolation checks; normal assets: 11,
  with test/private canaries absent. Rust source is unchanged since `cb74431`;
  its retained Rust/SQL checks remain applicable.

Raw media results are under `target/direct-calls-evidence/<checkpoint>/`.
The latest complete media/load run at `eb8e7b2` failed permission revocation
because one unaffected survivor treated a rejected HTTP-409 outbox control as
fatal. The fix above is narrowly scoped to that exact rejected upload. That
failed run and its old candidate remain failed/superseded.

## Current final capacity run

`sfu25-isolated-final-2026-10-24` is running alone, with no overlapping builds
or other acceptance fixtures. Source is frozen and assets immutable. A prior
attempt on `df97a1e` failed with a network error during admission 6, before voice;
this fresh attempt has passed that point. Its log is
`target/phase4-sfu-evidence/sfu25-isolated-final-2026-10-24.log`; result will be
`target/direct-calls-evidence/sfu25-isolated-final-2026-10-24/sfu-room-direct/result.json`.
The passive report includes only endpoint state and sanitized network failures.
Do not start another broad rerun this session. If it fails, retain its result
and stop at that clear checkpoint; do not publish or install an unaccepted candidate.

## Ready candidate and remaining sequence

`target/manual-test/release/guided-df97a1e` contains the signed 0.4.0 candidate.
It has no `VALIDATION.json` yet. The `guided-eb8e7b2` candidate is superseded.
Both server/browser images and the signed installer were rebuilt for `df97a1e`.
No further rebuild is needed unless application source changes.

Only after the final capacity result passes every check:

1. Freeze sanitized evidence with
   `node target/phase4-sfu-evidence/freeze-release-evidence.mjs sfu25-isolated-final-2026-10-24`.
   Update/commit the progress, roadmap and checklist; preserve manual/network/platform gates.
2. Notify the user before briefly closing Hearth, then validate and upgrade the
   authorized installed client:
   `node scripts/verify-test-bundle.mjs target/manual-test/release/guided-df97a1e --upgrade-installed --owner-enrollment`.
   This creates the required passing `VALIDATION.json` and preserves real profiles.
3. Prepare signed assets:
   `node scripts/prepare-release.mjs target/manual-test/release/guided-df97a1e`.
   Inspect the explicit allowlist. Push the branch, create regular latest `v0.4.0`
   with the prepared assets and notes file, and verify public downloads using
   `node target/phase4-sfu-evidence/verify-public-release.mjs target/manual-test/release/guided-df97a1e/release-assets`.
   Check release existence before creating; do not overwrite someone else's release.
4. `target/phase4-sfu-evidence/upgrade-selected-host.mjs check|update|media`
   invokes the installed native operator commands. It checks client 0.4.0/source
   `df97a1e`, the original protected host root/project, and uses its actual selected
   managed host. Redirect its output to local evidence logs; inspect only sanitized
   fields before publishing any proof. `update` performs backup/restore rehearsal.
   `media` creates settings only if absent: signal 7880, relay 30000-30099, avoiding
   Windows-reserved default ports. Do not change router/firewall settings.
5. `node target/phase4-sfu-evidence/verify-existing-host.mjs after` must match the
   original protected baseline. Verify actual server image/source/version, media
   services and installed client; publish a separate sanitized upgrade proof.
6. Update README/latest test guide and final roadmap/progress, commit and push.

The user's remaining manual checklist is in `PHASE4_RELEASE_CHECKLIST.md`, including
real devices/screen audio, outside-network relay/WSS reachability, reboot/clean
installation/platform checks and normal Start-menu saved-sidebar recovery.
Codex-launched diagnostics do not establish normal Start-menu profile access.
