# Encrypted direct calls

The subsequent [computer-audio implementation](COMPUTER_AUDIO.md) adds an explicit
screen-audio option and a fourth encrypted source slot. Current media capability
format 5 gates that layout before capture. Historical checkpoints below retain
their original source layout and evidence.

Implementation started 2026-10-20. This is the local Phase 4 product slice for
two-person voice calls, with camera and video-only screen sharing on the same
connection. It does not install an update over the user's Preview 0.3.6 or change the user's
running host. Railway remains paused. The separate
[private group voice implementation](GROUP_VOICE.md) adds independent joins and
survivor rekey; its evidence and limits are recorded there. LiveKit remains open.

## Use in Preview 0.4.0

1. Open an encrypted DM with one other account. Both participants need an approved
   device, a current backend and a runtime with `RTCRtpScriptTransform` support.
2. Choose **Voice call**, select their device and review direct/relay-only privacy.
   The microphone starts when you press **Start voice call**.
3. The other device receives an explicit **Answer call** / **Decline call** choice.
   An incoming invitation does not start capture.
4. After connection, use microphone mute, **Turn camera on**, or **Share screen**.
   Camera and screen capture require separate user actions. Screen audio is not
   included in this slice. The operating system's stop-sharing action also stops
   that capture track.
5. Brief media-route interruptions show **Reconnecting encrypted call…** and
   attempt recovery using the existing capture. Microphone mute, stopping an
   active camera/share and **End call** remain available during recovery.
6. **End call**, sign-out or locking messaging stops local capture. An ended call
   requires a new invitation and consent; recovery never reopens capture.

Media support is checked at runtime. Unsupported desktop webviews need a supported
browser; the existing Linux fallback remains in place. Physical-device permission,
capture-picker and platform testing remain required before release acceptance.

For compatibility, every device in the MLS conversation must announce a current
client within a 90-second lease. Current capable clients renew during messaging
maintenance. A missing lease blocks new call signaling and explains the upgrade
requirement. This deliberately conservative preview gate prevents an older client
from receiving a private content variant it cannot decode. Keep other linked
devices open on the current client or remove unused devices before calling.
Leases are in memory and reset on backend restart. They are not a media key or
proof of a working microphone/network route.

## Signaling, encryption and authorization

Call offers, answers, heartbeats and hangups are client-only `CallSignal` values
inside signed MLS application messages. The backend relays ordinary encrypted
control envelopes and applies existing session, approved-device, conversation
membership and DM-block checks. It never parses SDP, ICE candidates or media keys.
Control envelopes do not become visible chat messages, searchable history or
report evidence. Fresh inbound notifications are drained from volatile crypto
state rather than restored from message history; expired invitations are ignored.
An unsent control envelope may remain in the existing encrypted outbox.

The two selected devices must belong to different accounts in a two-account DM.
Each call binds a fresh random ID, server, conversation, MLS epoch, caller device,
callee device and relay-only policy into exporter-derived base material. That
material moves only between client memory and client workers. It is neither a
provider token nor a field in a server request. Other approved MLS devices remain
part of the conversation's encryption trust boundary.

Encoded transforms implement the RFC 9605 AES-128-GCM/SHA-256 suite (0x0004), with
authenticated SFrame headers, full encoded-frame payload encryption and a bounded
replay/reordering window. Random sender KIDs have separate direction namespaces
and audio/camera/screen slots. A stream's counter is never reset by muting or
replacing its track. Worker readiness precedes publishing capture; unsupported
transforms, worker failure or encryption failure block publication. Invalid
received frames are discarded. There is no plaintext media fallback.

The Hearth exporter context and track/KID assignment form an application profile;
passing RFC vectors does not establish interoperability with another SFrame stack
or replace a security review. The first video profile selects VP8 explicitly.

Clients recheck authenticated membership, device approval, blocks and compatibility
every ten seconds. Encrypted peer heartbeats run every five seconds. Verification
or heartbeat expiry stops capture within the 25-second watchdog window, including
while a request is stalled. An observed MLS device change pauses old-key media
and starts a bounded key update when both selected devices remain authorized.
Missing confirmation, access loss or overlapping changes end capture. See
[active call key updates](CALL_KEY_UPDATES.md). Preview calls have a 50-minute limit so relay
credentials can be refreshed by starting a new call.

## Bounded connection recovery

An established call reacts to failed/disconnected media transport by restarting
ICE after a two-second disconnect grace period (immediately for failure). This
requires working authenticated messaging and an unchanged MLS epoch. Either peer
can initiate. Simultaneous offers converge using fixed caller/answerer roles and
rollback; random transaction markers inside encrypted SDP bind each answer to
one pending restart. Duplicate, stale and mismatched restart transactions cannot
resume an ended call. Work is limited to six distinct transactions per minute.

The same peer connection, capture tracks, SFrame workers, keys and counters
remain in use. A restart never requests microphone, camera or screen access.
Both peers recheck device/DM authorization before accepting new descriptions.
Relay-only policy stays fixed and the selected relay is checked again before
showing connected. Recovery also requires fresh authenticated media frames.
A separate 20-second deadline stops capture even when a request hangs; the
existing authorization/heartbeat watchdogs and 50-minute limit still apply.
An epoch change during network recovery or revoked access ends the call.

