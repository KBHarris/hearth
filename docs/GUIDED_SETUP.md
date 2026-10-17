# Guided Host/Join setup

Updated 2026-10-17, branch `codex/guided-setup`. Existing releases remain immutable.
Preview 0.3.3 adds code-only sharing with a separate recipient server address.

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
  through protected local IPC. Docker Desktop and Node.js 22+ are prerequisites.
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

## Next implementation slice

Checkpoint source update, 2026-10-17 (next Preview 0.3.4; not included in the
published 0.3.3 installer): desktop host configuration is generated natively,
removing the Node.js prerequisite from UI hosting. The advanced CLI still uses
Node. Existing credentials and storage configuration remain unchanged on retry;
conflicting files fail before any write. Docker installation remains manual.

The native owner form adds **Use this computer's host**. Protected IPC accepts
only the selected loopback host and configured port, rechecks its identity and
requires incomplete owner setup before retrieving its private code. The code
stays in component memory for at most five minutes, never appears in an input
or clipboard, and clears on submit, cancellation, expiry or unmount. Manual
setup remains available for remote hosts. This does not complete clean-machine
or packaged owner-enrollment acceptance.

The original [installation acceptance standard](HAVEN_PARITY_AND_SETUP.md) remains
the target. This pass does not complete the no-prerequisite hosting installer.

1. Choose and package the supported hosting runtime and dependencies for each OS.
   Separate app installation from privileged service/firewall operations. Bind
   management to the local app and avoid exposing an unauthenticated control API.
2. Native Start/Stop/Status and protected owner enrollment are implemented, with
   preserved existing keys and volumes. Finish app-managed package preparation
   and exercise the new enrollment in an installed client on a clean machine.
3. Add explicit local/internet hosting choices, HTTPS configuration and independent
   outside-network verification. Diagnose CGNAT/loopback only with sufficient
   evidence; an optional relay requires an explicit trust design.
4. Windows installer protocol registration and native cold/warm handoffs pass.
   Obtain actual macOS/Linux runtime evidence; it remains pending.
5. Existing Docker services continue after the client closes. Add explicit
   background/startup enrollment and fresh-host restore. Signed updates, local
   backup rehearsal and failed-migration rollback are implemented; exercise
   clean-machine and two-house acceptance on each OS.

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
