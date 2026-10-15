# Progress

The latest two-PC Windows package is ready (2026-10-15):
`target/manual-test/guided-efd4af6/Hearth_Test_efd4af6_Windows_x64.zip` is the
friend-only installer/guide/checksum ZIP. Both PCs install Hearth Test 0.3.0;
the matching host folder contains a pinned server archive and fresh
`hearth-guided-test` deployment on backend 8183/S3 18335. It preserves the older
test bundles and data. [Fifteen local package checks](evidence/windows-buddy-bundle-2026-10-15.json)
pass, including real NSIS installation, the production WebView2 Host/Join screen,
native version/profile/IPC, latest input guard, bundled-server discovery through
owner setup, all 21 migrations, private S3, identity-preserving restart, HTTPS
configuration and temporary-install cleanup. Native account creation and actual
two-house reachability/messaging remain human acceptance. Follow
[the latest two-PC guide](TWO_PC_LATEST_TEST.md); send only the friend ZIP.

Guided Host/Join setup is in its first implementation pass on
`codex/guided-setup` (2026-10-15). Fresh clients choose Host or Join, inspect a real
server and explicitly confirm before changing servers. Invites carry an origin,
public identity and account/community capabilities without saving those secrets.
The account/device and signed community admission flows remain in force.
Host currently connects an existing deployment; automatic service installation,
native invite handling and independent outside reachability remain open. See
[the guided setup development notes](GUIDED_SETUP.md) for scope and remaining work.
The [dated setup record](evidence/guided-setup-2026-10-15.json) records 46 broad
two-client/private-S3 browser checks followed by 12 final guided-join checks and
seven mock-response failure/cancellation checks. Final npm verification passes
38 tests, typecheck, lint and production build using the existing Phase 3 WASM.
Rust fmt/clippy and 34 default tests pass; four PostgreSQL integration tests remain
ignored by the default Rust command. Windows installed-product smoke acceptance is
recorded above; clean-machine and current macOS/Linux packaging remain open.

Phase 3 is in active validation on `codex/phase3-navigation` (2026-10-12).
The local HTTP/product-WASM suite passes 90 checks with private S3, including
valid and rejected access across the complete REST inventory and every gateway
operation. Signed account deletion revokes linked sessions, fences late credential
writes, survives restart retries and physically erases retained file ciphertext.
The packaged Windows client passes 17 checks with private S3, including the full Phase 3 workflow
and native SQLCipher/credential cleanup. The native shutdown-barrier regression passes.

The second menu pass includes compact actions, aligned checkboxes, paperclip
attachments, automatic address-derived link cards with an off setting, clear
permission rows, useful empty states and explicit ownership device selection.
Successor-authority ordering and opening a newly created encrypted channel are
fixed. The sidebar now refreshes channel changes from another device without
resetting open management forms. All 41 two-client browser/private-S3 checks pass,
including ownership in both directions, selected reports, polls, account privacy,
exact deletion confirmation and narrow layout. Automated setup stays within the
real server rate limits. Sanitized local evidence is saved for
[HTTP/WASM](evidence/phase3-http-private-s3-2026-10-12.json),
[Windows](evidence/phase3-windows-private-s3-2026-10-12.json) and
[browser controls](evidence/phase3-ui-private-s3-2026-10-12.json).
[Haven parity and setup requirements](HAVEN_PARITY_AND_SETUP.md) now define a guided
Host/Join installation checkpoint before media expansion.
GitHub checks currently return `startup_failure` before any job starts, including a
manual dispatch. Current macOS/Linux packaged validation remains pending; the API
provides no cause. The frozen Phase 2 test bundle and user data remain unchanged.

