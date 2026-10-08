# Hearth implementation progress

Updated: 2026-10-08. This file records implementation and validation separately. The
full product backlog and phase exit criteria are in [ROADMAP.md](ROADMAP.md).

## Current phase

Phase 0 is complete. [PR #1](https://github.com/KBHarris/hearth/pull/1) merged the verified
foundations and spike ADRs into `main` on 2026-10-07 (commit `8f6db29`). All 11 final
[CI checks](https://github.com/KBHarris/hearth/actions/runs/37670086516) passed before merge.
Phase 1 is in progress. The first owner can now register, sign in and sign out with
product OPAQUE and PostgreSQL sessions. First-device enrollment and encrypted local identity
vaults, linking, recovery and second-account registration are implemented. The product MLS
engine, PostgreSQL delivery service, gateway and encrypted DM/group-DM client are implemented.
Local HTTP/WASM, browser and packaged Windows acceptance pass, including encrypted storage,
offline delivery and recovery/new-device messages. Packaged Phase 1 acceptance passes
across Windows/macOS/Linux in run 37795943918, including native PostgreSQL on Windows
after the inherited-pipe fixture fix. The Safari handler-readiness correction now passes
in run 37801886115. That rerun exposes an intermittent Linux recovery/new-device failure;
the harness now records individual recovery stages without error strings or secrets.
Full Phase 1 closure remains open while this failure is investigated.

| Todo | Implementation | Validation |
|---|---|---|
| Monorepo and client/server shells | Complete | Local web/Rust/WASM and hosted desktop builds on Windows/macOS/Linux pass |
| CI and Compose definitions | Complete | Fresh Compose startup, migrations, health, S3 reachability and restart key persistence pass; hosted Docker and Podman pass |
| Public discovery and health | Complete | SDK/server tests and browser connection to a real PostgreSQL-backed server pass |
| Server selection and retry | Complete | Browser checked success, bad address, unreachable server, reload, and forgetting an address |
| Rust to TypeScript protocol generation | Complete | Generation, committed-output test, typecheck, and deliberate drift rejection pass |
| Spike A: OpenMLS | Feasibility complete | Native Rust, Node/browser WASM, and native MLS through Windows/macOS/Linux Tauri webview IPC pass |
| Spike B: encrypted media | Feasibility complete | Local and hosted WebView2, hosted WKWebView and Chrome/Firefox/Safari pass; Linux native capability block selects browser media |
| Spike C: OPAQUE | Feasibility complete | WASM client + separate Rust process pass registration/login and adversarial checks locally and in CI |
| Phase 1 owner/account slice | Implemented | Local PostgreSQL, native HTTP/product WASM and browser checks pass; all 12 hosted jobs pass for commit 074ab7e |
| Phase 1 identity/first-device vault | Implemented | All 12 hosted jobs pass for ba9b21e, including Windows/macOS OS stores; Linux runtime remains open |
| Recovery, device linking and second-account onboarding | Implemented | Local SQL/HTTP/WASM/browser and packaged Windows/Linux/macOS recovery acceptance pass; latest hosted Windows gate pending |
| MLS delivery, authenticated gateway, DMs and group DMs | Implemented | Actual PostgreSQL, 22 HTTP/WASM outcomes, browser text/reply/edit/offline checks and packaged Windows acceptance pass |
| Encrypted message store | Implemented | Browser IndexedDB and Windows/Linux/macOS SQLCipher/OS-store CAS, new-process, canary and missing-key checks pass |
| Threat model | Draft maintained | Discovery exposure and saved server address documented; no independent security audit |

## Iteration log

### 2026-10-08: recovery rerun diagnosis

- Safari passes after the handler-readiness correction in
  [run 37801886115](https://github.com/KBHarris/hearth/actions/runs/37801886115).
  The Linux packaged client passes authentication, encrypted text/reply/edit/delete,
  SQLCipher CAS, fresh-worker history and offline backlog, but fails in the recovery
  section after passing that section in the preceding run. Recovery is now reported
  as individual static stages, with no raw errors or credential material emitted.
- Ten consecutive local Windows packaged recovery runs pass using the real worker,
  native SQLCipher/OS credentials and fresh disposable PostgreSQL clusters. Each run
  checks new-device rekeying, new-message delivery, old-history exclusion, preserved
  original identity, server canary absence and fixture cleanup. Required npm verification
  and the diagnostic desktop build pass. This does not resolve the Linux failure yet.
- The Windows rerun passes all seven product checks but fails disposable fixture cleanup.
  Fixture storage calls now hold native operation leases through their blocking work;
  finishing rejects new calls and waits for existing calls before deleting credentials
  or files. A regression test verifies files survive while a lease is active and are
  removed afterward; it passes locally and runs on all three CI desktop platforms.
  Cleanup reports only static booleans for drained calls, credentials and files.
  Native feature clippy, formatting and default Rust tests pass. Hosted rerun pending.
- The first isolated Linux repetition in run 37805727608 passes all seven product
  checks and all three cleanup outcomes. Its second repetition fails during account
  setup, while native cleanup still passes. macOS passes product and cleanup acceptance.
  Diagnostics now distinguish individual registration/login/storage steps and static
  failure classes; raw error strings remain private. This broader intermittent Linux
  failure remains under investigation.
- Classified Linux diagnostics narrow the failure to WASM OPAQUE registration finish,
  before OS storage. The worker now distinguishes fixed runtime-trap classes from
  protocol rejection without exporting exception text. A separate diagnostic branch
  retains debug WASM for a controlled comparison. The product build now emits optimized
  WASM (2.96 MB versus 15.42 MB), preserving the exact OPAQUE/Argon2 profile. Optimized
  WASM passes required npm verification and all 22 real HTTP/WASM outcomes locally.
  The product CI run will repeat isolated Linux acceptance ten times and preserve each
  successful report. Hosted comparison and full closure remain pending.
- Added an upgrade-compatibility gate: optimized WASM authenticates credentials created
  by the debug build and opens its original encrypted identity vault with the same
  cross-signed device. All 23 HTTP/WASM outcomes pass locally, including this gate;
  [report](evidence/optimized-wasm-auth-2026-10-08.json). No profile migration is needed.

### 2026-10-08: cross-platform messaging and two-PC test preparation

- The context and private PostgreSQL fixture fixes work in hosted CI. Packaged
  [macOS](evidence/encrypted-messaging-packaged-macos-2026-10-08.json) and
  [Linux](evidence/encrypted-messaging-packaged-linux-2026-10-08.json) each pass all seven
  messaging acceptance checks, including OPAQUE, native identity storage, SQLCipher,
  offline history, recovery/rekeying and server canary absence. Full Linux/macOS desktop
  jobs pass. Windows's key-store/SQLCipher checks pass, but packaged acceptance times out
  while starting native PostgreSQL. A disposable local reproduction confirms `pg_ctl`
  exits successfully while `spawnSync` waits on pipes inherited by its background server.
  Windows `pg_ctl` now uses ignored streams with a separate startup log; all seven
  packaged checks pass against an owned native PostgreSQL 17 cluster after the fix,
  both locally and in hosted [run 37795943918](https://github.com/KBHarris/hearth/actions/runs/37795943918).
- Safari's separate Phase 0 media job times out; its previous run passed in 7.95 seconds.
  Keep the gate open and rerun the failure before deciding whether another fix is needed.
  The harness now shows its current stage, and the browser test saves its report/screenshot
  on timeout so a repeat failure identifies the blocked stage without secret transcripts.
  The next report shows `Ready`/`No test run yet`, confirming the test never started.
  The run button is now disabled until its handler is attached, and WebDriver waits for
  readiness before its real click. Windows headless Chrome passes full encrypted synthetic
  media with the native SFU in 9.38 seconds. Its Docker SFU attempt fails at loopback ICE
  connection; native SFU verification retains all encryption assertions.
- Built a shareable unsigned Windows NSIS debug installer. Added the optional public
  HTTPS Compose front end with Caddy 2.11.7 and the Let's Encrypt short-lived profile,
  supporting a public IPv4 without a purchased domain. Configuration rejects malformed,
  private and CGNAT addresses before starting services and preserves existing secrets.
- [Local proxy acceptance](evidence/https-proxy-2026-10-08.json) passes production ACME
  configuration, forced loopback backend binding, TLS without SNI, real Hearth discovery
  and real gateway WebSocket forwarding. Public certificate issuance, router forwarding
  and the connection between the two houses remain untested.
- Added the [two-PC test guide](TWO_PC_DM_TEST.md). No public listener, firewall rule or
  router forwarding was enabled by these checks; test proxy containers were loopback-only
  and removed afterward. The existing local development server/data were preserved.
- Prebuilt the local `hearth-server` image for the manual test. Docker build contexts now
  exclude `deploy/data`, environment secrets and private fixtures; inspection of the
  actual builder confirms their absence. The verification image tag was removed.
- Run 37795943918 finishes with all three full desktop jobs passing; Safari is the only
  failed job. Its startup-readiness correction is queued for the next full CI run.

### 2026-10-08: hosted platform validation and fixture fixes

- [Run 37788432871](https://github.com/KBHarris/hearth/actions/runs/37788432871) passes
  Rust, web, crypto WASM, full HTTP/WASM auth/messaging acceptance, Docker, Podman and
  Chrome/Firefox/Safari media jobs. Windows desktop remains running at this checkpoint.
- Linux's [Secret Service](evidence/local-vault-linux-2026-10-08.json) and
  [SQLCipher](evidence/sqlcipher-linux-2026-10-08.json) runtime checks pass. Packaged
  acceptance stops during its owned PostgreSQL startup; the fixture now disables Unix
  sockets and uses loopback TCP, independently verified in a disposable Linux container.
  Startup errors preserve the initial diagnostic. The private keyring readiness check
  no longer requires ripgrep and reports a startup timeout explicitly; ShellCheck passes.
- macOS finds duplicate embedded plist symbols because the acceptance build includes
  both product and diagnostic Tauri contexts. The contexts are now mutually excluded.
  Windows feature clippy/build and [packaged acceptance](evidence/encrypted-messaging-packaged-windows-2026-10-08.json)
  pass with the entrypoint fix. Hosted macOS/Linux acceptance still requires a rerun.
- Required npm verification, Rust formatting/clippy/tests and the normal Windows desktop
  debug build pass after these fixes.
- Phase 1 remains open until all required hosted platform gates pass.

### 2026-10-07: encrypted messaging vertical slice

- Implemented device-bound production MLS with signed manifests, identity-root pins,
  atomic rejection rollback, encrypted worker snapshots and durable upload outboxes.
- Added real KeyPackage validation/claims and consumed-package tombstones, epoch-ordered
  commits, idempotent fan-out and ACLs. Authenticated WebSockets use nonce-bound device
  proofs, bounded acknowledgements, heartbeats, resume and PostgreSQL offline queues.
- Implemented DMs/group DMs, replies, edits, deletes and encrypted expiring typing.
  Linked/recovered installs join a fresh epoch and read new messages without old history.
- Browser storage uses strict IndexedDB CAS; desktop uses actual SQLCipher with its
  separate database key in the OS store. Missing/damaged/conflicting storage fails closed.
- Local SQL acceptance and 22 real HTTP/product-WASM outcomes pass, including three-person
  groups, gateway forgery/revocation, restart/offline delivery and full database/log canary
  inspection. Crypto regression tests cover a previous-epoch message racing a commit and
  rejection of a pending first conversation without orphaned state.
- The packaged Windows webview passes the product worker/SDK/session/native-command path,
  SQLCipher CAS/history, fresh-worker offline reopening, recovery and new-device rekeying.
  Its dedicated credential services and owned files are cleaned; no production entries
  are deleted. Separate native storage tests pass fresh-process persistence and corruption
  rejection. This is a runtime harness, not native UI click/permission acceptance.
- Browser UI verifies owner setup, account invitation, both-way text/reply, synced edits,
  reload/sign-in history, offline delivery and linking from a fresh origin. The linked
  install starts with no old history and receives a new peer message. A full database
  dump excludes the browser message canaries.
- Recorded [ADR 0008](adr/0008-encrypted-direct-messages.md) and updated the metadata inventory.
  CI now includes delivery tests, packaged runtime acceptance on all desktop platforms and
  Linux Secret Service runtime in a private D-Bus/XDG fixture. Those hosted gates remain
  pending; Phase 1 is not marked complete.

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

### Next work

- Continue Phase 1 with protected local identity/device keys and device enrollment, then
  a second-account registration path and authenticated MLS delivery. Owner accounts and
  sessions are implemented; recovery, device linking and encrypted DMs remain open.
- Production MLS media keys, SFU packet canaries and real-device/NAT/TURN validation
  remain Phase 4 integration work. The optional custom WebKitGTK prototype is documented
  in ADR 0004 and is not required to begin Phase 1.

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

- Hosted WebView2 153 now passes the complete media scenario in 8.058 seconds with 57
  decoded frames, recovered audio (peak 0.101), native MLS IPC and all key-change checks.
  Saved the report under `docs/evidence`. Explicit loopback candidate permission resolves
  the disposable Windows fixture's ICE failure. Spike B is checked off; the Linux browser
  strategy remains selected, and a custom WebKitGTK runtime remains an optional experiment.
- Validation run [37668608690](https://github.com/KBHarris/hearth/actions/runs/37668608690)
  includes passing Windows/macOS/Linux native acceptance, Chrome/Firefox/Safari, web,
  Rust, crypto WASM and Compose. Podman's runner package installation stalled even though
  the official runner image already includes Podman. CI now uses the installed executable
  and installs only if missing. Final validation is being rerun. Phase 0's final exit
  criterion is merging the reviewed spike ADRs; this branch is still a draft PR.

### 2026-10-07: Phase 0 complete

- All 11 checks in final run `37670086516` pass: Rust, web, crypto WASM, Docker Compose,
  Podman, Chrome/Firefox/Safari media, and Windows/macOS/Linux desktop acceptance.
- Following the user's instruction to continue, marked PR #1 ready and squash-merged
  the exact verified head `d4cbe9d` into `main` as `8f6db29`. Updated the clean local main
  checkout. The spike ADRs are accepted and the Phase 0 merge exit criterion is met.
- Selected first-run owner setup plus product OPAQUE accounts/sessions as the next
  Phase 1 milestone. No product authentication or encrypted messaging is claimed yet.

### 2026-10-07: Phase 1 owner accounts and sessions

- Added the product OPAQUE profile and typed owner/login/session APIs. The client runs
  Argon2id/OPAQUE in a WASM worker and pins the advertised server identity on first use.
  Passwords and session tokens are not saved in application browser storage. Public
  registration is closed; only the first owner can register with the operator's setup code.
- Added persistent PostgreSQL accounts, two-minute one-use pending proofs and 24-hour
  revocable sessions. Token/exchange IDs are stored as hashes. An atomic owner transaction
  and unique constraint prevent competing claims from creating two owners.
- Server data persists the OPAQUE setup and bootstrap code. Unix files are created with
  owner-only permissions; Windows requires a protected directory ACL. Existing account
  databases refuse startup if matching signing/OPAQUE keys are missing. The operator can
  retrieve the code with `npm run setup -- --show-setup-code`.
- Local PostgreSQL acceptance passes concurrent claims/proofs, expiry, invalid-proof
  consumption, hashed-token storage, restart, wrong passwords, unknown users, logout,
  exact CORS, body rejection and request budgets. The product WASM also passes against the
  real HTTP server; its [report](evidence/auth-wasm-native-2026-10-07.json) records eight
  successful outcomes, including missing-key startup rejection. Disposable resources and
  their secret files were removed after validation.
- Browser validation passes owner creation and automatic sign-in, sign-out, incorrect
  password rejection with cleared fields, fresh sign-in and reload. Reload requires
  sign-in while preserving server account state. Refreshed the existing development
  backend at port 18087, preserving and verifying its signing key and PostgreSQL data.
  The preview is connected to that updated backend; it has no test owner account. Its
  protected operator code is in ignored `deploy/data/setup.code`.
- Updated the metadata inventory and [ADR 0005](adr/0005-owner-authentication.md). Added a
  hosted PostgreSQL/product-WASM auth job and current-run WASM artifact sharing for the
  desktop matrix. Packaged native auth runtime is not yet claimed.
- Standard npm verification passes 17 JavaScript tests, typecheck, lint and web/WASM build.
  Rust fmt/clippy and all 14 baseline tests pass; the real PostgreSQL test also passes
  separately. Combined CI features pass clippy and 17 Rust tests. Generated protocol drift
  checks, baseline WASM compilation and the Windows desktop debug build pass. Packaged
  desktop authentication runtime remains unverified.
- Next: identity/device enrollment and protected local storage. Password change/recovery,
  session management, second-user registration, gateway delivery and encrypted DMs remain.

### 2026-10-07: Phase 1 hosted checks

- Opened [draft PR #2](https://github.com/KBHarris/hearth/pull/2) from
  `codex/phase1-owner-auth`. Implementation commit `085fa19` passes the hosted PostgreSQL
  and real HTTP/product-WASM auth scenario; saved the
  [hosted report](evidence/auth-wasm-native-hosted-2026-10-07.json).
- [Run 37683819094](https://github.com/KBHarris/hearth/actions/runs/37683819094) passes all
  12 jobs for follow-up commit `074ab7e`, including Linux desktop. The earlier run's Linux
  dependency installation was canceled by that follow-up; it was not a product failure.
  This evidence covers owner/authentication before the new first-device changes.
  No Phase 1 merge or full-phase completion is claimed.
- These desktop results cover packaging and the existing Phase 0 diagnostic scenarios,
  not the new account flow inside native webviews. Product authentication has real browser
  runtime evidence; native auth runtime, independent review and the remaining Phase 1
  product features still need validation.

### 2026-10-07: immutable first-device enrollment and local identity vault

- Added account/server-bound Ed25519 enrollment, strict signatures and weak-key rejection.
  PostgreSQL serializes first claims, accepts exact retries, and rejects replacement keys
  or additional devices. Public wire types are generated from Rust.
- WASM creates identity/device keys and a reserved storage key, encrypted with
  XChaCha20-Poly1305 and an HKDF-derived OPAQUE export key. Private keys stay inside the
  worker; accepted enrollment discards wrapping material. The reserved key is not yet
  connected to SQLCipher or message storage.
- Browser IndexedDB transactions and native OS credentials preserve existing envelopes.
  Native storage uses a cross-process filesystem lock and never falls back to files.
  Missing, damaged or locked stores fail closed. A fresh install authenticates but cannot
  replace an established identity. Cancellation and deadlines settle pending storage UI.
- Browser checks observed first enrollment, the same fingerprint after sign-out/sign-in,
  and an unlinked fresh origin. Browser access changed before the final screenshot and
  post-reload sign-in check; those are not counted as passing. The disposable backend,
  database and generated secret files were cleaned up.
- Standard npm verification passes 21 JavaScript tests, typecheck, lint and web/WASM build.
  Rust fmt/clippy, 14 baseline tests, 18 combined-feature tests, WASM checks and protocol
  drift checks pass. Both isolated PostgreSQL tests and all 11 real HTTP/product-WASM
  acceptance outcomes pass in the [vault report](evidence/identity-vault-wasm-native-2026-10-07.json).
  The Windows desktop debug build and native clippy pass. Windows Credential Manager
  passes create/read, fresh-process persistence, existing/damaged-entry preservation and
  cleanup in the [OS-store report](evidence/local-vault-windows-2026-10-07.json).
- Updated the threat model and [ADR 0006](adr/0006-first-device-vault.md). CI now runs
  device acceptance, combined product-vault crypto tests, and Windows/macOS OS-store
  acceptance. Linux Secret Service runtime and packaged native auth remain unverified.
- Restored the local preview at port 5173 and updated its native backend at port 18087.
  The original signing key and PostgreSQL data were preserved; the development server
  remains unclaimed, with no disposable test owner installed.
- Next: recovery/linking and a second-account registration path, then authenticated MLS
  delivery, the gateway and encrypted DMs. Phase 1 remains in progress.

### 2026-10-07: recovery, approved linking and second-account onboarding

- Verified all 12 [hosted jobs](https://github.com/KBHarris/hearth/actions/runs/37709982624)
  pass for first-device commit `ba9b21e`; this includes macOS/Windows OS-store acceptance.
- Added versioned passphrase-encrypted recovery kits carrying the portable identity only.
  Restore creates fresh device and storage keys. A 128-bit grouped link code authorizes
  an encrypted identity handoff from an approved device, with three-minute expiry and
  atomic consumption. The relay sees the hash ID, encrypted kit and public authorization.
- Native crypto and SQL tests pass wrong-passphrase/context rejection, new-device identity
  preservation, expired links, cross-account isolation, forged approval and consumed-link
  replay rejection. Product WASM/HTTP passes recovery and one-use linking across real
  authenticated accounts; old vaults remain immutable.
- Added single-use 24-hour owner invitations, invite-only/open/closed registration and
  persistent server names. Product WASM passes a second-account registration, concurrent
  invite claims, non-owner settings/invite rejection and settings persistence after restart.
  The [local report](evidence/recovery-registration-wasm-native-2026-10-07.json) records
  15 passing outcomes. No plaintext account or recovery passphrase reaches the server.
- Added client backup/restore/link and admin/onboarding forms. Typecheck and lint pass;
  browser/native UI runtime acceptance remains to be run as part of the full slice.
- MLS delivery, gateway resume/backlog, encrypted local message storage, DMs/group DMs
  and full Phase 1 exit criteria remain open. Work continues on these gates.
