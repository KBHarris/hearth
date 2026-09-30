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

- Set up the monorepo: Cargo workspace (`hearth-proto`, `hearth-crypto`,
  `hearth-client-core`, `hearth-wasm`, `hearth-server`), the React client, the Tauri shell,
  and the TS SDK package.
- Set up CI: fmt, clippy, cargo tests, the `wasm32` build, TS typecheck/lint/build, and a
  Tauri build matrix (Windows, macOS, Linux).
- Add the Compose stack: Postgres, SeaweedFS (S3), `hearth-server`, with a healthcheck.
- Serve `/health` and `/.well-known/hearth` from the server. Add sqlx migrations.
- Set up protocol type generation (Rust → TS) so that client types never drift.
- **Spike A, OpenMLS in WASM and in Tauri:** create a group, add a member, and
  encrypt/decrypt in both builds.
- **Spike B, E2EE media per platform:** LiveKit + encoded transforms in WebView2, WKWebView,
  WebKitGTK, and Chrome/Firefox/Safari. Record the results in an ADR and pick the Linux
  strategy.
- **Spike C, OPAQUE:** registration and login round trip, with the client in WASM and the
  server in Rust.
- Draft the first threat model: assets, adversaries, and the metadata inventory.

**Exit:** `docker compose up` gives a healthy server. The desktop and web shells both load
and call `/health`. The spike ADRs are merged.

## Phase 1: Identity and encrypted direct messages (first vertical slice)

**Goal:** two people on one server can exchange E2EE DMs from the desktop app or the
browser.

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

- Communities, categories, text and announcement channels, and invites (expiry, max uses).
- The MLS group per channel, roster to MLS sync, and the rekey agent.
- History policies (`none`, `since-invite`, `full`) and wrapped epoch-key handoff.
- Encrypted attachments via presigned S3 upload, with local thumbnails.
- Reactions, pins, threads, Markdown, custom emoji, mentions, and read state.
- Profiles, presence, and client-generated link embeds.
- Local full-text search.
- Start the MLS load benchmark (1k-member channel, commit latency).

**Exit:** a 50-person test community runs for a week. History policy tests pass. The
attachment canary passes.

## Phase 3: Governance and moderation

**Goal:** communities can govern themselves safely.

- Roles, the permission bitset, channel overrides, and ownership transfer.
- A content-free audit log.
- Bans (channel, user, and server-wide), kicks, timeouts, slow mode, and rate limits.
- Verifiable reports (plaintext + MLS signature + context), and a moderator queue.
- Retention policies, per-user data export, and account deletion.
- Onboarding flows, rules screening, and forum channels and polls.
- Web Push with generic payloads.

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
