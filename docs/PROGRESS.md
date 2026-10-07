# Hearth implementation progress

Updated: 2026-10-07. This file records implementation and validation separately. The
full product backlog and phase exit criteria are in [ROADMAP.md](ROADMAP.md).

## Current phase

Phase 0 is in progress. Accounts and encrypted messaging are not usable yet.

| Todo | Implementation | Validation |
|---|---|---|
| Monorepo and client/server shells | Complete | Web, Rust/WASM, and Windows desktop builds pass locally; hosted matrix not confirmed |
| CI and Compose definitions | Complete locally; hosted gates open | Fresh Compose build/start, migrations, healthy server, S3 reachability, and restart key persistence pass; hosted CI unconfirmed |
| Public discovery and health | Complete | SDK/server tests and browser connection to a real PostgreSQL-backed server pass |
| Server selection and retry | Complete | Browser checked success, bad address, unreachable server, reload, and forgetting an address |
| Rust to TypeScript protocol generation | Complete | Generation, committed-output test, typecheck, and deliberate drift rejection pass |
| Spike A: OpenMLS | Local feasibility complete; hosted gates open | Native Rust, Node/browser WASM, Windows Tauri executable and actual WebView2 IPC pass; macOS/Linux pending |
| Spike B: encrypted media | Local harness and WebView2 complete; hosted gates open | Windows Chromium and actual WebView2 decode audio/video, reject wrong/stale keys; other runtimes pending |
| Spike C: OPAQUE | Local feasibility complete | WASM client + separate Rust process pass registration/login and adversarial checks; browser/webview and product account integration pending |
| Threat model | Draft maintained | Discovery exposure and saved server address documented; no independent security audit |

## Iteration log

### 2026-10-07: server connection flow

- Replaced the fixed health-check screen with server selection, compatibility and health
  checks, setup readiness, retry, cancellation, timeout, and last-working-address storage.
- Public discovery GETs permit cross-origin reads without credentials. Authenticated APIs
  and the gateway do not inherit that policy.
- Setup lookup returns unavailable on database failure instead of reporting incomplete setup.
- Added 10 SDK integration tests and 4 server discovery tests. Together with the existing
  tests, 21 checks passed. Rust lint/fmt, WASM check, web build, and Windows desktop build passed.
- Browser tested against an isolated local PostgreSQL database. The preview remains at
  `http://127.0.0.1:5173`, with a local native backend on port 18087 and temporary PostgreSQL
  container `hearth-discovery-test-db` on loopback port 55439. These are development resources.

### 2026-10-07: protocol generation and MLS feasibility

- `protocol.ts` now derives from Rust with optional `ts-rs` tooling. Gateway opcodes, serde
  tags, nullability, and the protocol constant come from Rust. CI checks committed output.
- JSON gateway integers keep the existing TypeScript `number` representation; future
  sequence allocation must stay in JavaScript's safe-integer range or change the wire format.
- MLS experiment checks group creation, two-member join, messages both ways, private wire
  frames, plaintext-canary absence, tampering, replay, matching exporter secrets, removal
  rekeying, and rejection of post-removal messages.
- Found that a rejected tampered packet can advance receive ratchet state. The in-memory
  experiment now snapshots and restores the group/provider on rejected input, and verifies
  that the valid packet still decrypts afterward. Production storage needs an atomic
  receive transaction; copying the in-memory provider is only an experiment strategy.
- OpenMLS 0.9 requires Rust 1.91, so the workspace minimum is now 1.91. The installed
  toolchain is newer. No content/key debug features are enabled.
- Verified generated output rejects a deliberate edit and accepts the restored file.
  TypeScript checks and all 10 SDK tests pass with the generated declarations.
- MLS scenario passes as native Rust, Node WASM, browser WASM, and a headless Windows
  Tauri executable. CI now includes native/Node execution and the desktop OS matrix.
  Hosted CI results and desktop webview IPC are still unverified.
- Recorded [ADR 0002](adr/0002-mls-feasibility.md). The temporary browser spike harness
  was stopped after validation; the application preview remains available.
- These checks establish feasibility, not product E2EE readiness. Durable encrypted
  storage, authenticated device credentials, delivery ordering, and security review remain.

### 2026-10-07: Compose and OPAQUE feasibility

- Built and started the Compose stack in isolated project `hearth-compose-spike`, with
  fresh volumes, a random database password, and loopback port 18088. The server became
  healthy, the initial migration applied, owner setup was incomplete, and the internal S3
  endpoint responded. A real 32-byte advertised server key remained identical after restart.
