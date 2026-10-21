# Guided Host/Join setup

Updated 2026-10-20, branch `codex/guided-setup`. Existing releases remain immutable.
Published [Preview 0.3.5](https://github.com/KBHarris/hearth/releases/tag/v0.3.5)
adds the Host/Join operations described below, with
[16 installed checks](evidence/windows-host-join-preview-0.3.5-2026-10-20.json) and
[verified public downloads/catalog](evidence/preview-0.3.5-publication-2026-10-20.json).
Earlier Preview 0.3.4 code-only sharing, native host configuration and protected
local owner authorization retain their [18 installed checks](evidence/windows-preview-0.3.4-2026-10-17.json).
The buddy-PC/two-household test is [accepted by user instruction for Phase 3](evidence/phase3-manual-acceptance-2026-10-17.json).
This does not close the all-OS clean-machine installation checkpoint below.
Phase 3 preview is now [complete with full hosted acceptance](evidence/phase3-final-hosted-2026-10-18.json)
on source `53659dd`. This document's remaining implementation slice is the next
checkpoint before Phase 4.

## Available in this pass

A fresh client presents **Join a server** and **Host a server**. Returning clients
reopen their saved server; Add server presents the same guided flow without
unmounting an existing account or chat until another server is confirmed.

- Join accepts a server address and an optional pretty invite code. Old pasted
  Hearth links remain compatible. Checking an
  address does not save it or sign out the current account. Continue confirms it.
- Host checks a running Hearth server and hands off to owner enrollment or sign-in.
  Desktop **Hosting & updates** can select a signed extracted host package,
  configure its public address/HTTPS, start/stop it and retrieve the owner code
  through protected local IPC. Docker Desktop is required. Configuration is
  generated natively; Node.js is only needed by the advanced CLI. On the owner
  form, **Use this computer's host** avoids copying the private setup code.
- Readiness checks real health, protocol compatibility, setup status and server
  identity. An invite must match the returned key and any existing local pin.
  The active server identity is also checked if local storage cannot be read.
- Readiness labels loopback/private/shared addressing and explicitly leaves
  outside-household reachability **not checked**. A timeout is not evidence of
  CGNAT or a router loopback problem. No third-party network probe is contacted.
- Server owners can share an account invite containing the server address and
  identity. Community owners can share a community invite; a community owner who
  is also the server owner can include one new account in the same invite.
- The recipient creates an account or signs in, then explicitly confirms joining
  the invited community. Existing signed admissions and approved-device checks
  remain in force. A successful join is not proof that encrypted channels are
  ready; an approved member device may still need to come online.
- Failed local community admission can retry a successful one-use claim without
  discarding its in-memory community result. Existing-account sign-in discards
  the unused account capability and retains the community handoff.

## Invite format and storage

New invites display only the grouped 32-character code and a separate server
address. Copy code copies just the code. The recipient enters both fields in
Join a server. A host connected locally can use the selected host's public HTTPS
address for sharing; its identity is checked before using that automatic hint.
The envelope is stored through the existing authenticated local connection,
without sending its bearer token to the editable recipient address.

Old links remain compatible:
`hearth://join/#v=2&server=<origin>&code=<32-readable-characters>`

The random 160-bit Crockford code is displayed in eight groups of four. The
client derives separate lookup and encryption keys using domain-separated SHA-256,
then retrieves and decrypts an origin-bound AES-GCM invite envelope. The relay
stores only its hash, nonce, ciphertext, creator and expiry, with bounded quotas.
It does not receive the readable code or raw account/community capabilities.
The decrypted server identity must match discovery and any existing pin.
Duplicate/unknown fields, credentials, query strings, other paths, insecure remote
origins and owner bootstrap fields are rejected. Existing v1 links remain valid.
Bare admission/bootstrap codes are rejected as server addresses before DNS or
fetch, preventing an accidental paste from turning a capability into a hostname.

For old links the fragment keeps codes out of HTTP paths and queries. The desktop
installer registers the `hearth` scheme. Cold-start and already-open app handoffs
offer **Review invite**, then require Check and Continue; opening a link never
changes an existing session automatically. There is no hosted web landing page.

Invite capabilities remain in component memory and are cleared on discard,
successful consumption or switching servers; a reload requires pasting again.
Only successful server origins/names and existing public identity pins are saved.
Copy explicitly writes the invite to the system clipboard, which is controlled by
the OS and any enabled clipboard history or synchronization. Share privately.
The encrypted relay uses the invite-links endpoints and migration 0023. No
analytics or centralized invite directory is introduced.

Account invites remain single-use/24-hour. A combined invite's community policy
can expire sooner or allow more uses, but its included account capability still
creates only one account. Keep normal community admission settings explicit.
The shareable combined invite stays hidden until both capabilities are ready.

## Validation

The [2026-10-16 local record](evidence/phase3-local-2026-10-16.json) records 94 real
HTTP/private-S3, 51 broad two-client browser, 13 focused account-code, 19 Windows
packaged, six real Docker rollback and three signed-package checks. The separate
[installer record](evidence/windows-preview-2026-10-16.json) passes 19 checks for
the actual Preview NSIS binary, embedded source revision, OS URI registration,
cold/warm invite handoff, native hosting controls and all 23 migrations. These are
local results; clean buddy-PC, two-house and current macOS/Linux acceptance are open.
The original historical pass is retained below for comparison.

The [2026-10-15 sanitized record](evidence/guided-setup-2026-10-15.json) includes a
46-check broad regression run and the final 12-check real guided join and
seven-check mock failure suites, with the final source hashes. The broad run
preceded the last hardening changes; the focused runs cover those changes.
Final npm verification passes 38 tests and the production build. Rust formatting,
clippy and 34 default tests pass (four PostgreSQL integration tests are ignored by
the default command). The follow-up [Windows buddy bundle](TWO_PC_LATEST_TEST.md)
has [installed-product smoke evidence](evidence/windows-buddy-bundle-2026-10-15.json)
for the actual NSIS installer, production WebView2 flow and native IPC. It does
not yet claim native account creation, a clean buddy PC, two-house messaging or
new macOS/Linux packaging.

- `node --experimental-strip-types --test packages/sdk/test/setup.test.mjs`
- `HEARTH_PREBUILT_WASM=1 npm run verify` with the current Phase 3 product artifact.
- `node scripts/verify-community-ui.mjs --phase3 --storage --guided-setup`
  uses disposable native PostgreSQL, a private S3 fixture and two Chrome profiles.
  PostgreSQL tools must be on PATH (or supplied through `PGBIN`), and the browser
  harness needs Selenium/Chrome as for the existing Phase 3 UI checks.
  Output lives in ignored `target/setup-evidence`, including desktop/narrow
  screenshots. A checked-in sanitized evidence file records a successful run.
- Add `--setup-only` for the shorter real owner/invite/new-account/community/
  encrypted-message path, with output in `target/setup-join-evidence`.
- `node scripts/verify-setup-ui.mjs` separately checks browser cancellation,
  failed discovery and registration retry using mock public responses. Its
  `target/setup-failure-evidence` report is not evidence of real server admission.

## Host/Join implementation, 2026-10-20

Preview 0.3.5 source adds the following ordinary UI operations. This is an
implementation update; the [clean-machine acceptance matrix](HOST_JOIN_ACCEPTANCE.md)
remains a separate gate before Phase 4.
The [actual Windows installer upgrade](evidence/windows-host-join-preview-0.3.5-2026-10-20.json)
passes 16 checks on source `b84c11f`, including the reported missing-host recovery
with empty browser storage, preservation of native profiles and the existing
running host, compatible native invite handoff and fresh package services.

- **Prepare this computer to host** downloads a signed catalog from the pinned
  Hearth release source, checks client compatibility and the archive digest,
  extracts only regular allowlisted package files, and validates the inner signed
  manifest and server archive. Preparation reuses an existing selected host.
  Release tooling prepares `host-package.json`, its signature and a host-only TAR;
  those assets are now published with Preview 0.3.5 and verified over public HTTPS.
  Stable and preview feeds
  remain separate. Existing signed folders can still be selected without downloads.
- **Install hosting runtime** is an explicit action with separate OS consent.
  Windows x64 and macOS Intel/Apple Silicon use immutable Docker Desktop 4.96.0
  vendor downloads and pinned SHA-256 checksums, reviewed 2026-10-20. Windows also
  checks Authenticode; macOS checks the application code signature and runs the
  vendor installer through its administrator prompt. Docker presents its own
  license/first-run choices. Ubuntu uses authenticated distribution packages
  `docker.io` and `docker-compose-v2` through PolicyKit, with explicit Docker group
  enrollment and a required sign-out. Other Linux distributions retain their
  supported package-installation path. Virtualization and supported OS versions
  remain vendor prerequisites; installation is not claimed to pass on every PC.
- **Start this host when I sign in** creates a per-profile Windows startup shortcut,
  macOS LaunchAgent or Linux autostart entry. It reopens this app's existing host,
  waits for Docker and starts the existing services. Startup status and disabling
  enrollment are available in the same panel. Disabling app startup does not stop
  already running Docker containers. **Stop server** stops hosting explicitly.
- **Export server backup** pauses the selected host, rehearses PostgreSQL recovery,
  checks the server identity files, includes the signed deployment package and
  server/helper images, and restarts the host. Export folders contain private
  server credentials and signing keys as well as encrypted content: protect them
  like a recovery kit. They are not an encrypted backup format.
- **Restore server onto this computer** validates all declared files and volume
  archive paths, checks the signed package/runtime, rejects an existing project's
  containers or volumes, then restores to a new app-managed folder. An interrupted
  import retains a journal so retry reuses the same target and credentials. The
  selected host changes only after successful startup. The old host must remain
  stopped to prevent two servers from using the same identity. Backups are trusted
  local inputs containing executable server images; do not import strangers' backups.
- **Check access from another network** creates a 15-minute public-address/identity
  challenge. A tester on another household or cellular checks HTTPS, protocol,
  health and the expected server identity without credentials. The result is
  matched to the originating challenge and local identity. Network location is
  explicitly tester-declared, not cryptographically proven or geolocated; these
  JSON results are not signatures. No third-party probe is contacted. Firewall,
  routing, WAN-address interpretation and optional tunnel trust boundaries appear
  alongside the checks. A tunnel is never provisioned or enrolled automatically.
- Native saved-host discovery is independent of browser saved-server storage and
  Docker availability. The rail offers the selected host after reopening even
  when the browser's server list is empty. Failed status checks preserve the host
  and display recovery information. Host selections are saved with atomic replacement.

Runtime references reviewed 2026-10-20:
[Windows](https://docs.docker.com/desktop/setup/install/windows-install/),
[macOS](https://docs.docker.com/desktop/setup/install/mac-install/),
[vendor checksums](https://docs.docker.com/desktop/release-notes/).
Linux automatic setup deliberately uses Ubuntu's authenticated distribution
packages rather than downloading and executing an unsigned installation script.

## Previous checkpoint baseline

Checkpoint update, 2026-10-17 (published Preview 0.3.4): desktop host configuration is generated natively,
removing the Node.js prerequisite from UI hosting. The advanced CLI still uses
Node. Existing credentials and storage configuration remain unchanged on retry;
conflicting files fail before any write. Docker installation remains manual.

The native owner form adds **Use this computer's host**. Protected IPC accepts
only the selected loopback host and configured port, rechecks its identity and
requires incomplete owner setup before retrieving its private code. The code
stays in component memory for at most five minutes, never appears in an input
or clipboard, and clears on submit, cancellation, expiry or unmount. Manual
setup remains available for remote hosts. Actual installed Windows authorization,
remote rejection and expiry pass; clean-machine owner account creation and the
complete cross-platform installation checkpoint remain open.

The original [installation acceptance standard](HAVEN_PARITY_AND_SETUP.md) remains
the target. This pass does not complete the no-prerequisite hosting installer.

1. **Automatic runtime and package preparation.** Choose/package supported runtime
   dependencies per OS and prepare the signed host package through the app.
   Separate app installation from privileged service/firewall consent, preserve
   existing selections and data, and bind management to the local app. Node is
   no longer needed by desktop hosting; Docker installation is still manual.
2. **Opt-in startup.** Existing Docker services continue after Hearth closes.
   Add explicit background/startup enrollment, status and a way to disable it;
   verify restart without replacing keys, credentials or volumes.
3. **Fresh-host restore.** Signed updates, local backup rehearsal and failed-update
   rollback work. Add UI import/restore onto a fresh host, validating the backup
   and preserving server identity and data before switching to it.
4. **Internet setup and optional relay evaluation.** Local/public address choices,
   HTTPS checks and separate public invite addresses are available. Finish
   firewall/routing guidance and independent outside-network checks. Diagnose
   CGNAT/loopback only with sufficient evidence. Any optional tunnel/relay needs
   explicit provider and web-client trust boundaries; no implicit third party.
5. **Clean-machine acceptance.** Exercise installed owner creation, two-house
   encrypted messaging, reboot persistence, failed setup, update and fresh restore
   on each supported OS. Windows native cold/warm invite handoffs pass; actual
   macOS/Linux native invite and installation/runtime evidence remain pending.

Use isolated disposable instances to validate these features. The current 0.3.0
distribution remains pinned to its source and checksums; prepare a new versioned
package after changing application or server code.

## Phase 4 cloud hosting option

The [Phase 4 hosting and media plan](PHASE4_HOSTING_AND_MEDIA.md), added 2026-10-16,
defines a separate Railway IaC path for backend/database/storage provisioning,
optional browser hosting and guided owner enrollment, with identity-preserving
retry, update and restore. It also specifies direct P2P media with TURN fallback
and optional separately hosted LiveKit. This is planned work and does not close
the local installer, native invite or clean-machine gates above.
