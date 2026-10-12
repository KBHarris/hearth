# Hearth Build Roadmap

The architecture and the reasoning behind it are in [PLAN.md](../PLAN.md). Each phase ends in
something usable and demoable. A phase isn't done until its **exit criteria** pass in CI.

```
P0 Foundations ─► P1 Encrypted DMs ─► P2 Communities ─► P3 Governance ─┬─► P4 Voice/Video
                                                                      └─► P5 Federation ─► P6 Bots & Ops ─► P7 Release
```

P4 and P5 can run in parallel once P3's permission model is stable.

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

- [x] Menu and navigation usability pass: preserve the current palette and overall feel.
  Use persistent community/channel navigation, move setup and management into focused
  panels, and give common actions clear labels, visible focus and keyboard navigation.
  Use feedback from the two-PC test to prioritize confusing or repetitive steps.

  Local 2026-10-11 validation passes 29 two-client Chrome checks, including Add Server,
  focus/Escape, preserved drafts and keys, and a 430-pixel layout.

Phase 3 is in progress on `codex/phase3-navigation`. Local validation passes 57 real
HTTP/product-WASM checks and the 29-check Chrome UI suite. Native Rust, web build,
clippy, WASM and generated-protocol checks pass. [ADR 0013](adr/0013-signed-community-governance.md)
and [the development guide](PHASE3_DEVELOPMENT.md) record the implementation and limits.
Hosted and packaged Phase 3 validation remain open. The frozen Phase 2 bundle is unchanged.

- [x] Owner-signed roles, active permission bits, assignments and channel overrides; client rollback/tamper rejection and epoch-bound history authorization.
- [x] READ revocation across REST and gateway, with MLS audience removal before new publishing.
- [x] Content-free governance audit log and owner management UI.
- [x] Owner-managed community/channel bans, timeouts, serialized slow mode and existing abuse limits.
- [x] Signed community rules and read-only screening, digest-bound acceptance and renewed consent after changes.
- [x] Signed channel retention, immediate read filtering, database ciphertext expiry and retry-digest preservation.
- [ ] Physical private-S3 retention acceptance (implemented; local Docker daemon unavailable).
- [ ] Ownership transfer with pinned root and historical authorization continuity.
- [ ] Delegated moderation, kicks and user/server-wide bans; complete endpoint/gateway permission matrix.
- [ ] Verifiable reports (plaintext + MLS-authenticated sender proof + selected context), and a moderator queue.
- [ ] Per-user data export and account deletion.
- [ ] Forum channels and encrypted polls.
- [ ] Web Push with generic payloads.
- [ ] Hosted cross-platform and packaged desktop Phase 3 acceptance.

**Exit:** the permission-matrix test suite is green for every endpoint and gateway op. A
report is verifiable by a moderator. Retention expiry deletes the ciphertext.

## Phase 4: Voice, video, and events

**Goal:** E2EE real-time media. It depends on P3 permissions and the Spike B decision.

- Add LiveKit and coturn to Compose. The server mints LiveKit tokens after permission checks.
- SFrame keys come from the MLS exporter and rotate on every join and leave.
- Voice channels, 1:1 and group calls, video, and screen share with audio.
- Go-live streaming and stage channels (speaker and audience roles).
- Scheduled events with RSVP.
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
- The opt-in public directory service.
- Operations: backup and restore, upgrade tooling (migrations and rollbacks), and
  content-free metrics and structured logs.
- Admin UI completeness, and the documentation site.

**Exit:** an example bot works through the SDK. A backup is restored onto a fresh host. An
upgrade from N-1 passes.

## Phase 7: Release readiness

- Reproducible builds, signed installers (Authenticode, Apple notarization, and a Linux AppImage
  or Flatpak), and SBOMs.
- The final threat model, privacy docs, the deployment guide, and `SECURITY.md` with a
  disclosure process.
- A public beta with community security review, and a bug bounty or disclosure program.
- A cross-platform compatibility suite and load tests at target scale.

**Exit:** 1.0 release candidate.

---

## Deferred until after 1.0

Mobile clients, a bot marketplace, a self-built SFU, and multi-home communities.