- Stopped and removed only that test project's containers, network, and generated volumes.
  Podman and production TLS/onboarding remain unverified. Application preview resources
  from the first iteration remain running.
- Implemented opt-in OPAQUE 4.0.1 flows with Argon2, a WASM client, and a separate native
  Rust test process. The server accepts serialized protocol messages, not passwords.
- Native and WASM/native-process checks pass registration/login, matching session and
  export keys, server-key consistency, fresh sessions, wrong passwords, unknown-user dummy
  responses, tampering, replay, and fresh login after rejection. The password canary is
  absent from protocol bytes and the server record. Debug WASM scenario: about 3.6 seconds.
- Recorded [ADR 0003](adr/0003-opaque-feasibility.md). Public auth endpoints, accounts,
  durable state, TLS, session issuance, worker execution, and security review remain.
- Final combined validation: 14 Rust tests with codegen and both spikes enabled, all 10
  SDK tests, TypeScript checks/lint/web build, Rust fmt/clippy, baseline and combined-spike
  WASM checks, generated-output checks, and `git diff --check` pass locally. MLS also passes
  in browser WASM and the Windows Tauri executable; OPAQUE passes across WASM/Rust processes.
  These are local results; no hosted CI run is claimed.

### 2026-10-07: encrypted media feasibility

- Added a separate synthetic LiveKit harness and an isolated Docker fixture with loopback
  ports, short-lived room tokens, and client-only random media keys. Product UI is unchanged.
- Windows in-app Chromium 154 passed in 9.287 seconds: encrypted audio/video recovery,
  wrong-key rejection despite receiving RTP, fresh-key continuation, and no new video
  frames decoded by a receiver left on the old key. Saved the
  [runtime report](evidence/media-chromium-windows-2026-10-07.json) and
  [ADR 0004](adr/0004-media-feasibility.md).
- Publication now waits for the encryption worker's acknowledgement. Silent playback
  activates audio decoding so the assertion measures actual PCM rather than packet headers.
- Added and verified an interactive `stop` command for fixture cleanup. The Windows tool
  host bypassed Ctrl+C handlers, so its first disposable container was removed explicitly.
- Linux provisionally uses a supported browser for media until WebKitGTK passes the same
  scenario. WebView2, WKWebView, standalone browsers, MLS media-key integration, SFrame
  interoperability, and SFU packet inspection remain unverified. Spike B stays open.
- Updated the existing `source-map-js` build dependency to fix the reported advisory;
  npm audit reports zero vulnerabilities. This is dependency evidence, not a product audit.
- Local verification passed: standard npm checks and 10 SDK tests, separate media build
  and lint, Rust fmt/clippy and 11 baseline tests. CI now builds the media harness; runtime
  browser checks remain local.

### 2026-10-07: Phase 0 closure checks in progress

- Added an opt-in Tauri mode with its own bundled assets, CSP, and native commands. Windows
  WebView2 passed encrypted synthetic media and native MLS over IPC in about 10 seconds.
- Added hosted WebView2/WKWebView/WebKitGTK and Chrome/Firefox/Safari runtime jobs. The
  Linux job records missing encryption capability as a blocked-media result requiring a
  browser fallback; it must still pass native MLS IPC and may not publish plaintext media.
  Hosted results are pending.
- Added first-run configuration with random URL-safe database secrets, preservation of
  existing settings, placeholder rejection, loopback publication, and health checks.
  Four configuration safety tests pass. Owner creation remains in Phase 1.
- Added a fresh Compose acceptance command with restart-key persistence, optional real
  desktop discovery/media checks, and cleanup scoped to its generated project.
  The fresh stack, restart, actual WebView2 health/discovery, MLS IPC, and media checks pass
  locally; its containers, network, volumes, and generated secret configuration were removed.
- Added a Podman hosted job. Local Podman is not installed; its compatibility result is
  pending. The application preview is kept separate from disposable test stacks.

### Remaining work (updated after hosted results below)

- Resolve hosted Windows media acceptance and record its final outcome. WKWebView,
  WebKitGTK capability gating, all browser media scenarios, Podman, and the desktop
  build/MLS IPC matrix pass. Production MLS media keys and SFU packet canaries are
  Phase 4 integration work, beyond this feasibility spike.
- Merge the reviewed spike ADRs after the remaining hosted gate passes.
- Start Phase 1 only after the Phase 0 gates and ADR decisions are resolved.

### 2026-10-07: hosted validation results

