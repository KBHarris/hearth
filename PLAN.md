# Hearth — Privacy-First Federated Community Platform

> Revision 2 (2026-09-30). Revision 1 was the original product brief. This revision
> keeps its goals and resolves the architectural gaps it left open. The phased build is in
> [docs/ROADMAP.md](docs/ROADMAP.md). The [Revision notes](#revision-notes) at the end list
> what changed and why.

## Summary

Hearth is an AGPLv3, desktop-first community platform for Windows, macOS, Linux, and the web.
It provides Discord's core social and real-time communication features without subscriptions,
cosmetics, advertising, quests, behavioral tracking, or a centralized operator.

Every message, attachment, voice stream, video stream, and screen share is end-to-end
encrypted. Communities are self-hostable through a one-command Docker/Podman deployment with
an onboarding admin UI, optional federation, and an opt-in public directory.

### Non-goals

- Paid tiers, cosmetics, shops, quests, ads, engagement ranking, or telemetry-driven
  recommendations.
- Centralized content policing. Each community moderates itself, and each operator
  moderates their own server.
- Server-side search, server-side link previews, and server-side content scanning. All of
  these would need plaintext.
- Mobile apps before the protocol stabilizes (see [Assumptions](#assumptions)).

## Principles

1. **The server is untrusted for content.** It sees ciphertext, opaque blobs, and the
   minimum routing and permission metadata. Every feature is designed with that constraint
   and never works around it.
2. **Metadata minimization is explicit.** Every piece of metadata the server stores is
   listed in the threat model with its justification and retention.
3. **The protocol comes first.** Clients, servers, bots, and federation peers speak
   versioned, documented schemas. The reference implementation is not the spec.
4. **One core, many shells.** Protocol, cryptography, and client state logic live in Rust
   once, and are compiled natively for desktop and to WebAssembly for the web.
5. **Deliver vertical slices.** Each phase ships something usable end to end, rather than a
   layer that can only be tested once everything else exists.

## Architecture

### Components

| Component | Technology | Notes |
|---|---|---|
| Client UI | React + TypeScript (Vite) | One UI codebase for the desktop and web builds. |
| Desktop shell | Tauri 2 | Native keystore, SQLCipher local DB, OS notifications, auto-update. |
| Client core | Rust (`hearth-client-core`) | Session, sync, MLS state, local store abstraction. Native + WASM. |
| Crypto | Rust (`hearth-crypto`) over OpenMLS + RustCrypto | Identity keys, device cross-signing, MLS, file encryption, media key export. |
| Protocol | Rust (`hearth-proto`) → generated TS types | Versioned wire types for REST, gateway, federation, and bots. |
| Home server | Rust (axum, tokio, sqlx) | REST + WebSocket gateway, MLS delivery service, permissions, federation. |
| Database | PostgreSQL | Encrypted event envelopes, membership, roles, operational metadata. |
| Object storage | S3-compatible (SeaweedFS bundled; any S3 supported) | Opaque encrypted blobs only. |
| Media | Direct WebRTC P2P + TURN; optional LiveKit SFU (planned) | Small calls prefer direct media with relay-only privacy available; larger rooms use the SFU. Client-encrypted frames; SFrame profile and interoperability remain validation gates. |
| Deployment | Compose (Docker or Podman); Railway native IaC (planned Phase 4) | Backend + Postgres + private S3 + persistent server keys + optional web client. Media relays may be hosted separately. |

**Decision: use an existing SFU and don't build one.** Revision 1 implied writing our own
WebRTC SFU in Rust. LiveKit (Apache-2.0) already supports end-to-end encryption through
insertable streams with a custom key provider, simulcast, and TURN. We feed it keys derived
from MLS, and it never sees them. Writing our own SFU becomes an option once the product
exists, and should not be a prerequisite for it.

Phase 4 scope clarified 2026-10-16: direct peer-to-peer voice/video/screen sharing
is also required for small calls, matching the Haven parity target. Add authorized
signaling and STUN/TURN fallback; retain LiveKit for larger rooms and offer a
relay-only mode to avoid exposing direct-peer network addresses. All paths keep
media keys on clients and enforce current membership. See
[the Phase 4 hosting and media plan](docs/PHASE4_HOSTING_AND_MEDIA.md) for Railway
IaC, optional browser hosting, provider storage compatibility and media deployment
boundaries. These additions are requirements, not validated implementations.

### Identity model

Three layers, cross-signed in the same way as Matrix/Signal-style multi-device systems:

- **User identity key** (Ed25519): long-lived and portable. It signs device keys. It is
  exportable in the offline **recovery kit**, which is a printable passphrase-encrypted
  bundle.
- **Device keys**: one per install. Each device key is the credential in that device's MLS
  leaf. A new device is approved either by an existing device (QR code or short code
  over the gateway) or by restoring from the recovery kit.
- **Account**: a server-local login (username + password via OPAQUE, so the server never
  sees the password) that is bound to a user identity key. A local account can later
  *link* a portable identity so that the same person is recognizable across servers.

Identity changes (device added or removed, identity rotation) are published as signed
events. Clients display safety numbers and warn on unexpected key changes.

### Encryption model

- **Text channels and DMs**: one MLS group per channel audience. The channel's home server
  acts as the MLS **Delivery Service**. It totally orders commits for groups it hosts, and
  that total order is the answer to "who sequences commits once federation exists".
- **Membership sync**: the server's permission roster is the source of truth for who is
  allowed in a group. Clients that hold `manage-members` capability, or an automatic
  "rekey agent" role on any member device, issue MLS commits to match the roster. The
  server rejects commits that add non-permitted members.
- **History sharing**: MLS does not give new members past messages. Each channel has a
  history policy (`none` | `since-invite` | `full`). Under `since-invite` or `full`, an
  authorized existing member wraps the relevant archived epoch secrets for the new member.
  The server only relays the wrapped keys.
- **Attachments**: the client encrypts with a random per-file key (XChaCha20-Poly1305,
  chunked for streaming). It uploads to S3 through a presigned URL, and the file key travels
  inside the MLS message. Thumbnails and previews are generated locally and encrypted in
  the same way.
- **Voice, video, and screen share**: planned SFrame profile via WebRTC encoded transforms,
  with interoperability still to validate (see [ADR 0004](docs/adr/0004-media-feasibility.md)). Media keys are
  derived from the voice channel's MLS group through the MLS exporter, and rotate on every
  membership change.
- **Reports**: MLS application messages carry the sender's signature over the framed
  content. A reporter discloses the plaintext + signature + surrounding context to the
  community's moderators, who can verify authorship without the server ever holding
  plaintext.
- **Deletion and retention**: deletion removes the ciphertext from the server and sends a
  signed deletion event that well-behaved clients honor. The UI states honestly that other
  people's devices may already hold copies.

### Local data

- Desktop uses SQLCipher, with the database key held in the OS keystore (Windows Credential
  Manager, macOS Keychain, Secret Service on Linux). This database is also the full-text
  search index.
- Web uses IndexedDB, encrypted with a key that is wrapped by a passphrase or a WebAuthn PRF
  key. Its history is limited by storage quota, and the UI says so.

### Notifications

Desktop keeps the gateway connection open and raises notifications locally. Web Push
carries no content ("New activity in Hearth"), and the client fetches and decrypts before it
displays anything.

### Federation

- Servers are identified by domain and a server signing key, published at
  `/.well-known/hearth`.
- Server-to-server traffic uses signed, idempotent events carrying an event ID and a
  per-origin sequence number. Delivery is at-least-once with retries.
- A community is **homed** on one server. That server is the authority for its roster,
  roles, and MLS commit ordering. Remote members' home servers relay their traffic.
- Per-community policy is `closed` | `allowlist` | `open`, together with server and user
  blocklists.
- The opt-in directory is a separate, independently operable service that indexes only
  what an admin chooses to publish.

## Product capabilities

### Communication (parity target)

Communities, categories, text / voice / forum / announcement / stage channels, DMs and group
DMs, threads, replies, reactions, custom emoji/stickers, Markdown, polls, client-generated
embeds, file sharing, profiles, presence, typing, read state, pins, local search, invites,
scheduled events, voice and video calls, streaming, and screen sharing.

Link embeds are generated **by the sender's client** and sent encrypted, so the server never
fetches URLs. Recipients can opt to fetch previews themselves, which exposes their IP to the
linked site. That trade-off is disclosed to them.

### Governance

Roles and granular permissions, channel overrides, ownership transfer, content-free audit
logs, onboarding, invite controls (expiry, max uses, per-role), slow mode, rate limits,
channel, user, and server bans, reports, and retention, export, and deletion controls.

### Bots and service accounts

Bots are explicitly invited accounts with device keys of their own. They join the MLS
groups of the channels an administrator grants them, and get no other plaintext. A bot's
capabilities are visible to every member of the channel. There is no marketplace at launch.

### Public interfaces (versioned from day one)

- Client REST API (`/api/v1`) + real-time gateway (WebSocket, versioned opcodes)
- Federation API (`/_federation/v1`), made of signed events
- Local operator/admin API (bound to localhost or the admin network only)
- Bot event and capability API
- SDKs, both permissively licensed:
  - Rust: a bot SDK crate built on `hearth-proto` + `hearth-crypto`
  - TypeScript: `@hearth/sdk`, generated from `hearth-proto`

### Licensing

Decided in [ADR 0001](docs/adr/0001-license-split.md):

- **AGPL-3.0-only:** the server, the clients, and `hearth-client-core`, which is the
  application itself.
- **Apache-2.0 OR MIT:** `hearth-proto`, `hearth-crypto`, and the SDKs. Bots and alternative
  clients can use any license.

A permissive crate must never depend on an AGPL one.

## Quality and test strategy

- **Confidentiality invariants:** automated tests check that no server-side table, log, S3
  object, federation payload, or SFU stream contains known plaintext canaries.
- **Cryptographic scenarios:** cross-device linking, recovery-kit restore, membership
  rekeying, the three history policies, deletion/retention expiry, offline delivery, and
  linking a local account to a portable identity.
- **Authorization:** permission-matrix tests for every endpoint and gateway op; bot
  capability boundaries; federation allowlists and blocklists; invite abuse.
- **Compatibility:** end-to-end suites on Windows, macOS, Linux, and browsers, including
  cross-server text, files, voice, video, streaming, and screen share.
- **Load and resilience:** gateway fan-out, large channels (MLS commit cost with 1k+
  members), concurrent voice rooms, federation retries and idempotency, upgrades,
  backup/restore.
- **Observability** captures no content and no per-user behavioral data. Metrics are
  aggregate. Logs are scrubbed of identifiers by default.

## Key risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Tested Linux WebKitGTK lacks encrypted media APIs** | Ubuntu 22.04's desktop runtime cannot host E2EE voice | Use a supported browser for Linux media; block publication when encryption is unavailable. Retest newer webviews before enabling them. A native Rust path needs separate interoperability and performance evidence (ADR 0004). |
| MLS commit cost and conflicts in large, busy channels | Latency, failed commits | The server sequences commits; commits are batched; external-commit joins; load tests start in Phase 2. |
| History sharing leaks past content to people who shouldn't have it | Privacy violation | Policy enforced client-side, plus server roster checks; dedicated tests; threat-model entry. |
| Scope: Discord parity is enormous | Nothing ships | Vertical-slice phases, each with an exit bar; stage and forum channels come after the core. |
| Federation coupled to MLS ordering | Split-brain groups | The single home server orders commits; remote servers never sequence. |
| Moderation without plaintext | Abuse goes unaddressed | Verifiable reports, rate limits, invite controls, and bans from Phase 3. |

## Assumptions

- The initial parity release includes the desktop and web clients. iOS and Android follow
  once the protocol is stable (1.0).
- "Discord parity" means the original community and communication experience. It excludes
  commercial, game, and creator-monetization systems.
- Security readiness relies on open-source and community review plus a public vulnerability
  program, not on a launch-blocking independent audit. The cryptography crates should still
  get a focused external review as soon as funding allows.

## Revision notes

What changed from revision 1, and why:

1. **Build a vertical slice before breadth.** Revision 1's step 1 bundled all of identity,
   crypto, storage, the container, and admin setup before any messaging existed. That work
   is now split so that encrypted 1:1 chat works end to end by Phase 1.
2. **The web client comes earlier.** The UI is the same React app, so the web build falls
   out of the desktop work for free. What was actually deferred (IndexedDB storage, Web
   Push) is scheduled explicitly rather than lumped into "Phase 4".
3. **The SFU is chosen, not built.** LiveKit + coturn replaces a from-scratch Rust SFU.
4. **Four holes in the E2EE design are now specified:** who sequences MLS commits, how
   roster and MLS membership stay in sync, how history sharing actually works, and how
   reports stay verifiable.
5. **The platform risk is surfaced.** Linux webview WebRTC was unaddressed and could block
   voice on one of the three desktop targets.
6. **The object store changed.** The design no longer assumes MinIO, whose community
   distribution is no longer a reliable default. SeaweedFS is bundled, and any S3-compatible
   store works.
7. **Password handling is specified.** OPAQUE means the server never sees passwords.
8. **Decisions are called out.** SDK licensing is settled in ADR 0001. ADR 0004 selects a supported browser for Linux media after the tested WebKitGTK runtime failed its capability gate; the remaining Spike B platform checks are still open.
