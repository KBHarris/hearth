# Phase 4 release checklist

**Isolation update, 2026-10-25:** the final isolated `df97a1e` result actually
records successful targeted permission removal. Its stage label was stale when
the subsequent combined cleanup/privacy assertion failed. The new four-person
isolated-renderer lifecycle check passes all 16 checks, including track cleanup,
key privacy, history filtering and permission removal. The wire audit contained
an unrelated 4,096-frame ceiling that reported failure solely from traffic volume.
The corrected acceptance audit scans every captured frame, requires actual frames
and keys, and has two regressions including a leak in frame 5,000. No production
media, permissions, request limits or watchdogs changed. A fresh complete 25-person
run is still required before publication; old failed evidence remains unchanged.

**Checkpoint confirmed, 2026-10-25:** the final isolated run at `df97a1e`
(`sfu25-isolated-final-2026-10-24`) finished with `outcome: fail` during
`Distributed permission revocation`. Its recorded media/privacy checks are true,
but that does not override the failed overall result. The remaining blocker is
to isolate and resolve this final permission-removal failure, then obtain a passing
complete capacity result. No new release or installed client/server upgrade has
occurred. No additional test run was started for this status check.

The user authorized completion of nonmanual Phase 4 work, then publication and
upgrades of their existing client/server on 2026-10-23. Release and upgrade are
pending. Railway remains paused. Local evidence must not be presented as an
outside-network, clean-machine, or cross-platform pass.

Latest complete 25-person checkpoint (`eb8e7b2`, 2026-10-24) fails targeted
permission revocation despite passing voice/video/computer audio, measured load,
wrong-key rejection and leave/rekey. The isolated native SFU/TURN-TCP pair and
complete Windows media repeat now pass 10/20 checks. Private-call signaling
order is corrected: two timing
regressions and a focused 15-check real MLS/six-audio-path epoch test pass. The
combined private media/device/MLS recovery now passes 16 checks. The complete
release gates remain pending. On 2026-10-24,
the three-person permission-removal case passes all 10 checks after guarding
fresh policy against its preceding MLS epoch; the full 25-person repeat remains
required. Full Windows/private media and stage gates pass 20/16/10 checks.
All npm checks pass, including 149 client tests. Final binaries
must be rebuilt from the accepted source before publication.
The latest remaining survivor failure was isolated to an already-serialized room
control rejected with HTTP 409. Exact-upload rollback now requests fresh verified
admission; forbidden/malformed controls and ordinary chat remain terminal. The
forced-conflict MLS/audio case passes 11 checks. The `eb8e7b2` bundle is superseded
and has neither validation nor publication approval from a passing capacity run.


- [ ] Stable 25-person SFU voice plus screen/computer audio; record upload,
  recipient traffic, fixture CPU and actual encrypted packet/privacy evidence.
- [x] Independent media permission enforcement in Rust, server, client, SFU
  tokens and encrypted receive/publication paths; stage speaker/audience consent.
- [x] Device switching and microphone/speaker controls, including late grants,
  cancellation, changed permissions, mute preservation and capture cleanup.
- [x] Community and private-group MLS recovery and bounded network reconnect,
  preserving selected devices and stopping every unauthorized/obsolete sender.
- [x] Complete private-call media features and automated regressions.
- [x] Events, authenticated RSVP, synchronized playback, provider opt-in and
  isolated provider execution; verify native IPC cannot be reached by frames.
- [x] TURN-TLS acceptance and packaged media/TLS configuration; include media
  settings and provider credentials in protected backup/restore/update handling.
- [x] Guided host/release packaging, WSS routing, optional browser hosting and
  cloud recovery procedures. Keep live Railway application paused.
- [x] Normal production build excludes acceptance entries and private material.
  Run required npm, Rust, protocol, WASM and desktop checks on final source.
- [ ] Freeze final sanitized evidence and update roadmap/progress accurately.
- [ ] Prepare and sign the new client/server release, publish its complete
  catalogs/assets, verify downloads/signatures and source revision.
- [ ] Back up and rehearse restoration of the selected existing host; upgrade
  its server and installed Windows client; verify identity, accounts, encrypted
  history/objects, saved sidebar entry and matching installed versions.

## User's manual acceptance

1. Test real microphone, speakers/headphones, mute/deafen, device changes, camera,
   and simultaneous screen sharing. Explicitly include PC/tab audio and confirm
   microphone mute leaves that audio alone; stopping sharing must stop its audio.
2. Join/leave a voice room without ringing or ending the room for everyone.
   Promote/demote stage speakers; promotion must require their own speaking click.
3. Test two households, restrictive networks, direct and relay-only routes,
   outages/rejoin, and real public WSS/TURN-TLS reachability. Local health does
   not establish outside reachability or a correct firewall/router configuration.
4. Verify provider playback with real availability/account/autoplay rules and
   clock skew. Each participant must opt in; revoking consent removes the player.
5. Exercise clean installation, reboot/sign-in hosting, fresh-host restore and
   the remaining macOS/Linux/browser platform matrix. The Windows upgrade does
   not establish those results. Linux's browser fallback remains explicit.
6. Close and reopen Hearth using the normal Windows Start-menu shortcut and
   confirm the saved server remains in the sidebar. Codex-launched diagnostics
   and an isolated WebView profile do not establish normal Windows profile access.

Live Railway provisioning and hosted CI stay on hold until separately requested.
