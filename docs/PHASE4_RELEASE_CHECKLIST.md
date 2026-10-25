# Phase 4 release checklist

The complete local capacity gate passed on 2026-10-25: 25 participants and all
16 checks, including final permission removal, track cleanup and full wire audit.
Application source is `df97a1e`; acceptance source is `eeb4b2a`.
[Sanitized evidence](evidence/phase4-release-local-2026-10-25.json) freezes 23
passing reports. Required npm verification passes with 151 client tests. Prior
failed results remain failed; the arbitrary wire-frame ceiling and never-joined
audit assertion were corrected in test code without changing production media.
The Windows client is upgraded to 0.4.0; all 19 bundle/upgrade checks pass.
Preview 0.4.0 is published; all 14 public downloads match the signed bundle.
The original server is upgraded to 0.4.0 and healthy, with SFU/relay running.
Its backup/restore rehearsal and protected identity/history comparison pass.
[Publication and upgrade proof](evidence/preview-0.4.0-publication-upgrade-2026-10-25.json).
The local automated release work is complete. Railway and hosted CI stay on hold;
Spotify remains disabled. The manual gates below remain open.

- [x] Stable 25-person SFU voice plus screen/computer audio; record upload,
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
- [x] Freeze final sanitized evidence and update roadmap/progress accurately.
- [x] Prepare and sign the new client/server release, publish its complete
  catalogs/assets, verify downloads/signatures and source revision.
- [x] Back up and rehearse restoration of the selected existing host; upgrade
  its server and installed Windows client; verify identity, accounts, encrypted
  history/objects, protected host selection/profile files and matching installed
  versions. Normal Start-menu sidebar recovery remains manual item 6 below.

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