Phase 0 is complete. [PR #1](https://github.com/KBHarris/hearth/pull/1) merged the verified
foundations and spike ADRs into `main` on 2026-10-07 (commit `8f6db29`). All 11 final
[CI checks](https://github.com/KBHarris/hearth/actions/runs/37670086516) passed before merge.
Phase 1 is complete. Implementation `43ac92b` passes all twelve jobs in
[run 37811808453](https://github.com/KBHarris/hearth/actions/runs/37811808453): Rust,
web, crypto/WASM, real PostgreSQL/HTTP acceptance, Docker, Podman, three browsers and
Windows/macOS/Linux desktop acceptance. The product suite passes 23 HTTP/WASM outcomes;
packaged webviews pass all seven messaging outcomes, with ten isolated Linux repetitions.
Owner/invitation onboarding, immutable cross-signed devices, linking/recovery, MLS DMs
and group DMs, gateway/offline delivery and encrypted durable local storage are verified.
[PR #2](https://github.com/KBHarris/hearth/pull/2) remains a draft for review; no merge
has been performed. The next checkpoint is the [two-PC encrypted DM test](TWO_PC_DM_TEST.md).
The original Phase 1 server and data are preserved. Its bundle files have been replaced
by the validated Phase 2 Windows/server bundle from `7cc8852`. Public certificate issuance
and trusted HTTPS health through the public IP pass from the host PC. Clean installation
on the other PC and actual two-house reachability remain human acceptance.
The full Phase 2 implementation passes 49 HTTP/WASM, 18 Chrome
UI and ten packaged Windows checks; eight assembled-bundle checks also pass.
[The two-PC guide](TWO_PC_PHASE2_TEST.md) covers DMs and communities. All twelve expanded hosted
checks pass for `7cc8852` in [run 37925276507](https://github.com/KBHarris/hearth/actions/runs/37925276507); a 50-person community running for a week remains open.

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
| Phase 1 owner/account slice | Complete | SQL, browser and hosted product HTTP/WASM acceptance pass |
| Phase 1 identity/first-device vault | Complete | Browser vault and all three native OS stores pass; optimized WASM preserves debug-build credentials/vaults |
| Recovery, device linking and second-account onboarding | Complete | HTTP/WASM and packaged Windows/macOS/Linux recovery/new-message acceptance pass; ten Linux repetitions pass |
| MLS delivery, authenticated gateway, DMs and group DMs | Complete | 23 HTTP/WASM outcomes, browser checks and all three packaged webview runtimes pass |
| Encrypted message store | Complete | Browser IndexedDB and Windows/Linux/macOS SQLCipher/OS-store CAS, new-process, canary and missing-key checks pass |
| Phase 1 exit criteria | Complete | All 12 hosted jobs pass for implementation 43ac92b |
| Two-PC public HTTPS DM test | Host HTTPS verified | Let's Encrypt IP certificate and trusted public-IP health pass from the host PC; another-network reachability and clean buddy-PC installation remain untested |
| Phase 2 community structure and invitations | Implemented | Membership/invite boundaries and all 12 hosted jobs pass for 7cc8852 |
| Phase 2 channel MLS and encrypted text | Implemented | 49 HTTP/WASM, 18 local UI, 16 hosted UI and all 12 hosted jobs pass for 7cc8852 |
| Phase 2 client-verifiable admission | Implemented | Owner-signed grants/policies, pinned roots and malicious delivery-host rejection pass native and HTTP/WASM checks |
| Phase 2 reactions, pins, threads, Markdown, mentions, read markers and search | Implemented | 49 HTTP/WASM and 18 Chrome UI outcomes pass, including custom emoji |
| Phase 2 profiles, presence and sender-created embeds | Implemented | Encrypted control/state and profile/presence/embed UI checks pass |
| Phase 2 history | Implemented | Native and real HTTP/WASM none/full/since-invite, device binding, tamper and sealed restart and signed history UI handoff pass |
| Phase 2 encrypted files, thumbnails and custom emoji | Implemented | Expanded suite passes 49 HTTP/WASM outcomes; canary absent from database, logs and private S3 volume bytes; actual UI file upload/download and custom emoji pass |
| Phase 2 MLS load measurement | Complete | 1,000 synthetic native OpenMLS members; rotation median 11.47 ms, p95 12.52 ms, final member decrypts; product remains bounded to 128 devices |
| Phase 2 replacement test bundle | Prepared | 7cc8852 installer/image hashes, secret-free friend ZIP, fresh migrations, private S3 and restart pass all eight checks; old bundle files removed |
| Threat model | Draft maintained | Discovery exposure and saved server address documented; no independent security audit |

## Iteration log

### 2026-10-09: live Phase 2 public-IP HTTPS setup

- Caddy obtained a publicly trusted Let's Encrypt certificate for the configured public IPv4.
  Windows curl and Node HTTPS passed the public-IP health check with certificate verification.
- The installer's Node fetch initially timed out; a later fetch and a complete rerun of
  `node deploy/setup.mjs --https` passed. The exact transient cause remains unconfirmed.
  No certificate trust bypass, firewall change or installer patch was needed.
- The existing Phase 2 stack and data were reused. The friend must use the HTTPS public
  address on the standard port 443; port 8182 remains the host-only backend.
  Another-network connectivity and the actual two-person messaging test remain open.

### 2026-10-09: menu usability direction

- The user likes the current overall feel and color scheme and wants menus to become
  better-looking and easier to use. Preserve that visual direction while simplifying
  navigation and separating everyday chat from setup/management forms.
- Added a Phase 3 navigation/usability task, guided by feedback from the two-PC test.
  This records design direction; the validated Phase 2 bundle and running server are unchanged.

### 2026-10-09: Phase 2 implementation ready for two-PC acceptance

- All twelve [hosted jobs](https://github.com/KBHarris/hearth/actions/runs/37925276507)
  pass for `7cc8852` ([CI record](evidence/phase2-ci-2026-10-09.json)). Expanded private
  S3/HTTP/WASM passes all 49 outcomes; Windows UI passes 16 (local storage-enabled UI: 18).
  Windows/macOS/Linux packaged webviews pass nine core outcomes each; all ten Linux
  repetitions pass. Local Windows with private S3 passes ten, including file transfer.
- The final `phase2-7cc8852` bundle passes all eight assembled-artifact checks and keeps
  operator secrets out of the friend ZIP. The original Phase 1 bundle files were removed;
  the original running backend/proxy, images, signing keys and volumes remain untouched.
- The earlier `phase2-ee0a90f` build is retained with a `SUPERSEDED.md` marker: automatic
  approval review rejected removing it because the user's removal request covered Phase 1.
  Use `phase2-7cc8852` for the actual test. No operator credentials were copied into it.
- Updated the original checkout's roadmap/progress and [two-PC guide](TWO_PC_PHASE2_TEST.md).
  The engineering checklist is complete. Actual WAN/certificate issuance, a clean buddy-PC
  installation and a 50-person community running for a week remain human acceptance gates.

### 2026-10-09: Linux private-storage ownership correction

- Hosted HTTP acceptance found that SeaweedFS drops to its service UID, which cannot
  read a Linux host's mode-0600 configuration owned by another UID. Windows bind mounts
  had masked this. The host configuration stays private/read-only; startup copies it into
  a mode-0600 service-owned container file before the normal privilege drop.
- The [Linux ownership reproduction](evidence/phase2-storage-permissions-2026-10-09.json)
  passes locally inside the real Linux image: the original file stays unreadable to the
  service UID, its private copy is readable and anonymous S3 requests still fail.
  All 49 HTTP/WASM checks and fresh Compose checks pass again with the corrected startup.
- Expanded macOS native acceptance passed in the first hosted run. Hosted checks and the
  final bundle are being refreshed with this deployment correction; no gate is waived.

### 2026-10-09: validated replacement bundle

- Built `Hearth Phase 2 Test` 0.2.0 with identifier `chat.hearth.phase2-test`, independent
  from the installed Phase 1 app. The friend ZIP contains only installer, guide and hash.
- The host bundle pins the archived server image by content ID, uses project
  `hearth-phase2-test` and fresh data, and generates new operator credentials on startup.
  Its [eight-check report](evidence/phase2-bundle-2026-10-09.json) passes hash checks,
  archive load, fresh schema 13, discovery/owner bootstrap, anonymous S3 rejection and
  signing-key persistence. Caddy configuration validates; public issuance remains untested.
- Removed only `target/manual-test/phase1-43ac92b` after checking that no running container
  mounts it. The original backend remains healthy at port 8181; proxy, keys and volumes
  are preserved. [The new guide](TWO_PC_PHASE2_TEST.md) explains the manual proxy handover.
- Hosted cross-platform checks for implementation `ee0a90f` are running in
  [run 37923945571](https://github.com/KBHarris/hearth/actions/runs/37923945571).
  The 50-person/week exit criterion and actual two-house installation remain human gates.

### 2026-10-09: full text-layer browser validation and packaging

- All 18 expanded Chrome UI checks pass against isolated accounts and a real private S3
  service. The [report](evidence/phase2-history-files-ui-2026-10-09.json) includes signed
  history handoff, profiles/presence, sender-written previews without metadata fetching,
  actual file-picker upload/download and encrypted custom emoji rendering.
- Default and combined-feature Rust checks/tests, protocol drift, npm verification and
  WASM portability pass. Native desktop compilation and fresh isolated Compose checks pass.
  The expanded Windows packaged webview suite passes all ten checks, including encrypted
  files and signed history ([report](evidence/phase2-packaged-windows-2026-10-09.json)).
  Replacement installer assembly and hosted validation remain in progress.
- Kept the existing server request budgets. Client synchronization now avoids unnecessary
  repeated directory/channel requests; UI acceptance paces account request bursts.
- Phase 2 installs with a separate application identifier and uses independent server
  data. Replacement files are removed only after validation; the running Phase 1 stack,
  keys and volumes remain intact. WAN installation and the 50-person/week test stay open.

### 2026-10-09: owner admission, text controls and history development

- Owner-signed community roots, admissions and channel policies are verified by receiving
  clients. Pending members require explicit owner approval after fingerprint comparison.
  [ADR 0011](adr/0011-owner-signed-channel-admission.md) records first-contact trust.
- Reactions, owner channel pins, threads, safe Markdown/mentions, encrypted read markers,
  profiles and expiring presence are implemented. Search runs over decrypted local state;
  remote images and automatic link metadata fetching remain disabled. The expanded local
  suite passes 42 HTTP/WASM and 13 Chrome UI outcomes before the history additions.
- The [1k-member benchmark](evidence/mls-load-1000-2026-10-09.json) passes in a release
  native build with synthetic credentials. These measurements do not raise the product's
  128-device limit or claim network, browser or 1k-member product acceptance.
- History invitations rotate epochs first and carry owner-signed channel cutoffs. Wrapped
  epoch keys are bound to requesting devices. Native policy/recipient/restart checks pass;
  the real HTTP fixture caught a delivery race and now waits for the current epoch before
  issuing a history request. Integration validation continues.
- These changes have not yet been submitted to hosted CI. The original running Phase 1
  server and data remain untouched. Its bundle files will be removed only after a validated
  Phase 2 replacement is ready.

### 2026-10-09: resume the remaining Phase 2 checklist

- Confirmed all 12 hosted jobs pass for `7f8aed2` in
  [run 37890119377](https://github.com/KBHarris/hearth/actions/runs/37890119377), including
  Windows channel UI and media. The earlier ICE failure remains historical evidence;
  no gate was disabled to obtain the new pass.
- Converted every remaining Phase 2 roadmap item to an explicit checkbox. The roadmap
  and progress log are also mirrored into the original project folder so the user can
  inspect current work without switching to the managed development checkout.
- Working next on client-verifiable owner admission, followed by history, attachments,
  text features, profiles/presence/embeds, local search and load measurements.
- The user requested a separate Phase 2 test bundle for two PCs and authorized removing
  the Phase 1 bundle after the replacement is validated. Existing server data stays intact.

### 2026-10-09: encrypted channel iteration

- Added migration 0008 binding channel IDs to MLS conversations, member-only public
  roster snapshots and community/approved-device checks on signed commits/messages.
  Existing DM audiences stay fixed. Channels allow solo initialization and append-only
  account/device rekeys; an existing device must be online for a later join.
- Integrated channels into the existing encrypted engine, store and outbox. Channel
  names identify conversations; owner-only announcements disable member publishing.
  Retry messaging reopens saved state after startup failure. New devices receive only
  post-Welcome messages; neither the host nor directory joining supplies old epoch keys.
- Required npm verification, Rustfmt/clippy/default and combined-feature tests, generated
  protocol checks and WASM portability pass. The
  [HTTP/WASM report](evidence/channels-http-wasm-2026-10-09.json) passes 38 outcomes,
  including eight channel outcomes and all previous auth/DM/community checks. The
  [Chrome UI report](evidence/channels-ui-2026-10-09.json) passes nine outcomes with two
  real isolated clients, no-history admission, automatic rekey, announcements, outage
  recovery and narrow layout. Desktop/narrow screenshots were reviewed.
- Browser tests caught asynchronous selection assumptions and the need for messaging
  startup retry. The composer now disables while opening another channel. HTTP tests
  verify stale-epoch rejection rather than assuming recipient commits arrive instantly;
  older directory tests now allow previously joined communities in the same fixture.
- The first directory commit `a590d32` passes 11/12 hosted jobs in
  [run 37870006242](https://github.com/KBHarris/hearth/actions/runs/37870006242). Windows
  packaged messaging passes, but the later WebView2 media publisher ICE connection fails
  on both attempts. Saved the [failed retry report](evidence/windows-media-failure-2026-10-09.json).
  No media gate is waived. New channel CI has not yet completed.
- The original Phase 1 checkout stays clean, its public server remains healthy with
  migration 6, and the frozen installer/image were not replaced. All new acceptance
  fixtures use disposable data and signing keys in the Phase 2 checkout.
- Limits: 128 devices/channel; larger loads and other-platform channel UI are unverified.
  Admission currently trusts the host directory, so client-verifiable owner approval
  must precede a hostile-host privacy claim. Next: admission hardening, history policies
  and encrypted attachments. The 50-person/week and remaining Phase 2 exit gates stay open.

### 2026-10-08: first Phase 2 community iteration

- Added migration 0007, generated protocol types, validated SDK methods and authenticated
  community/category/channel/invitation APIs. Member-only reads and owner-only changes
  apply independently of server ownership. Invitations serialize competing joins and
  count only new members; category foreign keys cannot cross communities.
- The client creates/joins communities, manages structure and creates/hides invitations.
  Failed directory loads show an explicit retry state rather than an empty directory.
  Channel messaging is visibly unavailable until the MLS/channel slice is implemented.
- Required npm verification, Rust formatting/clippy/default tests, protocol drift and
  WASM portability checks pass. [HTTP/WASM acceptance](evidence/communities-http-wasm-2026-10-08.json)
  passes 30 outcomes; [Chrome UI acceptance](evidence/communities-ui-2026-10-08.json)
  passes five with actual controls and desktop/narrow screenshots reviewed locally.
- Acceptance uses disposable PostgreSQL clusters and fresh server keys in this worktree.
  The development overlay uses independent `hearth-phase2` volumes and ports 18088/5174,
  with no public proxy. No Phase 2 migration or restart touched the live Phase 1 stack.
- The first runs caught a reused fixture account, a collection-route slash mismatch and
  a test helper assuming every error body was JSON; all are corrected. UI readiness
  waits now cover IPv4 binding and account-unlock/remount readiness.
- Next: bind channels to MLS conversations, enforce roster synchronization and implement
  encrypted channel text. History policies, attachments, text extras, load benchmarks
  and the 50-person/week exit criterion remain pending. Hosted Phase 2 CI is not yet verified.

### 2026-10-08: preserve the pending two-PC test

- On the user's request to continue, preserved implementation `43ac92b` in
  `target/manual-test/phase1-43ac92b`: versioned client ZIP, server image archive,
  checksums and a launcher using a digest-pinned image with no build step.
  [Frozen test manifest](evidence/phase1-frozen-test-2026-10-08.json).
- Read-only inspection found the user's `hearth` HTTPS stack already running. Its
  server executable SHA-256 matches the frozen image. No live service was restarted;
  existing `hearth` database, server-key and certificate volumes are preserved.
  The frozen host folder contains private configuration; only its client ZIP is shareable.
- Phase 2 work begins in the attached `phase2-communities` managed checkout. Its
  development configuration and disposable acceptance databases must be separate
  from the pending Phase 1 test. Use the frozen commands in the updated two-PC guide.

### 2026-10-08: Phase 1 complete and manual test checkpoint

- [All twelve hosted jobs](https://github.com/KBHarris/hearth/actions/runs/37811808453)
  pass for `43ac92b`; [workflow summary](evidence/phase1-ci-2026-10-08.json).
  The [23-outcome HTTP/WASM report](evidence/optimized-wasm-auth-2026-10-08.json) includes
  existing debug-build credential/vault compatibility. Packaged
  [Windows](evidence/encrypted-messaging-packaged-windows-2026-10-08.json),
  [macOS](evidence/encrypted-messaging-packaged-macos-2026-10-08.json) and
  [Linux](evidence/encrypted-messaging-packaged-linux-2026-10-08.json) pass seven product
  outcomes plus native-call/credential/file cleanup. All
  [ten isolated Linux repetitions](evidence/optimized-wasm-linux-repetitions-2026-10-08.json)
  pass with optimized product WASM. Five optimized Windows repetitions also pass locally.
- The debug comparison in run 37811334323 reproduces an OPAQUE registration protocol
  rejection on its fourth Linux repetition, before OS storage; no WASM runtime trap is
  reported. Optimized product WASM preserves the fixed OPAQUE/Argon2 profile and removes
  the observed failure across the ten-run gate. Debug WASM is not shipped by the product
  build; the underlying debug/WebKit compatibility issue remains available for diagnosis.
- Required npm verification, Rust formatting/clippy/tests, native feature clippy and
  the fixture shutdown regression test pass. The normal Windows product build and
  unsigned NSIS development installer are rebuilt with optimized WASM. The shareable
  ZIP contains only the installer and START_HERE guide; its checksum/source are in
  [the two-PC guide](TWO_PC_DM_TEST.md). No public server exposure or router change was
  made here. The original development server/data remain healthy and preserved.
- Updated README, this tracker, the roadmap, ADR 0008 and the test guide. The IP-change
  guide now correctly distinguishes native server/account storage from browser-origin
  storage. PR #2 remains a draft. Stop at the manual two-PC DM checkpoint before Phase 2.

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