- The private [draft PR](https://github.com/KBHarris/hearth/pull/1) is open. Hosted Rust,
  web, MLS/OPAQUE WASM, Docker Compose, and Podman checks pass on the validation branch.
- Chrome 154 on Linux and Safari 26.6.2 on macOS pass encrypted synthetic audio/video,
  wrong-key rejection, fresh-key continuation, and stale-key rejection. Saved their
  reports under `docs/evidence`.
- Ubuntu 22.04's desktop build, headless MLS, and native MLS invoked through webview IPC
  pass. Its WebKitGTK lacks WebRTC/encoded transforms; media is blocked before publication.
  ADR 0004 selects a supported browser for Linux media and records the measured limitation.
- Fixed the macOS diagnostic build's duplicate embedded plist and the WASM CLI installer's
  oversized metadata output. Windows/macOS desktop acceptance is running again.
- Firefox can expose encoded transforms but still fails to connect to the loopback SFU.
  The disposable test profile now explicitly permits loopback candidates and disables
  candidate filtering/hostname obfuscation; safe numeric connection diagnostics were added.
  No Firefox media pass is claimed yet. Phase 0 remains open until the remaining runtime
  results are recorded and the spike ADRs are merged.

- Follow-up diagnostics show Firefox now connects all three encrypted rooms; generated
  audio remains suspended in headless CI. The disposable profile permits synthetic audio
  autoplay, matching the Chrome/native diagnostic policy. Normal activation and device
  permissions remain product gates.
- A web job stalled in verification. Test cleanup now closes the listener before destroying
  sockets, preventing late-request reconnection; SDK tests and the CI verification step
  have bounded timeouts. All 14 JavaScript tests and local Rust checks pass after the change.
- Recorded the user's custom WebKitGTK idea as an optional upstream-based experiment in
  ADR 0004. No custom engine build or release commitment has been made.

- Firefox 157 now passes the entire encrypted-media scenario in 11.050 seconds with a
  silent PulseAudio backend: 49 decoded video frames, recovered audio, wrong-key rejection,
  fresh-key continuation, and stale-key rejection. Saved its runtime report. All three
  hosted browser families have passed; Windows/macOS desktop media acceptance remains.
- The CI timeout test still stalled after fixture cleanup changes. SDK requests now race
  transport/body settlement against explicit cancellation and deadline rejection, while
  still aborting the connection. A regression test covers a reader that ignores abort.
  All 11 SDK tests and 4 configuration tests pass locally and in a disposable Node 22
  container with read-only source. Hosted verification is being rerun.
- Confirmed the tested Ubuntu WebKitGTK package is 2.50.4. Its upstream GStreamer encoded
  frame backend contains unimplemented processing/callback paths, so a build flag alone
  would not complete media encryption. Prefer investigating the new upstream backend
  for the optional custom-runtime experiment.

- Hosted WKWebView now passes encrypted synthetic audio/video and all key-change checks
  in 29.120 seconds with 28 decoded frames. Saved its report. Disabling suspension in the
  hidden diagnostic fixed its timeout. Native MLS over IPC now passes on all desktop OSes;
  Spike A is checked off. The corrected hosted web deadline tests also pass.
- The current validation run is
  [37664117421](https://github.com/KBHarris/hearth/actions/runs/37664117421).
  Rust, crypto WASM, web, Chrome, Firefox, Safari, Linux desktop, and macOS desktop pass.
  Windows desktop media acceptance is the remaining runtime gate.

- The Windows hosted result connects signaling, runs audio, and passes native MLS IPC,
  but ICE remains in checking until timeout before publication. Its diagnostic profile
  now disables mDNS candidate obfuscation; native reports record that requested policy,
  and failures include aggregate SDP candidate counts without addresses or transcripts.
  The revised profile passes locally on WebView2 154 in 8.698 seconds. Hosted WebView2
  153 is being rerun; its failure is not counted as a media pass.

- The hosted mDNS-disabled Windows run still fails before publication. Its SDP counts
  show no local loopback candidate and four remote loopback candidates; mDNS alone does
  not explain the failure. The diagnostic now explicitly permits loopback candidates,
  and records that requested test policy. Normal product browser arguments are unaffected.
- A later macOS job failed before acceptance because the Cargo cache restored an SFU
  source directory that collided with a fresh clone. CI now builds that source in the
  runner's temporary directory. Verifiers also remove their own previous JSON/PNG output
  before starting, preventing cached reports from being uploaded as new evidence.
- The loopback-enabled WebView2 154 profile passes locally in 8.957 seconds with 64
  decoded frames, recovered audio, native MLS IPC, and wrong/stale-key rejection. Standard
  verification passes all 15 JavaScript and 11 Rust tests, plus desktop lint/build.
