# Guided Host/Join setup

First implementation pass: 2026-10-15, branch `codex/guided-setup`.

## Available in this pass

A fresh client presents **Join a server** and **Host a server**. Returning clients
reopen their saved server; Add server presents the same guided flow without
unmounting an existing account or chat until another server is confirmed.

- Join accepts a server address or a single pasted Hearth invite. Checking an
  address does not save it or sign out the current account. Continue confirms it.
- Host checks an **existing running Hearth server** and hands off to its real
  owner enrollment or sign-in screen. The owner code still comes from the existing
  operator installer; this client does not retrieve or embed it.
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

`hearth://join/#v=1&server=<origin>&key=<public-key>&account=<optional-code>&community=<optional-code>`

The version, HTTPS-or-loopback origin and 64-character lowercase hex values are
validated before any network request. A key and at least one admission capability
are required. Duplicate/unknown fields, URL credentials, query strings, other
paths, insecure remote origins and owner bootstrap fields are rejected. The SDK
does not fetch a supplied invite URL. Only public discovery requests go to the
validated server until the user proceeds to account or community admission.
Bare admission/bootstrap codes are rejected as server addresses before DNS or
fetch, preventing an accidental paste from turning a capability into a hostname.

The fragment keeps capabilities out of an HTTP path/query. The UI uses these as
**pasteable invites**; OS click-to-open registration is not implemented. Invites
are not browser URLs served by the API host. A recipient pastes the complete
invite into Hearth's Join a server screen. Do not advertise native link handling
or a hosted web landing page until those are implemented and tested.

Invite capabilities remain in component memory and are cleared on discard,
successful consumption or switching servers; a reload requires pasting again.
Only successful server origins/names and existing public identity pins are saved.
Copy explicitly writes the invite to the system clipboard, which is controlled by
the OS and any enabled clipboard history or synchronization. Share privately.
No new server routes, wire fields, database tables or analytics are introduced.

Account invites remain single-use/24-hour. A combined invite's community policy
can expire sooner or allow more uses, but its included account capability still
creates only one account. Keep normal community admission settings explicit.
The shareable combined invite stays hidden until both capabilities are ready.

## Validation

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

The original [installation acceptance standard](HAVEN_PARITY_AND_SETUP.md) remains
the target. This pass does not complete the no-prerequisite hosting installer.

1. Choose and package the supported hosting runtime and dependencies for each OS.
   Separate app installation from privileged service/firewall operations. Bind
   management to the local app and avoid exposing an unauthenticated control API.
2. Add native, bounded prepare/start/status/retry operations over app-owned data,
   preserving an existing instance's keys and volumes. Retrieve the owner code
   through protected native IPC, use it only for owner enrollment and clear it.
3. Add explicit local/internet hosting choices, HTTPS configuration and independent
   outside-network verification. Diagnose CGNAT/loopback only with sufficient
   evidence; an optional relay requires an explicit trust design.
4. Register and validate native invite links, then test cold-start and already-open
   app handoffs. Keep untrusted capability data out of logs and persistent queues.
5. Add opt-in background hosting/startup, backups, updates, rollback and fresh-host
   restore, then exercise clean-machine and two-house acceptance on each OS.

Do not change the preserved Phase 2 test bundle or running server to test these
features. Use isolated instances until an explicit deployment is requested.
