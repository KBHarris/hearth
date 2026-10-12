# Hearth Build Roadmap

The architecture and the reasoning behind it are in [PLAN.md](../PLAN.md). Each phase ends in
something usable and demoable. A phase isn't done until its **exit criteria** pass in CI.

```
P0 Foundations ─► P1 Encrypted DMs ─► P2 Communities ─► P3 Governance ─┬─► Host/Join setup ─► P4 Voice/Video
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
records the slice's scope and limits. The next checkpoint is the
[two-PC encrypted DM test](TWO_PC_DM_TEST.md) using the prepared Windows installer and
optional public-IP HTTPS front end. Public certificate issuance and trusted public-IP
health now pass from the host PC; two-house reachability remains part of the human test.
Phase 2 now uses a separate development checkout;
PR #2 remains a draft. The original server/data are preserved; the old bundle files
were replaced by the validated Phase 2 bundle on 2026-10-09.

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
and [the development guide](PHASE2_DEVELOPMENT.md) record scope and limits.

The versioned `7cc8852` Windows/server bundle passes eight assembled-artifact checks;
its HTTPS proxy configuration validates. Old Phase 1 bundle files are removed, with the
server data preserved. Follow [the two-PC Phase 2 guide](TWO_PC_PHASE2_TEST.md).
Live Let's Encrypt IP certificate issuance and trusted HTTPS health from the host PC
pass on 2026-10-09. Another-network reachability, clean buddy-PC installation and the
separate 50-person/week exit criterion remain open.

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

**Goal:** communities can govern themselves safely.

Phase 3 is in active validation on `codex/phase3-navigation` (2026-10-12).
The local real HTTP/product-WASM suite passes 90 checks with private S3, covering
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
The frozen Phase 2 bundle and data remain unchanged.

Current hosted checks return `startup_failure` before any jobs start, including a
manual dispatch; the API gives no reason. Current macOS/Linux packaged results
remain required. The earlier `e5c99a8` checkpoint passes all twelve hosted jobs in
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
- [x] Final menu polish and all 41 current two-client/private-S3 UI checks.
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
- [ ] Manual supported-browser provider acceptance and OS notification display.
- [ ] Hosted cross-platform and packaged desktop Phase 3 acceptance.

**Exit:** the permission-matrix test suite is green for every endpoint and gateway op.
A report is verifiable by a moderator. Retention expiry deletes the ciphertext.

## Checkpoint after Phase 3: Simple Host/Join setup

**Goal:** Install → Host or Join → Share an invite, without a terminal or manually
installed development dependencies. This moves essential user-facing operations
ahead of media expansion; advanced deployment remains available.

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

## Phase 4: Voice, video, and events

**Goal:** E2EE real-time media. It depends on P3 permissions and the Spike B decision.

- Add LiveKit and coturn to Compose. The server mints LiveKit tokens after permission checks.
- SFrame keys come from the MLS exporter and rotate on every join and leave.
- Voice channels, 1:1 and group calls, video, and screen share with audio.
- Go-live streaming and stage channels (speaker and audience roles).
- Scheduled events with RSVP.
- Simultaneous screen sharing, per-app audio where supported, mid-call device switching,
  and clear microphone/speaker controls, verified separately on each platform.
- Watch parties and synchronized listening; opt-in Spotify, YouTube and SoundCloud
  integrations need explicit playback and identity designs.
- Canary test: the SFU's recorded packets contain no decodable media.

**Exit:** a 25-person voice room plus a screen share is stable on all three desktop platforms
and in two browsers.

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
