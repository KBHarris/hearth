# Phase 4 release checklist

The user authorized completion of nonmanual Phase 4 work, then publication and
upgrades of their existing client/server on 2026-10-23. Release and upgrade are
pending. Railway remains paused. Local evidence must not be presented as an
outside-network, clean-machine, or cross-platform pass.

- [ ] Stable 25-person SFU voice plus screen/computer audio; record upload,
  recipient traffic, fixture CPU and actual encrypted packet/privacy evidence.
- [ ] Independent media permission enforcement in Rust, server, client, SFU
  tokens and encrypted receive/publication paths; stage speaker/audience consent.
- [ ] Device switching and microphone/speaker controls, including late grants,
  cancellation, changed permissions, mute preservation and capture cleanup.
- [ ] Community and private-group MLS recovery and bounded network reconnect,
  preserving selected devices and stopping every unauthorized/obsolete sender.
- [ ] Complete private-call media features and automated regressions.
- [ ] Events, authenticated RSVP, synchronized playback, provider opt-in and
  isolated provider execution; verify native IPC cannot be reached by frames.
- [ ] TURN-TLS acceptance and packaged media/TLS configuration; include media
  settings and provider credentials in protected backup/restore/update handling.
- [ ] Guided host/release packaging, WSS routing, optional browser hosting and
  cloud recovery procedures. Keep live Railway application paused.
- [ ] Normal production build excludes acceptance entries and private material.
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

Live Railway provisioning and hosted CI stay on hold until separately requested.
