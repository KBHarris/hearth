# ADR 0004: encrypted media feasibility and platform gates

- Status: provisional; WebView2, Chrome and Safari pass; Firefox and WKWebView gates open
- Date: 2026-10-07

## Decision

Continue evaluating LiveKit using its client encryption worker and encoded transforms.
Keep the experiment separate from the product UI. Require encryption capability and the
worker's enabled acknowledgement before publishing. A missing capability must block media;
there is no plaintext fallback.

For Linux, offer media through a supported browser. The tested Ubuntu 22.04 WebKitGTK
runtime passed native MLS IPC but has no `RTCPeerConnection` or encoded transform API,
so the diagnostic blocks media before publication. Retest newer runtimes before enabling
desktop media. This result does not cover every WebKitGTK version. A native media implementation would need its own framing,
key-distribution, interoperability, and performance checks before selection.

The plan's SFrame profile remains an architectural intent. LiveKit SDK encryption passing
this experiment does not establish SFrame interoperability or an MLS exporter integration.

## Measured evidence

The [saved runtime report](../evidence/media-chromium-windows-2026-10-07.json) records a
9.287-second pass on Windows in the Codex in-app browser, Chromium 154. The fixture used
`livekit-client` 2.22.3 and LiveKit server 1.13.8. It generated a 320×180 video at 10 FPS and
a silent 440 Hz audio source; no camera, microphone, screen, or real account was accessed.

| Runtime | Result | Scope |
|---|---|---|
| Windows, in-app Chromium 154 | Pass | Worker encryption, decoded audio/video, wrong key, fresh-key replacement, stale key |
| Windows Tauri WebView2 154 | Pass | Bundled harness, native MLS IPC, real Hearth discovery, encrypted audio/video and key changes |
| macOS Safari 26.6.2 | Pass | Actual browser; encrypted audio/video and wrong/fresh/stale keys |
| macOS WKWebView | Pending | Requires actual execution |
| Linux WebKitGTK, Ubuntu 22.04 | Media blocked | Native MLS IPC passes; WebRTC/encoded transforms unavailable; use a supported browser |
| Linux Chrome 154 | Pass | Actual headless browser; encrypted audio/video and wrong/fresh/stale keys |
| Linux Firefox 157 | Pending | Connection to the loopback SFU fails; fixture investigation in progress |

The matching receiver decoded 61 video frames and recovered nonzero audio PCM (peak 0.1,
matching the generated source). The wrong-key receiver received forwarded RTP, decoded zero
video frames, and reported six encryption rejections. Giving it the original key then
enabled decoding. After only the publisher and authorized receiver received a fresh random
key, the authorized receiver continued decoding; the stale-key receiver received more RTP
but decoded no additional frames during the observation window. Matching-key encryption
errors during rotation were zero in this run. The stale-key assertion covers video.

Two integration details emerged: `setE2EEEnabled()` completion precedes the asynchronous
worker acknowledgement, and the audio receiver needs an active playback sink to decode.
The harness waits for `room.isE2EEEnabled` and uses muted playback plus a zero-gain analyser
sink. All tracks, workers, room connections, and the audio context are closed after a run.

The [Windows WebView2 report](../evidence/media-webview2-windows-2026-10-07.json) records a
10.095-second pass with 62 decoded frames, audio PCM recovery, native MLS invoked through
Tauri IPC, and actual discovery against a fresh PostgreSQL-backed Compose server. The
test-only mode loads bundled assets with its own CSP in a hidden window. It permits
generated audio autoplay; this does not validate real device permissions or normal user
activation behavior. Its commands are excluded from the normal application entrypoint.

Hosted [Chrome](../evidence/media-chrome-linux-2026-10-07.json) and
[Safari](../evidence/media-safari-macos-2026-10-07.json) passed in 9.763 and 7.970 seconds,
respectively, decoding 66 and 64 frames and recovering audio PCM. Both passed wrong-key
and stale-key rejection. The [WebKitGTK report](../evidence/media-webkitgtk-linux-2026-10-07.json)
records the capability block and successful native MLS IPC. These reports came from
CI runs on the validation branch, not the merged default branch.

## Fixture and reproduction

Run `npm install`, then `npm run spike:media` with Docker available. Open
`http://127.0.0.1:5174` and press **Run encrypted media check**. The script starts a uniquely
named, disposable LiveKit container, publishes only loopback ports 17880–17882, and issues
five-minute, room-scoped tokens. It generates an independent room per run. In an interactive
terminal, type `stop` and press Enter to stop that container and remove its generated
configuration under ignored `target/media-spike`. SIGINT/SIGTERM also request cleanup, but
Windows hosts that terminate the process tree immediately can bypass those handlers. In
that case, stop only the printed test container and remove its matching configuration.
The explicit `stop` path was verified locally to remove both resources.
The bootstrap endpoint is local development tooling, not an authenticated product API.

Media keys are fresh random client-only HKDF input, held by the page and encryption
workers. The fixture's API secret and JWTs authorize signaling; they contain no media keys.
Do not reuse this shared-key provider as the production device/participant trust model.
The report excludes JWTs, secrets, SDP, and cryptographic transcripts.

`npm run spike:media:build` typechecks and bundles the separate harness. `npm run verify`
also typechecks and lints it. CI now includes native webview and actual Chrome/Firefox/Safari
acceptance scenarios with saved artifacts. Firefox's disposable CI profile permits
loopback ICE, disables default-address-only candidate filtering, and disables candidate
hostname obfuscation for this single-host fixture. These settings do not validate default
Firefox networking or real NAT/TURN behavior. The Linux capability gate records encryption
as unavailable, requiring a browser fallback, after passing native MLS through IPC.

## Remaining gates

- Run and record the matrix above with actual desktop webviews and browser versions.
- Bind authenticated participants and media epochs to MLS exporter material; test join,
  removal, ordering, reconnect, and publication during asynchronous key transitions.
- Select and verify the media framing profile and native/browser interoperability.
- Capture SFU packets and prove they contain no decodable media. Wrong-key rejection is
  useful client evidence but does not substitute for that canary test or a security review.
- Test real device permissions, camera/microphone/screen capture, TURN/NAT, codec changes,
  multi-party rooms, production TLS, and performance. This single-host synthetic run does
  not establish any of those properties.

Primary references checked on 2026-10-07: [LiveKit encryption setup](https://docs.livekit.io/transport/encryption/start/),
[local server setup](https://docs.livekit.io/transport/self-hosting/local/),
[server 1.13.8 release](https://github.com/livekit/livekit/releases/tag/v1.13.8), and
[RTCRtpScriptTransform](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpScriptTransform).
