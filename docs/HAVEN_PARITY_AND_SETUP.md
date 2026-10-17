# Haven parity and simple Hearth setup

Reviewed 2026-10-12. Product direction requested by the user: Hearth should cover
Haven's features and be straightforward for an average person to install and host.
This is a requirements comparison, not a completed implementation or a security
audit of Haven. Haven's documentation changes; recheck it before implementation.

Sources: [Haven feature list](https://github.com/ancsemi/Haven),
[setup guide](https://github.com/ancsemi/Haven/blob/main/GUIDE.md), and
[desktop features](https://github.com/ancsemi/Haven-Desktop).
Hearth status below uses its roadmap and local validation available on this date.

## Feature coverage

The following Haven capabilities are advertised by its authors. The Hearth column
separates existing work from planned work; it does not claim full feature parity.

| Capability | Hearth coverage or required work |
|---|---|
| Channels, forums, threads, polls, reactions, pins, edits, mentions, search, previews | Text foundations exist; Phase 3 forums/polls are implemented. All 41 local two-client/private-S3 browser checks pass. Search stays local to decrypted history. Previews currently produce address-derived cards. |
| DMs and encrypted messaging | DMs, groups and community messages use E2EE. Preserve this throughout parity work. |
| Roles, channel permissions, sanctions, slow mode, audit | Phase 3 implementation and HTTP/Windows coverage exist. Preserve signed authority and scoped moderation. |
| Automod, link filtering, IP bans | Add explicit moderation and network-abuse targets. Content inspection belongs in an authorized moderator client or bot rather than ordinary server-side plaintext processing. |
| Voice, video, screen sharing, watch parties | Phase 4. Add direct P2P small calls with STUN/TURN fallback and relay-only privacy, plus optional LiveKit SFU for larger rooms. Include simultaneous sharing and clear speaker/microphone controls. |
| Per-app audio, mid-call device switching, tray, native notifications | Explicit desktop acceptance targets for media and release work. Verify each OS independently. |
| Synchronized listening and rich presence integrations | Target Spotify, YouTube, SoundCloud, Steam and Last.fm where supported. Identity linking and playback behavior need design and remain opt-in. |
| Themes, plugins, stickers, personas, soundboard, avatar styling, branding, density, localization | Custom emoji and profiles exist. Expand customization after the core UI is consistent; retain the current default color scheme. |
| Discord import and bidirectional bridge | Add migration and interoperability work. Imported content needs honest provenance; bridge disclosure must be explicit. |
| Bots, webhooks, commands and moderation API | Phase 6 foundations are planned. Bots require explicit capabilities and conversation membership to read encrypted content. |
| Backups, restore and in-app updates | Move user-facing operations earlier than the current Phase 6/7 release work. Recovery kits already exist but are not server backups. |
| SSO, MFA, guests, rotating invitations | OPAQUE, signed devices and expiring invitations exist. Additional account modes need a design compatible with local encryption keys. |
| Push notifications and UnifiedPush | Generic Web Push is implemented and locally tested; actual provider/OS delivery remains manual acceptance. Add delivery adapters without message previews by default. |
| Tunnel-assisted hosting and direct hosting | Add a guided reachability flow. Current public-IP HTTPS setup still requires technical steps. |
| Browser, desktop and mobile clients | Desktop/web first remains the current sequence. Phase 4 adds optional production browser hosting alongside Railway IaC, private storage and the backend. Mobile belongs in the eventual parity target after protocol stability. |

These targets are drawn from the [Haven feature list](https://github.com/ancsemi/Haven)
and [desktop README](https://github.com/ancsemi/Haven-Desktop). Exact theme/language
counts and platform release status are deliberately not treated as fixed requirements.

## The installation standard

Primary user journey: **Install → Host or Join → Share an invite.**

The [first guided client pass](GUIDED_SETUP.md), implemented 2026-10-15, provides
Host/Join entry, readiness for an existing host and a single pasted invite through
account creation and signed community admission. Automatic service installation,
native click-to-open links and independent outside reachability are still open.

1. A normal installer opens Hearth and asks whether to host on this PC or join
   someone else's server. Advanced deployment remains available separately.
2. Hosting creates the server owner through the UI. It prepares required services,
   storage, migrations and server identity without manual commands or editing an
   environment file. Infrastructure choices remain implementation work.
3. The wizard explains local-only versus internet access in plain language. It
   checks firewall, routing, HTTPS and outside reachability before saying friends
   can join. It diagnoses CGNAT and router loopback limitations specifically.
4. A supported tunnel/relay option can simplify remote hosting. Provider choice,
   availability and trust boundaries must be explicit. It must preserve Hearth's
   encryption model; a TLS-terminating provider also gains trust over delivery of
   the web client, which is more than a metadata-only relationship.
5. One invite carries the server address and enrollment capability. A friend opens
   it, creates their account, joins the intended community and can start a DM.
   They should not need to interpret ports, server/community distinctions or setup codes.
6. Hearth runs in the background, starts automatically when the host opts in, and
   shows a clear server status with useful recovery actions. The design must also
   account for approved-device availability for encrypted membership admission;
   a running server process alone does not establish that new members can chat.
7. Update, backup and restore are ordinary UI actions. An update creates a verified
   backup first and has a tested recovery path; it preserves server identity and data.
8. An interrupted install or restart can be retried without replacing keys,
   duplicating services or losing data. Diagnostic exports omit secrets and messages.

This is an acceptance target, not a promise that every router can be configured
automatically. Haven's [setup guide](https://github.com/ancsemi/Haven/blob/main/GUIDE.md)
is a reference for reducing prerequisites, not Hearth's installation instructions.

## Acceptance before calling setup easy

- A nontechnical person installs on a clean supported PC and hosts through the UI
  without a terminal, development tools or manually installed dependencies.
- A second nontechnical person joins from a different household through one invite
  and exchanges encrypted DMs; the wizard verifies the external connection first.
- Rebooting both PCs preserves server identity, accounts and readable history.
- Failed setup explains the next action and preserves data; retry succeeds.
- Updating and restoring onto a fresh host work through the documented UI flow.
- Windows, macOS and Linux receive actual installation/runtime evidence, rather
  than treating one platform's build as evidence for the others.

## Why federation is later

Federation lets independently hosted servers relay messages and membership across
communities, so people can stay with their chosen operator and still communicate.
It requires cross-server identity, delivery/retry rules, abuse controls and encrypted
membership coordination. It does not configure routers or issue HTTPS certificates.
One shared server is enough for the current friends-at-two-houses test; the guided
Host/Join setup is the more immediate acceptance target. Phase 5 remains the planned
federation phase, with closed/allowlist/open policies and cross-server blocklists.

## Work order

Scope clarification, 2026-10-16: Haven's [voice guide](https://github.com/ancsemi/Haven/blob/main/GUIDE.md#voice-chat)
documents P2P voice by default and an optional large-server relay. The earlier
comparison omitted that distinction. [Phase 4](PHASE4_HOSTING_AND_MEDIA.md) now
explicitly plans direct P2P, TURN fallback and optional SFU media, preserving
Hearth's all-message/media E2EE requirement. It also adds Railway deployment,
storage compatibility and browser hosting; these are unimplemented requirements.

Finish current Phase 3 validation and the menu pass. Then establish the Host/Join
installer and reachability workflow as a dedicated checkpoint before expanding
media and integrations. Carry the parity rows into the corresponding roadmap
phases, preserving all-message E2EE, community control and separate daily-use and
management menus.

Current validation: the HTTP/private-S3 suite passes 90 outcomes and the packaged
Windows/private-S3 client passes 17. All 41 two-client browser/private-S3 checks pass.
Tool access is restored. GitHub checks currently stop before any jobs start, so
current hosted macOS/Linux validation remains pending. Phase 3 stays in validation.
