# Hearth Build Roadmap

The architecture and the reasoning behind it are in [PLAN.md](../PLAN.md). Each phase ends in
something usable and demoable. A phase isn't done until its **exit criteria** pass in CI.
The [Actions budget standard](CI_STANDARD.md) applies throughout: local checks first,
manual-only hosted runs and full platform acceptance at requested milestones.

```
P0 Foundations ─► P1 Encrypted DMs ─► P2 Communities ─► P3 Governance ─┬─► Host/Join setup ─► P4 Cloud hosting + Voice/Video
                                                                      └─► P5 Federation ─► P6 Bots & Ops ─► P7 Release
```

Prioritize the Host/Join setup checkpoint after P3. Federation is a later opt-in
capability; it is not required for friends to join one server. P4 and P5 can run
in parallel once P3's permission model is stable and the setup checkpoint passes.
[Haven parity and setup requirements](HAVEN_PARITY_AND_SETUP.md) track the requested
feature coverage without changing the all-message E2EE requirement.

---

## Phase 0: Foundations and spikes

**Goal:** a repo that builds everywhere, and answers to the three riskiest questions.

Current progress (2026-10-07): the monorepo and build scaffold exist. The web client now
supports server selection, validated public discovery, health and protocol checks, setup
readiness, retry, cancellation, and remembering a working address. SDK integration tests
and server discovery tests run in the standard npm and Cargo checks. Local Rust/WASM checks,
the web build, a Windows desktop build, and browser connection to a real PostgreSQL-backed
server have passed. Rust-to-TypeScript generation and drift checks are complete. The MLS
scenario passes natively, in Node/browser WASM, and through a headless Windows Tauri
executable; [ADR 0002](adr/0002-mls-feasibility.md) records the receive-transaction finding
and production integration gates. Fresh Compose startup, migrations, storage reachability,
and restart persistence pass. The OPAQUE WASM/native-process spike passes registration,
login, and adversarial checks; [ADR 0003](adr/0003-opaque-feasibility.md) records its scope.
The synthetic LiveKit media harness passes in Windows in-app Chromium, including wrong-key
and stale-key rejection; [ADR 0004](adr/0004-media-feasibility.md) records the measured scope.
Hosted Rust, web, crypto WASM, Docker Compose, Podman, Chrome, Safari, and Linux desktop
checks pass, as does Firefox. Linux media requires a supported browser because the tested WebKitGTK lacks
WebRTC/encoded transforms. Native WKWebView and hosted Windows WebView2 also pass.
Phase 0 is complete: all 11 final CI checks pass and the spike ADRs were merged in
[PR #1](https://github.com/KBHarris/hearth/pull/1) on 2026-10-07. See [PROGRESS.md](PROGRESS.md)
for dated evidence. This is not an encrypted chat implementation.

- [x] Set up the monorepo: Cargo workspace (`hearth-proto`, `hearth-crypto`,
  `hearth-client-core`, `hearth-wasm`, `hearth-server`), the React client, the Tauri shell,
  and the TS SDK package.
- [x] Set up CI: fmt, clippy, cargo tests, the `wasm32` build, TS typecheck/lint/build, and a
  Tauri build matrix (Windows, macOS, Linux).
- [x] Add the Compose stack: Postgres, SeaweedFS (S3), `hearth-server`, with a healthcheck.
  Fresh local Docker build/start and restart validation pass; hosted Docker and Podman pass.
- [x] Serve `/health` and `/.well-known/hearth` from the server. Add sqlx migrations.
- [x] Set up protocol type generation (Rust → TS) so that client types never drift.
- [x] **Spike A, OpenMLS in WASM and in Tauri:** create a group, add a member, and
  encrypt/decrypt in both builds.
  Native/Node/browser WASM and Windows/macOS/Linux headless and webview IPC scenarios pass.
- [x] **Spike B, E2EE media per platform:** LiveKit + encoded transforms in WebView2, WKWebView,
  WebKitGTK, and Chrome/Firefox/Safari. Record the results in an ADR and pick the Linux
  strategy.
  Local WebView2 and hosted Chrome/Firefox/Safari audio/video and key-rotation checks pass.
  Hosted WebView2 and WKWebView pass. Linux WebKitGTK blocks media and requires a
  supported browser; the optional custom-runtime experiment is not a release dependency.
- [x] **Spike C, OPAQUE:** registration and login round trip, with the client in WASM and the
  server in Rust.
  Local WASM/native-process scenario passes; product authentication follows in Phase 1.
- [x] Draft the first threat model: assets, adversaries, and the metadata inventory.

**Exit:** `docker compose up` gives a healthy server. The desktop and web shells both load
and call `/health`. The spike ADRs are merged.

## Phase 1: Identity and encrypted direct messages (first vertical slice)

**Goal:** two people on one server can exchange E2EE DMs from the desktop app or the
browser.

Complete, 2026-10-08. All twelve hosted jobs pass for implementation `43ac92b` in
[run 37811808453](https://github.com/KBHarris/hearth/actions/runs/37811808453).
The real HTTP/product-WASM suite passes 23 outcomes, including existing credential/vault
compatibility across build profiles. Packaged Windows/macOS/Linux webviews pass all seven
messaging outcomes; Linux passes ten isolated repetitions. SQLCipher and OS-store checks,
browser media regressions, Docker and Podman pass. [ADR 0008](adr/0008-encrypted-direct-messages.md)
records the slice's scope and limits. Historical release reports are available in
Git history. Current manual testing uses [the latest two-PC guide](TWO_PC_LATEST_TEST.md)
and fresh server data; older test deployments and profiles have been retired.

- [x] Guided first-run owner creation, closed registration, OPAQUE owner login/logout,
  and PostgreSQL sessions. Test concurrent claims, replay, expiry, restart and revocation.
- [x] Account identity, cross-signed first-device registration and encrypted local key vault;
  preserve existing keys and warn on roster changes. Local browser/Windows storage checks pass.
- [x] Passphrase-encrypted recovery kit export/restore and an approved-device link code.
- [x] Second-account registration through single-use owner invitations; configure name and registration mode.
- [x] Native packaged auth and OS credential stores; hosted Windows/macOS/Linux pass.
- [x] Authenticated MLS delivery and durable encrypted messaging; local acceptance passes.
- [x] DMs/group DMs with text, replies, edits, deletes, typing and offline backlog.
- [x] All Phase 1 exit criteria verified by hosted CI.

- Accounts: OPAQUE register/login, sessions, and device registration.
- Identity: the user identity key, cross-signed device keys, and key-change warnings in the
  UI.
- Device linking by QR code or short code, and a recovery kit that can be exported and
  restored.
- KeyPackage upload and claim, and the MLS delivery service (commit ordering and message
  fan-out).
- The WebSocket gateway: auth, heartbeats, resume, and ordered delivery with an offline
  backlog.
- DMs and group DMs, including text, edits, deletes, replies, and typing.
- Local store: SQLCipher on desktop and encrypted IndexedDB on the web.
- Admin first-run setup: create the owner, set the server name, and configure registration
  mode.

**Exit:** the canary test passes (no plaintext anywhere on the server). A new device reads
new messages after linking. A restore from the recovery kit works. Offline delivery works.

## Phase 2: Communities and the text layer

**Goal:** a usable Discord-like text community.

Implementation and automated validation are complete for `7cc8852`, 2026-10-09.
All twelve hosted jobs pass in [run 37925276507](https://github.com/KBHarris/hearth/actions/runs/37925276507),
including Windows/macOS/Linux native acceptance, ten isolated Linux repetitions, private
S3/HTTP checks, Docker, Podman, Rust, web/WASM and browser media regressions.
The local suite passes 49 HTTP/WASM, 18 Chrome UI and ten packaged Windows checks;
hosted Windows UI passes 16 checks (files also have local UI/native and hosted HTTP evidence).
Owner-signed admission, signed history policies, encrypted files/thumbnails/custom emoji,
reactions/pins/threads, Markdown/mentions/read state, profiles/presence/embeds and local
search are implemented. [ADR 0012](adr/0012-signed-history-and-encrypted-files.md)
records scope and limits.

The Phase 2 staging bundle has been superseded by Hearth Test 0.3.0. Follow
[the current two-PC guide](TWO_PC_LATEST_TEST.md). Clean buddy-PC installation,
two-house reachability and the separate 50-person/week exit criterion remain open.

- [x] Communities, categories, text/announcement channel records and invites (expiry, max uses).
- [x] MLS group per channel, server-authorized roster sync and online rekey agent (128-device initial bound).
- [x] Client-verifiable owner authorization for new account admission; signed policies and pinned owner identities (first contact requires fingerprint comparison).
- [x] History policies (`none`, `since-invite`, `full`) and wrapped epoch-key handoff (native and HTTP/WASM policy/tamper/restart checks pass).
- [x] Encrypted attachments via presigned S3 upload, with local thumbnails (real private S3, tamper/scope/restart and host canary and Chrome UI checks pass).
- [x] Reactions and pins (native, HTTP/WASM, local and hosted UI checks pass).
- [x] Threads, Markdown, custom emoji, mentions and read state (expanded 18-outcome Chrome UI suite passes).
- [x] Profiles, presence and client-generated link embeds (encrypted state and expanded Chrome UI checks pass).
- [x] Local full-text search (case/token matching, deletion and absence of host search requests checked).
- [x] MLS load benchmark (1k synthetic members: rotation median 11.47 ms, p95 12.52 ms; product limit remains 128 devices).
- [x] Versioned Phase 2 Windows client/server test bundle and two-PC guide (`7cc8852`, eight bundle checks pass); old bundle files removed after validation.
- [ ] Human exit test: a 50-person community runs for a week (automated history/attachment policy and canary checks pass).

**Exit:** a 50-person test community runs for a week. History policy tests pass. The
attachment canary passes.

## Phase 3: Governance and moderation

**Goal:** communities can govern themselves safely, with clear member discovery
and practical file controls.

**Phase 3 preview is complete, 2026-10-18.** The
[final full hosted run](https://github.com/KBHarris/hearth/actions/runs/39098465058)
passes all 14 jobs on source `53659dd`, including the final acceptance gate.
Windows, macOS and Linux each pass all 16 Phase 3 packaged outcomes with fixture
cleanup; Windows community UI passes all 42 checks. The
[verified final evidence](evidence/phase3-final-hosted-2026-10-18.json) preserves
the platform and browser reports, including Linux's documented native-media
capability fallback. The user accepts the buddy test; the provider/OS notification
preview waiver remains in force. The full Host/Join installation checkpoint is next.

Earlier implementation and validation: work is on `codex/guided-setup`.
Governance and the new member/file requirements are implemented. The
[2026-10-16 local acceptance](evidence/phase3-local-2026-10-16.json)
records 94 HTTP/private-S3, 51 browser and 19 packaged Windows outcomes. The
first full hosted milestone passed core and browser jobs, but failed Linux
desktop compilation on an upstream dependency mismatch; Windows/macOS were
cancelled. The Preview 0.3.3 compatibility pin passes local Linux compilation.
The October 17 corrected [full run](https://github.com/KBHarris/hearth/actions/runs/39070916430)
on frozen Preview 0.3.3 passed all core/browser jobs, Linux/macOS desktop jobs and
all three Phase 3 packaged suites. Windows community UI failed after 22 checks
when the fixture appended to a prefilled server address; a local test correction
replaces that value and passes all [42 local UI checks](evidence/phase3-ui-correction-2026-10-17.json)
against current 0.3.4 product source. Windows native media acceptance was skipped
in that earlier run. The separately requested final run above closes hosted
acceptance and retains the earlier failure as historical evidence. The user confirmed public HTTPS
health from a phone on cellular on October 17 and subsequently accepted the buddy
test by instruction. Actual provider/OS notification delivery retains its preview waiver.

Historical governance foundation validation, 2026-10-12: the local real
HTTP/product-WASM suite passed 90 checks with private S3, covering
the complete REST inventory, every gateway operation, signed account departure,
linked-session revocation, erasure, restart retry and physical file deletion.
Packaged Windows acceptance passes all 17 checks with private S3 including forums, polls, selected
reports, delegated moderation, ownership handoff in both directions and account
departure. The native shutdown-barrier regression also passes.

The second menu pass includes paperclip attachments, automatic address-derived
link cards with a display setting, compact actions, aligned checkboxes, permission
rows, empty states and explicit ownership device selection. Successor-authority
ordering and newly created channel opening are fixed. Channel changes made on
another device now appear in the sidebar without resetting management forms.
All 41 two-client browser/private-S3 checks pass, including forums/replies, reports,
polls, account privacy, exact deletion confirmation and narrow layout. Setup is
paced under the real server rate limits. Dated sanitized local reports are linked
from [PROGRESS.md](PROGRESS.md).
The 2026-10-12 hosted attempts returned `startup_failure` before any jobs started,
including a manual dispatch; the API gave no reason. Final-source macOS/Linux
packaged acceptance now passes in the completed run above. The earlier `e5c99a8` checkpoint passes all twelve hosted jobs in
[run 38205711382](https://github.com/KBHarris/hearth/actions/runs/38205711382),
which does not validate the newest Phase 3 additions.

See [the development guide](PHASE3_DEVELOPMENT.md),
[the permission matrix](PHASE3_PERMISSION_MATRIX.md),
[governance ADR](adr/0013-signed-community-governance.md),
[ownership ADR](adr/0014-community-ownership-transfer.md),
[reports ADR](adr/0015-selected-encrypted-reports.md) and
[account departure ADR](adr/0016-signed-account-departure.md).

- [x] Menu and navigation structure: persistent communities/channels, focused
  management panels, Add Server, keyboard focus/Escape and preserved drafts/keys.
- [x] Final menu polish, all 54 expanded local two-client/private-S3 UI checks and
  all 42 hosted Windows community UI checks.
- [x] Owner-signed roles, active permission bits, assignments and channel overrides;
  rollback/tamper rejection and epoch-bound history authorization.
- [x] READ revocation across REST and gateway, with MLS audience removal before publishing.
- [x] Content-free governance audit log and owner management UI.
- [x] Owner-managed community/channel bans, timeouts, serialized slow mode and abuse limits.
- [x] Signed rules and read-only screening with renewed consent after changes.
- [x] Signed retention, immediate filtering, database expiry and retry-digest preservation.
- [x] Physical private-S3 retention expiry and account-deletion erasure acceptance.
- [x] Ownership transfer: ordering regression, two-client and packaged Windows acceptance.
- [x] Delegated moderation, kicks, private blocks and operator bans; complete permission matrix.
- [x] Verifiable selected reports and encrypted moderator queue.
- [x] Per-user data export and signed account deletion, including physical S3 erasure.
- [x] Forum channels and encrypted polls.
- [x] Generic Web Push encryption, bounded delivery queue, opt-in settings and local checks.
- [x] Raise file uploads to 50 MB across the client, encrypted protocol and hosting stack.
- [x] Server-owner file deletion, with explicit authority, revoked reads and physical ciphertext cleanup.
- [x] Visible **Server Members** sidebar with circular avatars, names and role labels;
  use authorized membership data without Online/Offline grouping.
- [x] Clickable member profile modal with identity fingerprint, profile details and roles.
- [x] Updated regression coverage and published Preview 0.3.4 Windows/server package;
  guarded host startup, installed version display and local port 8080 default.
- [x] Buddy-PC/two-house acceptance accepted by user instruction on 2026-10-17,
  superseding the preview waiver; [manual record](evidence/phase3-manual-acceptance-2026-10-17.json).
  No independent telemetry or all-OS clean-machine pass is claimed.
- [x] Provider/OS notification acceptance waived by the user for this preview on 2026-10-16; unverified.
- [x] Hosted cross-platform and packaged desktop Phase 3 acceptance. The
  [final full run](evidence/phase3-final-hosted-2026-10-18.json) passes all 14 jobs
  on source `53659dd`, including all three Phase 3 packaged suites and the final gate.
  The [final local closeout](evidence/phase3-closeout-local-2026-10-17.json) passes
  94 HTTP/private-S3, 54 expanded two-client UI and 19 Windows packaged outcomes,
  including the corrected forum navigation fixture. Rust/web/WASM/native checks
  pass. The successful hosted closeout retains the accepted buddy test and
  explicit provider/OS notification preview waiver.
- [x] Manual-only Actions budget controls and local policy checks. The final
  full hosted milestone was explicitly requested and passed; any further hosted
  run requires a new request.

Work through the unchecked items in the exact order and scope defined by
[the Phase 3 remaining-work checklist](PHASE3_REMAINING.md).

**Exit:** the permission-matrix test suite is green for every endpoint and gateway op.
A report is verifiable by a moderator. Retention expiry deletes the ciphertext.
The new member/file requirements and remaining acceptance items pass, subject to
the user-accepted buddy test and explicit real-notification preview waiver recorded above.

## Checkpoint after Phase 3: Simple Host/Join setup

**Goal:** Install → Host or Join → Share an invite, without a terminal or manually
installed development dependencies. This moves essential user-facing operations
ahead of media expansion; advanced deployment remains available.

The [guided setup pass](GUIDED_SETUP.md) adds Host/Join entry points, real
readiness for an existing host, identity-checked account/community invitations
and a handoff through account creation and signed community admission. Windows
native invite handoff, UI host controls and signed updates are implemented.
The 2026-10-20 [Host/Join implementation](GUIDED_SETUP.md#hostjoin-implementation-2026-10-20)
adds runtime/package preparation, startup enrollment, portable fresh-host restore,
outside-network challenge checking and saved-host recovery. Local Windows/native
and isolated Docker checks pass; new release publication and actual clean-machine
acceptance remain open in the [acceptance matrix](HOST_JOIN_ACCEPTANCE.md).
Public HTTPS health was confirmed from cellular; a complete
outside-network encrypted messaging test is accepted by user instruction for the
Phase 3 preview. The new outside-check flow and all-OS clean-machine installation
still need actual independent-network/installation acceptance.

- [x] Host/Join client entry and explicit confirmation after checking an address.
- [x] Close the reopened saved-host sidebar report locally (2026-10-21). Retry/timeout,
  focus/visibility refresh, hosting-change updates and package-recovery entries
  are implemented; four lifecycle and six production-UI checks pass. Actual
  Windows shortcut reopening now preserves the user's server in the sidebar.
  The real Explorer shortcut reproduced an empty Windows profile despite the
  earlier passing test launches. Reselecting the original host through the normal
  client restored its binding; Gold Team now survives that same shortcut's
  close/reopen. [Normal-launch evidence](evidence/host-sidebar-start-menu-2026-10-21.json)
  supersedes the earlier assumption that direct-launch checks covered this case.
  The original failure was not reproduced during diagnosis. See
  [saved-host recovery](HOST_SIDEBAR_RECOVERY.md).
- [x] Pretty invite code carries server identity, account and community admission,
  with a separate server address at the user's request; capabilities stay in
  memory, with existing device approval preserved. Old links remain compatible.

- [ ] A normal installer prepares services, storage, migrations and server identity;
  owner enrollment and joining happen in the UI.
- [ ] Guided local/internet hosting checks firewall, routing, HTTPS and actual outside
  reachability. Diagnose CGNAT and loopback limitations with useful recovery actions.
- [ ] Evaluate an optional tunnel/relay with explicit provider and web-client trust
  boundaries; preserve all-message encryption.
- [ ] One invite opens the correct server/community and explains approved-device
  admission when a member cannot yet access encrypted channels.
- [ ] Background hosting, opt-in startup, data-preserving retry, update, backup and
  fresh-host restore are ordinary UI operations.
- [ ] Clean-PC installation, two-house encrypted DMs, reboot persistence, failed-setup
  recovery, update and restore receive actual Windows/macOS/Linux acceptance.

**Exit:** a nontechnical host and friend complete the above flow without developer
tools, manual commands or secrets in diagnostic exports. See
[the detailed installation standard](HAVEN_PARITY_AND_SETUP.md).

## Phase 4: Cloud hosting, voice, video, and events

**Current real-use blocker, 2026-10-25:** normal sign-in to 0.4.0 immediately
fails to open encrypted messaging, while saved-server discovery succeeds. A
signed local 0.4.1 diagnostic patch is installed and preserves safe native storage errors and avoids
idle call-ended notices. The actual storage condition remains unconfirmed;
see [the startup investigation](MESSAGING_STARTUP_RECOVERY.md). This reopens
the normal Windows messaging acceptance gate without relabeling prior fixtures.

**Local automated release work complete, 2026-10-25.** Preview 0.4.0 is published;
all 14 public downloads match the validated signed bundle. The installed Windows
client and original selected server are upgraded to 0.4.0, the server is healthy,
and SFU/relay hosting is enabled and running. The signed server update rehearsed
its backup/restore; original credentials, server identity, accounts/devices and
durable encrypted history match the protected baseline. [Upgrade proof](evidence/preview-0.4.0-publication-upgrade-2026-10-25.json).

Acceptance source `eeb4b2a` validates frozen application source `df97a1e`: all
16 complete 25-person room checks pass, including media/load, permission removal,
wire privacy, cleanup and unchanged request limits. Required npm verification
passes, including 151 client tests; installed bundle validation passes 19 checks.
[Frozen local evidence](evidence/phase4-release-local-2026-10-25.json) records 23
passing reports. Physical devices, independent networks, normal Start-menu
saved-server recovery, clean installation/reboot/fresh restore and remaining
platform acceptance stay open. Railway and hosted CI remain paused; Spotify is
disabled. These remaining gates prevent claiming the full hosted/platform exit.

**Goal:** a reproducible hosted Hearth deployment with an optional browser client,
plus E2EE real-time media with direct peer-to-peer calls and relay options. It
depends on P3 permissions, the Host/Join checkpoint and the Spike B decision.
Scope expanded 2026-10-16. Implementation started 2026-10-20 with configurable
S3 storage, native IaC/deployment tooling and production browser/server images
with local acceptance. The first encrypted 1:1 voice/camera/screen-video slice is
implemented and locally tested; real Railway deployment and full media acceptance
remain open. Work resumed with local call-route and native Windows acceptance. The separate
clean-machine Host/Join checkpoint retains its acceptance gates.
See [the Phase 4 hosting and media plan](PHASE4_HOSTING_AND_MEDIA.md) for work order,
provider boundaries, bootstrap behavior and acceptance requirements.

Completion work was authorized on 2026-10-23. The earlier capacity failures,
targeted production fixes and acceptance-audit corrections remain recorded in
[progress](PROGRESS.md); their failed raw results were not relabeled. The new
complete passing run, publication and actual client/server upgrades supersede
those pending checkpoints. [The release checklist](PHASE4_RELEASE_CHECKLIST.md)
separates completed local work from the remaining manual and deferred gates.

### Hosted deployment and browser client

- [ ] Add Railway native IaC for the backend, PostgreSQL, private attachment bucket
  and persistent server-key volume, with an optional browser-client service.
  Implemented and locally typechecked; live application remains unverified.
- [ ] Add a guided deployment command for project selection, plan/apply, build/deploy,
  generated HTTPS addresses, configuration wiring, readiness checks and owner setup.
  Retry preserves resources, accounts and keys; credentials stay out of source/logs.
- [ ] Make S3 bucket name, region, URL style and existing-bucket behavior configurable;
  verify Railway buckets alongside the bundled SeaweedFS store, private presigned
  transfers, browser CORS, 50 MB uploads, retention and owner-authorized deletion.
  Configuration is implemented; see [storage settings and local checks](STORAGE_CONFIGURATION.md).
  This combined item remains open for real Railway/browser acceptance.
- [ ] Package the production web client with crypto/WASM, correct backend and gateway
  addresses, exact allowed origins, HTTPS, SPA navigation and safe asset updates.
  Desktop-only hosting must work without deploying the website.
  Images and the Chromium owner/device/proxy flow pass locally. See
  [cloud development and acceptance boundaries](CLOUD_DEPLOYMENT.md).
- [x] Document hosted backup/restore and update/recovery procedures preserving
  PostgreSQL, encrypted objects and matching authentication keys; see
  [hosted recovery](CLOUD_RECOVERY.md). Local image restore covers database/keys;
  native host backup rehearsal includes encrypted object volumes and media settings.
- [ ] Verify the full hosted recovery procedure on fresh provider resources.
  Scheduled Railway backups and live provisioning remain explicitly held.
- [ ] Verify a fresh real Railway deployment, independent-network browser/desktop
  messaging and files, idempotent retry and redeploy persistence. Keep hosted execution
  explicitly requested and budgeted under [the Actions standard](CI_STANDARD.md).

### Media and events

- [x] Implement the first two-account call slice: MLS-encrypted signaling, approved
  peer-device binding, client-only MLS exporter/SFrame keys, encryption readiness,
  answer/decline, mute, camera, screen video and capture cleanup. Local Chromium
  acceptance passes 14 synthetic-media outcomes; this is not installed-client or
  physical-device acceptance. See [the call guide](DIRECT_CALLS.md) and
  [checkpoint evidence](evidence/phase4-direct-calls-local-2026-10-20.json).
- [x] Implement authenticated STUN/TURN configuration, short-lived coturn credentials
  and relay-only policy with selected-relay verification. End calls on membership
  epoch changes and failed permission/device/heartbeat checks.
- [x] Finish the frozen local direct/UDP/TCP matrix: the sequential 2026-10-21
  run passes 14/15/15 checks with selected relay verification and zero host
  candidates in relay-only mode. See [local evidence](evidence/phase4-direct-calls-local-2026-10-21.json).
- [x] Exercise the product call slice in an opt-in native Windows WebView2 fixture:
  direct/TURN-UDP/TURN-TCP pass 15/16/16 checks, including native storage cleanup.
  Tracks are synthetic and playback uses a test autoplay override. See
  [native evidence](evidence/phase4-native-direct-calls-local-2026-10-21.json).
- [x] Add bounded same-epoch ICE recovery without reacquiring capture or resetting
  SFrame workers/counters. Reauthorize offers/answers, resolve simultaneous offers,
  recheck relay-only routes and stop on stalled recovery. Local synthetic direct,
  UDP/TCP relay and native Windows checks are recorded in
  [the recovery checkpoint](evidence/phase4-call-recovery-local-2026-10-22.json).
  The automatic trigger uses an injected disconnect event; real outages remain open.
- [ ] Validate physical capture, installed product media, independent networks,
  TURN-TLS and relay-only privacy before release. Local TCP acceptance is TURN
  client transport, not proof of TURN-TLS or all-TCP media routing.
- [x] Add a bounded active-call key update for verified 1:1 MLS device changes:
  pause old-key media, reauthorize the selected pair, derive fresh client-only keys,
  require worker/peer confirmation and advancing media, and preserve capture/mute.
  See [the transition and acceptance boundaries](CALL_KEY_UPDATES.md).
  Rapid/overlapping changes end capture; general group-call rekey remains open.
- [x] Add authenticated WebRTC signaling for direct P2P voice/video/screen sharing
  in small calls, STUN/TURN fallback and a relay-only privacy option. Direct media
  bypasses Railway; direct participants can learn each other's network addresses.
  The 1:1 and bounded private-group implementations are released in 0.4.0;
  real-network route and full-platform acceptance remain separate gates.
- [x] Build and locally test the fixed three-person group admission/key foundation:
  one selected device per account, explicit consent, direct ephemeral contributions,
  pair-specific MLS/ECDH keys and multi-consumer publication barriers. See
  [the implemented foundation and remaining integration](GROUP_CALLS.md).
  That historical checkpoint was disabled; the product behavior below supersedes
  its original all-answer/end-on-leave policy.
- [x] Integrate the three-person private voice mesh and interface, distinct
  group-format support, shared capture cleanup and whole-roster access checks.
  Two people can start, a third can join later and survivors continue after the
  caller leaves. Participation changes refresh keys without recapturing continuing
  microphones or losing mute state. Local direct/UDP/TCP and native Windows
  acceptance cover all six audio paths, caller departure, relay-only selection,
  permission revocation and cleanup. See [group voice](GROUP_VOICE.md) and
  [the checkpoint](evidence/phase4-group-voice-local-2026-10-22.json).
- [x] Allow explicit rejoining of the same ongoing private call, with fresh ECDH
  contributions, bounded participation rounds and replay-safe departures. Retain
  only public call state after leaving; recheck authorization before rejoining.
  The option lasts only in the current client session while a selected peer is
  live. Group control format 2 requires current clients on all MLS devices.
  See [the rejoin checkpoint](evidence/phase4-group-rejoin-local-2026-10-22.json).
- [x] Add the first persistent community voice-room slice: voice channels with
  explicit join/leave, no ringing, up to four simultaneous accounts, signed public
  occupancy, one device per account and fresh client-only pair keys. Rooms survive
  everyone leaving and work without the owner's session. Read/send permissions,
  approved devices, rules screening and control-format 3 gate participation.
  See [community voice](COMMUNITY_VOICE.md); this is local development, not an
  installed-client release or real-network acceptance.
- [x] Implement optional SFU community rooms with a 25-account admission bound,
  per-publisher client-only keys, explicit join/leave, encrypted camera/screen
  and separate computer audio. Six-person local product acceptance verifies
  decoded media and membership rotation preserving continuing capture/mute.
  See [SFU rooms](SFU_ROOMS.md); physical, internet and full-platform gates remain.
- [x] Add separate connect/speak/listen permissions, device changes and bounded
  MLS chat membership rekey preserving authorized source selection/mute.
  Private-group and stage consent/revocation fixtures pass locally.
- [x] Complete the local automated 25-person media/load target and record its
  synthetic-media limits; real-device/network/platform acceptance remains open.
- [x] Add the first community-room camera and screen-video slice, with explicit
  per-source consent, independent camera/screen slots, simultaneous shares,
  one local source per publication and authenticated tile state. Recheck room
  access around capture prompts and on every encrypted sender edge. Stop originals
  and clones on membership changes; require fresh video consent for the new
  audience. Format 4 gates upgraded clients before capture. See [room video](ROOM_VIDEO.md).
- [x] Add separate camera/screen publication permissions and opt-in computer audio,
  with independent encrypted sources in direct, private-group and community rooms.
  Preserve authorized capture through rekey; stop obsolete clones and restricted
  sources. Real per-window/system audio and full-platform acceptance remain manual.
  See [computer audio](COMPUTER_AUDIO.md).
- [x] Keep LiveKit as the optional SFU, with a four-person direct mesh fallback
  and 25-account SFU admission bound. Bind mode and membership changes to fresh
  verified room admission/keys. Local media/load limits are measured; real-network
  topology-change acceptance remains in the manual route gate below.
- [x] Add optional pinned LiveKit/coturn Compose overlays, private idempotent
  configuration generation and local-only defaults. A disposable package check
  verifies both services, custom port consistency and secret cleanup. Reuse the
  common coturn REST relay for direct/SFU clients; embedded TURN remains optional.
  Public addressing, WSS/TURN-TLS and outside routing remain deployment gates.
  Railway still needs a separately reachable SFU/TURN or managed media endpoint.
- [x] The server authorizes signaling and mints bounded room/device-scoped media tokens
  and short-lived TURN credentials; provider API secrets remain server-side.
  SFU tokens require current signed occupancy and the exact room revision, expire
  after 60 seconds and grant no media keys, data publication or metadata mutation.
- [x] Media keys come from the MLS exporter and rotate on every join and leave.
  Authenticate peer identity, reject stale/unauthorized participants and block
  publication when encryption is unavailable. SFrame interoperability is still a
  validation gate under [ADR 0004](adr/0004-media-feasibility.md).
  The 1:1 slice now has same-epoch ICE restart and bounded in-call key updates;
  bounded group/room recovery is implemented. Independent SFrame interoperability
  and real-network recovery remain acceptance gates.
- [x] Voice channels, 1:1/private-group calls, video and screen share with audio.
- [x] Stage speaker/audience roles and explicit speaking consent; audience can
  watch permitted camera/screen publications without opening a microphone.
- [x] MLS-encrypted scheduled events, creator cancellation and authenticated RSVP.
- [x] Simultaneous sharing, explicit audio where supported, device switching and
  microphone/speaker/deafen controls. Verify actual devices on each platform.
- [x] Opt-in YouTube/SoundCloud synchronized playback, encrypted host controls,
  opaque player isolation and stale-host bounds. Spotify is disabled this release.
- [ ] Test actual direct, TURN and SFU paths, cross-house/NAT/firewall conditions,
  relay-only IP privacy, reconnects, permission revocation and topology changes.
- [x] Local canary/privacy checks: no publisher keys in observed server traffic,
  a routing-authorized wrong-key SFU observer decodes no media, and production
  assets exclude private fixture material. Record fixture CPU, client upload and
  recipient/egress traffic. Independent-network captures and real hosting bills
  are not established by these local measurements.

**Exit:** a fresh Railway deployment serves encrypted chat/files to desktop and optional
browser clients; retry, update and restore preserve identity and data. Direct P2P,
TURN fallback and relay-only calls pass real-network encryption/permission checks.
A 25-person SFU voice room plus a screen share is stable across the supported desktop
and browser paths, with Linux browser fallback as specified by ADR 0004. Hosted
provisioning, real-network media and the final platform suite have separate evidence.

## Phase 5: Federation

**Goal:** users on different servers share communities and DMs.

- Server keys, `/.well-known/hearth`, and signed server-to-server events with idempotency and
  retries.
- The home-server authority model and remote membership relay.
- Linking a portable identity to accounts on several servers.
- Community federation policy (`closed`, `allowlist`, `open`) and server and user
  blocklists.
- Cross-server DMs, attachments, and voice.
- A federation conformance test suite that runs two servers in Compose.

**Exit:** the full cross-server text, file, and voice scenarios pass. Blocklists hold under
adversarial tests.

## Phase 6: Bots, directory, and operations

- Bot accounts, capability grants, the bot event API, and the Rust and TS SDKs. The SDKs are
  permissively licensed, depend only on proto and crypto, and have the dependency rule
  enforced in CI (ADR 0001).
- Webhooks and commands with explicit encrypted-conversation capabilities; content
  automod/link filtering runs only in an authorized moderator client or admitted bot.
- Discord import and bidirectional bridge with honest provenance and explicit disclosure.
- Opt-in Steam/Last.fm rich presence and other integrations with scoped permissions.
- The opt-in public directory service.
- Operations: backup and restore, upgrade tooling (migrations and rollbacks), and
  content-free metrics and structured logs.
- Admin UI completeness, and the documentation site. Network-abuse controls, SSO/MFA,
  guest access and rotating invites require designs compatible with local encryption keys.
- Themes, stickers, personas, soundboard, avatar styling, server branding, density and
  localization. Plugins require a permissions/trust design; keep the default UI coherent.
- Additional generic notification adapters, including evaluation of UnifiedPush.

**Exit:** an example bot works through the SDK. A backup is restored onto a fresh host. An
upgrade from N-1 passes.

## Phase 7: Release readiness

- Reproducible builds, signed installers (Authenticode, Apple notarization, and a Linux AppImage
  or Flatpak), and SBOMs.
- Tray, native notifications and background behavior verified on each platform.
- The final threat model, privacy docs, the deployment guide, and `SECURITY.md` with a
  disclosure process.
- A public beta with community security review, and a bug bounty or disclosure program.
- A cross-platform compatibility suite and load tests at target scale.

**Exit:** 1.0 release candidate.

---

## Deferred until after 1.0

Mobile clients, a bot marketplace, a self-built SFU, and multi-home communities.