Both peers should use the current development build. Earlier development call
controllers ignore restart offers for active calls and cannot complete recovery.
Local acceptance changes real ICE credentials and checks caller/callee restarts,
simultaneous offers, decoded camera/audio continuity and unchanged capture/key
acquisition counts. The automatic trigger test injects a disconnect state event;
it does not interrupt a physical network. Real outage and network-switch testing,
TURN-TLS and full signaling reconnection remain open. In-call key rotation for
verified 1:1 device changes is documented separately above.
The [2026-10-22 recovery checkpoint](evidence/phase4-call-recovery-local-2026-10-22.json)
records the route matrix, focused safety regressions and the initial relay-fixture
quota failure. Historical call and native-runtime reports remain unchanged.

## Optional STUN/TURN configuration

The backend accepts these private operator settings:

| Variable | Meaning |
| --- | --- |
| `HEARTH_STUN_URLS` | Up to four comma-separated `stun:` / `stuns:` endpoints. |
| `HEARTH_TURN_URLS` | Up to four comma-separated `turn:` / `turns:` endpoints; optional `transport=udp` or `transport=tcp`. |
| `HEARTH_TURN_SECRET` | Private coturn REST shared secret, 32–256 bytes; required with TURN endpoints. |

Nothing is configured by default: calls gather host candidates without contacting
an automatic public STUN service. Internet/NAT reliability needs an operator's
reachable relay. Endpoint credentials, paths, fragments and arbitrary query
parameters are rejected. Configuration errors and Debug output do not echo secrets.

`GET /api/v1/chat/media/{device}` requires a session and an approved device owned
by that account. It returns no-store ICE settings and one-hour coturn REST
credentials with a random username scope. The static shared secret stays on the
backend. Relay authorization is not a media decryption key. Already issued TURN
credentials remain usable until expiry, so operators must also set relay quotas
and network policy. Allow for overlapping ICE-generation allocations during
restarts; overly small quotas can prevent a new route or a subsequent call until
old allocations are removed. `GET /api/v1/chat/call-ready/{conversation}/{device}` checks
DM access and current client leases without returning device capabilities publicly.

Relay-only requires a configured TURN endpoint, sets `iceTransportPolicy: relay`
on both peers and checks the selected local candidate before showing connected.
It never falls back to direct connectivity. Direct mode permits ICE to select a
relay when available. Direct peers may learn each other's network addresses;
the call setup dialog explains that choice.

## Local checks and remaining acceptance

```powershell
$env:PGBIN='C:\Program Files\PostgreSQL\17\bin'
npm run test:calls
npm run test:calls -- --turn
npm run test:calls -- --turn-tcp
# Windows WebView2, compiled opt-in fixture with isolated native message storage:
npm run test:calls -- --desktop
npm run test:calls -- --desktop --turn
npm run test:calls -- --desktop --turn-tcp
```

The disposable fixture uses the actual product WASM, OPAQUE accounts, approved
devices, MLS delivery and call controller in Chromium. Synthetic oscillators and
canvas tracks replace physical capture; screen capture is injected only into the
development harness. It never opens a real microphone, camera or desktop picker.
The harness HTML is excluded from normal production builds. Its module requires
Vite development mode or explicit `HEARTH_DIRECT_CALL_HARNESS=1`; the native runner
builds it with the `phase1-acceptance` fixture feature, a dedicated executable and
separate WebView data directory. The fixture does not register normal hosting or
deep-link handlers. Native message-store writes use temporary SQLCipher storage
and dedicated test-service credentials. Passing reports require the native
storage barrier to drain operations and confirm credential/file removal.
The test uses synthetic capture and an autoplay override, so it does not validate
physical-device consent, OS screen pickers or normal autoplay restrictions.
Reports under `target/direct-calls-evidence/direct/`,
`turn-udp/`, `turn-tcp/` and their `native-` counterparts contain fixed
checks/counts rather than SDP, addresses, tokens, passwords or media keys.

The [2026-10-21 matrix](evidence/phase4-direct-calls-local-2026-10-21.json)
passes 14 direct, 15 forced TURN/UDP and 15 forced TURN/TCP outcomes, including
selected-relay verification and zero gathered host candidates on both relay peers.
TCP refers to the client-to-TURN transport, not TURN-TLS or all-TCP peer traffic.
The [2026-10-20 checkpoint](evidence/phase4-direct-calls-local-2026-10-20.json)
preserves the earlier interrupted attempt. Run these commands sequentially
with no concurrent source edits or WASM rebuilds. The pinned disposable coturn
fixture binds only loopback and is a development profile, not a deployment recipe.

The [native Windows matrix](evidence/phase4-native-direct-calls-local-2026-10-21.json)
passes 15 direct, 16 forced TURN/UDP and 16 forced TURN/TCP checks, including
verified native fixture cleanup. Both relay peers select relays with zero host
candidates. A follow-up browser direct regression passes all 14 checks. This is a
compiled acceptance executable, separate from the installed sidebar-only 0.3.6
Preview. Default production builds continue to exclude the synthetic harness.

Real physical capture and permissions, installed desktop UI, supported-browser/OS
interoperability, real TURN/TURN-TLS routes,
CGNAT/firewalls and independent-network
calls remain distinct acceptance gates. Camera/screen toggles and synthetic frame
decoding do not prove those properties. Since this historical checkpoint,
LiveKit/SFU, group calls, separate screen audio, device switching and bounded
in-call rekey have been implemented and locally tested. See the
[release checklist](PHASE4_RELEASE_CHECKLIST.md) for the remaining capacity,
publication and manual acceptance gates.

Primary implementation references rechecked 2026-10-20:
[RFC 9605](https://www.rfc-editor.org/rfc/rfc9605.html),
[WebRTC encoded transforms](https://www.w3.org/TR/webrtc-encoded-transform/),
[coturn REST credentials](https://github.com/coturn/coturn/blob/master/README.turnserver).
