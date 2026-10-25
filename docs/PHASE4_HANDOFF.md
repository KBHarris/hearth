# Phase 4 release checkpoint - 2026-10-25

Application source: `df97a1e`. Acceptance source: `eeb4b2a`.
The final complete capacity run `sfu25-audit-complete-2026-10-25` passes all
16 checks with 25 participants and 600 decoded microphone paths. Cleanup,
permission removal, wire privacy (up to 4,521 frames), history filtering and
unchanged request limits pass. Frozen evidence is
`docs/evidence/phase4-release-local-2026-10-25.json` (23 passing reports).
Required npm verification passes, including 151 client tests. Windows/private
media, stage, TURN-TLS, image recovery and packaging evidence is retained there.

The earlier final result had already passed permission removal, but its stage
label stayed stale for a combined cleanup/privacy failure. The acceptance wire
audit arbitrarily failed above 4,096 frames. That ceiling is removed; every
captured frame is checked against every owned key. The new regression also
covers a late-frame disclosure and the never-joined endpoint owning no keys.
Prior failed raw reports remain unchanged. Production media/permission logic
is unchanged from the signed application candidate.

Installed Windows client **0.4.0** is upgraded. Bundle
`target/manual-test/release/guided-df97a1e/VALIDATION.json` passes all 19 checks,
including profile preservation and matching native version/source. Signed assets
are assembled under its `release-assets` directory; their exact allowlist is
`target/phase4-sfu-evidence/prepared-release.json`.

Remaining authorized steps:

1. Commit/push this checkpoint and publish the prepared latest `v0.4.0` assets:
   `node target/phase4-sfu-evidence/publish-validated-release.mjs`.
2. Verify public downloads:
   `node target/phase4-sfu-evidence/verify-public-release.mjs target/manual-test/release/guided-df97a1e/release-assets`.
3. Notify the user before the brief server restart. Run
   `node target/phase4-sfu-evidence/upgrade-selected-host.mjs check`, then `update`,
   then `media`. Redirect each command's output to a local evidence log.
   These invoke the installed native controls, perform the backup/restore
   rehearsal, preserve the original selected host and enable SFU/relay hosting.
4. Run `node target/phase4-sfu-evidence/verify-existing-host.mjs after`, redirecting
   output. Never overwrite `target/phase4-private-state/before.json`.
5. `node target/phase4-sfu-evidence/finalize-public-upgrade-proof.mjs` requires
   passing publication/preservation, matching installed client/server, healthy
   server and running SFU/relay; it writes sanitized publication/upgrade evidence.
6. Update README, latest test guide, progress/roadmap/checklist and this handoff;
   commit/push. No broad test rerun or application rebuild is needed.

Railway and hosted CI remain paused. Spotify remains disabled. Real devices,
independent networks, normal Start-menu saved-sidebar recovery, reboot/clean
installation/fresh-host restore and remaining platform checks are manual gates;
see `docs/PHASE4_RELEASE_CHECKLIST.md`. Local service health proves no public
WSS/TURN-TLS reachability. Do not merge or regenerate user profiles/keys.
