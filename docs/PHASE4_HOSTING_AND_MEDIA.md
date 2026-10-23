# Phase 4: hosted deployment and media

Scope agreed 2026-10-16; implementation started 2026-10-20 with configurable
private S3 storage, followed by native IaC, deployment tooling and production
browser/server images with local acceptance. The first encrypted 1:1 voice,
camera and screen-video implementation now has local synthetic-media acceptance;
[the call guide](DIRECT_CALLS.md) records its limits. No Railway resources, public
website or product media release has been deployed. LiveKit integration is now
implemented; its 25-person stable-media/load release gate is still being tested.
The [three-person admission and key foundation](GROUP_CALLS.md) provided local
unit/crypto evidence before the interface and media integration.
The subsequent [private group voice slice](GROUP_VOICE.md) implements the mesh
and interface with independent joins and continuing calls after departure.
The [community voice-room slice](COMMUNITY_VOICE.md) adds persistent channels
with up to four simultaneous people, signed public occupancy and client-only
pair keys. Its local direct/relay/native/revocation evidence is separate from
the larger SFU and physical/network acceptance gates. The subsequent
[room video slice](ROOM_VIDEO.md) adds explicit camera/screen consent and
simultaneous screen video. Independent media permissions, stage consent,
device controls, computer audio, events and isolated shared playback are now
implemented. Spotify remains disabled for this release by the user's decision.
See [the current completion checklist](PHASE4_RELEASE_CHECKLIST.md).
Its current local acceptance is recorded separately; physical and internet gates
remain open. Group format support is distinct from online presence.
The [roadmap](ROADMAP.md#phase-4-cloud-hosting-voice-video-and-events)
tracks the phase; [ADR 0004](adr/0004-media-feasibility.md) records the isolated
media spike and its remaining product/platform gates.

Phase 3 is complete. The user requested the Stage 4 start on 2026-10-20; cloud
storage implementation proceeds while the separate clean-machine Host/Join
acceptance remains open. Cloud deployment is an additional hosting choice; it
does not replace the local installer target or close that acceptance checkpoint.

## Deployment shape

| Component | Planned location and responsibility |
| --- | --- |
| Hearth backend | Railway: accounts, authorization, encrypted message delivery, gateway, call signaling and media-token issuance. |
| PostgreSQL | Railway private networking: durable account/community state and encrypted event records. |
| Attachment bucket | Railway private S3-compatible bucket: ciphertext and encrypted previews only. |
| Server data | Persistent backend volume at `/var/lib/hearth`: `server.key`, `opaque.setup` and `setup.code`. |
| Browser client | Optional Railway service serving the production React/WASM build over HTTPS. Desktop clients can connect without it. |
| Direct media | Small-call WebRTC connections between authorized client devices; media bypasses Railway. |
| TURN | Reachable managed or self-hosted relay when direct connectivity fails or relay-only privacy is selected. |
| LiveKit SFU | Optional managed or self-hosted service for larger rooms, streams and stages. |

The backend and website may have separate public origins. Wire discovery, REST,
gateway WSS, attachment HTTPS and the optional media endpoint explicitly; avoid
shipping localhost defaults in a hosted client. A shared-origin proxy may be
selected during packaging if it simplifies reliable deployment.

## 4A. Railway infrastructure and guided provisioning

The [cloud deployment guide](CLOUD_DEPLOYMENT.md) describes the implementation,
pinned tools, public settings, filtered upload snapshot and production images.
The user chose to keep provisioning local on 2026-10-20. The checklist separates
implemented local pieces from the live provider flow that remains unverified.

- [x] Define the environment in native `.railway/railway.ts`: backend, PostgreSQL,
  private bucket, server volume and optional website. Pin the supported CLI/SDK
  and container versions after rechecking current provider documentation.
- [x] Use the repository root as the Rust build context and the server Dockerfile
  path explicitly. Set the listener/target port and `/health` readiness check.
  Resolve volume ownership without making secret files broadly accessible.
- [x] Wire database and bucket credentials through provider references/secrets.
  Keep database ingress private, federation opt-in, browser origins exact, and
  secret values out of IaC source, build arguments, committed plans and diagnostics.
- [ ] Provide a deployment command that signs into Railway, selects or creates
  the intended project/environment, offers desktop-only or desktop-plus-web,
  previews the plan, applies it and waits for actual build/runtime readiness.
  Report project, public addresses and actionable failures without secret values.
- [ ] Handle generated Railway domains through a bounded CLI/API bootstrap step;
  they are not part of the documented native IaC declaration. Support optional
  custom domains with explicit DNS instructions and certificate readiness checks.
- [ ] Retrieve the owner bootstrap code through authenticated operator access,
  hand it to the protected owner-enrollment flow, then clear it from that flow.
  Owner password, device keys and recovery-kit creation remain client operations.
  Do not expose the code via public discovery, URLs or ordinary deployment logs.
- [ ] Make retries reuse the same resources, bucket and keys. An existing account
  database without its matching keys must fail closed and request restoration.
  Run migrations and secret initialization at runtime when volumes are mounted.
- [ ] Preview updates/destructive changes; preserve data by default. Distinguish
  a healthy backend, a reachable website and working file/media paths in status.

Infrastructure should be reproducible without checking secrets into Git. Railway
account/billing authorization and user-selected credentials remain external inputs.
IaC application alone does not establish a successful application deployment.

## 4B. Storage compatibility

The first implementation slice removes the fixed bucket/region/addressing
assumptions from `attachments.rs`. Configuration and supported constraints are
in [the storage guide](STORAGE_CONFIGURATION.md). Defaults preserve SeaweedFS;
managed buckets can disable all bucket-level probes/creation. New Railway
buckets use provider-assigned names and usually virtual-hosted addressing;
select the style shown in the provider's Credentials tab.

The [2026-10-20 local acceptance record](evidence/phase4-storage-local-2026-10-20.json)
captures configuration/signing/mock tests, an existing custom SeaweedFS bucket
transfer through the ciphertext size limit, and all 94 application regression
checks. This does not validate real Railway storage or browser CORS.

- [x] Add configurable bucket name, signing region, path versus virtual-hosted URL
  style and use-existing versus create-if-missing behavior. Preserve current
  SeaweedFS defaults and avoid attempting to create a provider-managed bucket.
- [x] Support provider-issued credentials without logging them or replacing them
  on retry; validate configuration and document supported provider constraints.
- [ ] Configure browser CORS and public HTTPS presigned endpoints. Keep buckets
  private, with short-lived, scoped upload/download URLs and no public listing.
- [ ] Verify the Phase 3 50 MB file limit end to end, including ciphertext overhead,
  browser upload headers and any proxy/provider request limits.
- [ ] Verify authorization, tampering, incomplete uploads, expiry, retention,
  server-owner deletion and account-deletion cleanup against real Railway storage.
  Keep the local SeaweedFS regression path working.

## 4C. Browser client hosting

Local Linux Docker/Chromium acceptance covers these implemented image/configuration
items. Railway, cross-platform desktop/browser and independent-network acceptance
remain separate gates; the website has not been deployed publicly.

- [x] Build a production image containing the React UI and matching crypto/WASM;
  serve static assets with a production web server, not the Vite development server.
- [x] Configure server discovery/default address, REST and gateway URLs, exact
  backend CORS origins, HTTPS/WSS and attachment origins. Keep secrets out of the
  JavaScript bundle; only public connection settings belong there.
- [x] Verify SPA deep links, worker/WASM MIME types, CSP and asset caching. New
  deployments must not mix incompatible application/crypto assets from old caches.
- [ ] Support both hosted browser and packaged desktop clients on the same backend,
  with existing approved-device linking and local encrypted vault/history rules.
- [x] Explain website-host trust: a provider able to replace delivered JavaScript
  can affect client-side encryption. Desktop binaries have a separate update trust
  boundary. Neither path moves normal search, previews or media keys to the server.

## 4D. P2P, TURN and SFU media

**2026-10-20 stopping point:** authenticated two-account calls, client-only
MLS-exported SFrame keys, camera/screen-video controls, permission enforcement,
short-lived TURN credentials and relay-only policy are implemented. The retained
local direct report passes 14 synthetic-media checks. An earlier loopback UDP
relay run passed, but the final matrix was interrupted by a build-triggered page
reload and TCP was not reached. Resume with a frozen local matrix, then physical
and independent-network acceptance. Railway stays paused. See
[the checkpoint record](evidence/phase4-direct-calls-local-2026-10-20.json).
The combined requirements below remain open for group calls and full acceptance.

**2026-10-21 follow-up:** the frozen local matrix now passes 14 direct, 15
TURN/UDP and 15 TURN/TCP checks. Both relay peers positively report selected relay
candidates and zero gathered host candidates. This completes the interrupted
local matrix above. Physical capture, installed product media, independent
networks and TURN-TLS remain open. The [new record](evidence/phase4-direct-calls-local-2026-10-21.json)
does not replace the frozen prior checkpoint or claim public connectivity.

**2026-10-21 native follow-up:** an opt-in compiled Tauri/Windows WebView2 fixture
passes 15 direct, 16 TURN/UDP and 16 TURN/TCP checks with the product call UI,
WASM/MLS and native SQLCipher message storage. Each passing run drains native
operations and removes its temporary credentials/files. Synthetic tracks and an
autoplay override leave physical capture, picker permissions, installed release
behavior and independent-network/platform acceptance open. See
[the native record](evidence/phase4-native-direct-calls-local-2026-10-21.json).
Railway remains paused; the installed 0.3.6 client does not contain this media slice.

**2026-10-22 recovery follow-up:** established same-epoch calls can restart ICE
using the existing capture, peer connection and SFrame workers/counters. Either
peer may initiate; fixed glare roles and encrypted SDP transaction markers bind
answers and reject replay. Authorization, selected relay routes and advancing
authenticated media are rechecked, with an independent 20-second capture-ending
deadline. Mute and stopping active video/share remain available while reconnecting.
See [the recovery record](evidence/phase4-call-recovery-local-2026-10-22.json).
The automatic-trigger fixture injects a state event rather than a physical outage.
Full messaging/network reconnection, MLS in-call rekey and group media remain open.

**2026-10-22 key-update follow-up:** the selected 1:1 pair can now keep an
established call through a verified MLS linked-device join. Messaging waits for
worker pause acknowledgment before the commit; new transaction/epoch-bound
exporter keys are installed while paused and confirmed before media resumes.
Authorization loss, overlapping epochs or a stalled handshake end capture.
See [active call key updates](CALL_KEY_UPDATES.md) and
[the key-update record](evidence/phase4-call-rekey-local-2026-10-22.json).
This advances the 1:1 slice; general group-call rekey, physical/network/platform
acceptance and full messaging reconnection remain open.

Haven documents direct voice by default with an optional large-server relay.
The earlier Hearth parity table omitted this topology requirement; the existing
LiveKit spike is an SFU experiment and does not implement direct peer connections.

- [ ] Add a direct-preferred mode for 1:1 and bounded small-group voice, video and
  screen sharing. The backend authorizes and relays bounded signaling; clients
  exchange media through WebRTC. Authenticate peer devices and bind signaling to
  current room membership rather than trusting arbitrary peer offers.
- [ ] Discover usable routes with ICE/STUN and fall back to TURN when direct paths
  fail. TURN relays encrypted peer traffic; it is distinct from the SFU that
  forwards selected streams for larger rooms.
- [ ] Offer relay-only privacy with an explanation that direct peers can learn
  network addresses. Enforce relay-only candidate gathering/signaling and media
  behavior; never silently switch that user to a direct connection.
- [ ] Measure client upload/CPU and establish supported mesh limits. Define when
  to offer or select LiveKit and how to reconnect/transition without losing
  authorization, leaking plaintext or leaving removed members with fresh keys.
- [ ] Keep media keys client-only, derived through the MLS exporter and rotated
  with membership changes. Token/API/TURN secrets authorize infrastructure;
  they are not media decryption keys. No publication without encryption readiness.
  Validate the selected encoded-frame/SFrame profile and interoperability under
  ADR 0004 instead of treating the synthetic spike as production proof.
- [ ] Add room/device-scoped, short-lived LiveKit tokens and TURN credentials,
  permission enforcement and active participant removal. Do not let existing calls
  bypass bans, kicks or loss of channel access.
- [ ] Package self-hosted LiveKit/coturn options and evaluate LiveKit embedded TURN.
  Support external SFU/TURN configuration for Railway, with API credentials held
  only by the backend and public endpoints supplied to authorized clients.

### Railway media deployment boundary

Railway's documented public ingress covers HTTPS/WebSockets and raw TCP. That is
enough for Hearth's signaling, but does not establish the public UDP reachability
used by a normal LiveKit/TURN deployment. Do not interpret a working WebSocket or
an exposed Docker UDP port as evidence that public media connectivity works.

The baseline cloud design keeps signaling/chat/files/web on Railway and uses a
managed media service or a separately provisioned VM with public media ports for
TURN/SFU. Direct P2P media can work without either media relay when the clients'
networks permit it; reliable internet connectivity still needs a tested fallback.
A TURN-only service can support small P2P calls without deploying an SFU.

Before selecting a media provider, recheck Railway's ingress support, LiveKit's
ICE/public-address behavior, TURN TLS/UDP requirements, regions, limits and costs.
A TCP-only Railway SFU is an optional feasibility investigation, not the promised
default. A TURN service alone does not make an unreachable SFU reachable.

IaC should wire the chosen external media endpoints and secrets into Railway.
Provisioning resources at another provider requires its own supported IaC/API
and account authorization; Railway IaC does not provision arbitrary external VMs.
Show separate readiness for signaling, direct connectivity, TURN and SFU, and
separate cost estimates for application hosting, media compute and bandwidth.

## Work order and exit checks

Implement 4A-4C as the first cloud slice, then 4D and the existing Phase 4 media,
streaming and event features. Keep all checklist items open until measured.

- [ ] Fresh deployment from the documented entry point serves healthy discovery,
  owner enrollment and an optional functional website, without manual secret edits.
- [ ] Repeat apply/retry causes no duplicate resources or key rotation. Restart,
  redeploy and update preserve accounts, server identity and encrypted objects.
- [ ] A browser user and desktop user on separate networks enroll/link and exchange
  encrypted DMs/community messages and files, including file-limit and deletion checks.
- [ ] Restore PostgreSQL, matching server keys and encrypted objects onto a fresh
  deployment. Preserve the advertised identity and validate presigned endpoints.
  Server backups do not substitute for users' recovery kits or local history.
- [ ] Force and verify direct, TURN-only and SFU paths using connection statistics;
  test NAT/CGNAT, blocked UDP/TURN-TLS, network changes, reconnects and relay-only IP
  behavior. Test expired tokens and removal/rekey while a call is active.
- [ ] Canary/negative tests cover signaling, storage, logs and TURN/SFU traffic:
  no plaintext, media keys, persistent provider secrets or bootstrap capabilities.
- [ ] Complete the original 25-person voice plus screen-share target through the
  SFU and platform/media requirements, with the documented Linux browser fallback.
  Record measured stability, client upload, server CPU and media bandwidth/cost.
- [ ] Document backups, rollback/recovery, usage limits and provider trust. Label
  prices/limits with their research date and recheck them before deployment.

Follow the [Actions budget standard](CI_STANDARD.md): validate locally first;
real cloud provisioning and hosted milestones are explicitly requested and scoped.
Report local, real Railway, real-network media and final platform results separately.
No cloud deployment or hosted CI run is authorized merely by this planning update.

## Provider and parity references

Implementation follow-up, 2026-10-22: [optional SFU rooms](SFU_ROOMS.md), bounded
room/device-scoped tokens and [explicit computer audio](COMPUTER_AUDIO.md) are now
implemented locally. The optional LiveKit/coturn Compose package has disposable
startup/configuration checks. These follow-ups do not close the original
25-person full-platform, public routing, cost or Railway acceptance gates above.

Reviewed 2026-10-16 for scope; revalidate APIs, capabilities and terms during implementation.

- [Railway native IaC](https://docs.railway.com/infrastructure-as-code) and
  [resource reference](https://docs.railway.com/infrastructure-as-code/reference).
- [Railway domains CLI](https://docs.railway.com/cli/domain),
  [buckets](https://docs.railway.com/storage-buckets) and
  [volume permissions](https://docs.railway.com/volumes#permissions).
- [Railway public networking](https://docs.railway.com/networking/public-networking/specs-and-limits)
  and [TCP proxy](https://docs.railway.com/networking/tcp-proxy).
- [LiveKit media ports](https://docs.livekit.io/transport/self-hosting/ports-firewall/),
  [deployment/TURN](https://docs.livekit.io/transport/self-hosting/deployment/) and
  [E2EE](https://docs.livekit.io/transport/encryption/).
- [Haven voice/P2P and TURN](https://github.com/ancsemi/Haven/blob/main/GUIDE.md#voice-chat),
  [WebRTC peer connections](https://webrtc.org/getting-started/peer-connections) and
  [TURN](https://webrtc.org/getting-started/turn-server).
