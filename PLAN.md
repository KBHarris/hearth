# Privacy-First Federated Discord Clone

## Summary

Build an AGPLv3, desktop-first community platform for Windows, macOS, Linux, and the web. It provides Discord’s core social and real-time communication features without subscriptions, cosmetics, advertising, quests, behavioral tracking, or a centralized operator.

Every message, attachment, voice stream, video stream, and screen share is end-to-end encrypted. Communities are self-hostable through a one-command Docker/Podman deployment with an onboarding admin UI, optional federation, and an opt-in public directory.

## Architecture and Privacy Model

- Use a Tauri 2 desktop shell with a React/TypeScript interface; share the protocol and cryptographic core through Rust libraries compiled for desktop and WebAssembly.
- Build a Rust server with PostgreSQL for encrypted event metadata, S3-compatible opaque attachment storage, WebSocket real-time delivery, a self-hosted WebRTC SFU plus TURN service, and a bundled Docker/Podman Compose deployment.
- Define a versioned, open federation protocol using signed server-to-server events and independently verifiable Ed25519 identities. Communities choose open federation or an allowlist, with remote-server and user blocklists.
- Support portable cryptographic identities and server-local accounts. Local accounts may later link to a portable identity; new devices are approved by an existing device or restored with an offline recovery kit.
- Use MLS-based channel encryption and E2EE media transport. Servers enforce membership and permission metadata but store only ciphertext, opaque files, and minimum operational metadata.
- Keep search local to clients. Encrypt files before upload, generate previews locally, and make push notifications generic by default.
- Let channel policies control retention and history sharing. Deleted messages and expiry policies remove stored ciphertext; only explicitly authorized members can receive historical channel keys.

## Product Capabilities and Interfaces

- Deliver Discord-era communication features: communities, categories, text/voice/forum/announcement channels, DMs and group DMs, threads, replies, reactions, emoji/stickers, Markdown, polls, embeds, file sharing, profiles, presence, typing, read state, pins, search, invites, events, stage channels, voice/video calls, streaming, and screen sharing.
- Deliver community governance: roles, granular permissions, ownership transfer, audits, onboarding, invites, slow mode, rate limits, channel/user/server bans, reports, and configurable retention/export/deletion controls.
- Because content is encrypted, reports selectively disclose the reporter-chosen decrypted message evidence and signed context to that community’s moderators. Audit logs remain content-free.
- Provide explicitly invited bot/service accounts with per-channel capability grants and clear visibility to members. Bots only receive plaintext for channels an administrator authorizes; there is no app marketplace at launch.
- Publish stable, documented interfaces: client REST and real-time gateway APIs, signed federation events, local operator/admin API, and bot event/capability API. Version schemas from day one and provide SDKs for TypeScript and Rust.
- Exclude Nitro, paid feature gates, shops, collectibles, quests, ads, engagement ranking, telemetry-based recommendation, and centralized content policing.

## Delivery and Quality Plan

1. Establish the shared crypto/protocol core, portable and local identity flows, device linking, recovery kit, encrypted storage, server container, and admin setup flow.
2. Build the complete text/community layer: channels, messaging, attachments, permissions, moderation metadata, local search, retention, reports, and exports.
3. Add real-time media, events, stage channels, streaming, screen share, and E2EE WebRTC relay support.
4. Add federation, directory publishing, open/allowlisted remote-server policies, bots, web client, documentation, upgrade tooling, backups, and observability that never captures message content.
5. Release source, reproducible builds, signed desktop installers, SBOMs, threat model, privacy documentation, deployment guide, vulnerability reporting process, and community security review before production availability.

## Test Plan

- Verify that servers, federation peers, SFUs, storage providers, and push services cannot decrypt message, attachment, or media payloads.
- Test cross-device joining, recovery-kit restoration, membership rekeying, history-sharing policies, deletion/retention expiry, offline delivery, and local-account linking.
- Exercise permissions, moderation reports, bot capability boundaries, federation allowlists/blocklists, invite abuse controls, and data export/deletion.
- Run end-to-end compatibility suites across Windows, macOS, Linux, and the browser; include cross-server text, file, voice, video, stream, and screen-share scenarios.
- Load-test encrypted gateway delivery, large channels, concurrent voice rooms, federation retry/idempotency, server upgrades, backup/restore, and failure recovery.

## Assumptions

- The initial parity release includes desktop and web clients; iOS and Android follow after protocol stability.
- “Discord parity” means the original community and communication experience, not commercial, game, or creator-monetization systems.
- Security readiness relies on open-source/community review and a public vulnerability program rather than a launch-blocking independent audit.
- The current workspace is greenfield, so the implementation begins with product, protocol, and deployment foundations.
