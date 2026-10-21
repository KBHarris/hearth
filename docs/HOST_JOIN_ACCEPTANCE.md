# Host/Join acceptance

Implementation checkpoint: 2026-10-20, Preview 0.3.5 source. Phase 3 remains complete.
Host/Join is complete only after the installation/runtime and outside-network
checks below have actual evidence. Earlier user-accepted Phase 3 buddy tests do
not provide this new evidence. No clean OS or second household is simulated by
unit tests or a Docker volume reset.

## Evidence matrix

| Check | Windows x64 | macOS Intel / Apple Silicon | Linux desktop |
|---|---|---|---|
| Clean installer, no development tools, runtime install | Pending | Pending on both architectures | Pending on supported Ubuntu; other distributions use manual runtime install |
| Signed host preparation through published catalog | Pending publication and installed test | Pending | Pending |
| Native saved host survives empty browser server list and Docker failure | Six local native QA checks pass | Pending | Pending |
| Actual opt-in sign-in/reboot, host identity/account/history preserved | Pending | Pending | Pending |
| Owner, invite, approved device, encrypted two-household DM/file | Pending | Pending | Pending |
| Failed setup retry, update failure recovery | Local isolated Docker coverage; installed acceptance pending | Pending | Pending |
| Portable export and fresh-machine restore through UI | Local isolated Docker coverage; actual fresh OS pending | Pending | Pending |
| Native cold/warm invite opening | Existing Windows 0.3.4 evidence; repeat on new installer | Pending | Pending |

The actual Windows 0.3.5 installer upgrade passes 16 checks, including preserved
native profiles/host configuration, a running original host, cold/warm native
invites and the saved-host entry in a fresh browser profile. The new disposable
server passes health, discovery, all 23 migrations, private S3 and identity
persistence after restart. This is an upgrade on the existing Windows PC, not
a clean Windows runtime-install measurement. The user confirmed only Windows
machines are currently available for their buddy test; other OS gates remain open.

## Tester flow

1. Install the new version on a supported clean PC with no Node, development tools
   or preinstalled runtime. Choose **Host a server**, then **Start or manage local
   server**. Prepare the signed package and install the runtime. Record any OS
   permission, license, virtualization, sign-out or reboot prompts. A canceled
   prompt must leave a useful next action and preserve the package selection.
2. Start the host. Connect locally and create its owner using **Use this
   computer's host**. Create a community and an encrypted conversation. Record the
   public server fingerprint, not the private setup code or credentials.
3. Close and reopen Hearth. The hosted server must remain visible. Stop Docker,
   reopen the management panel and confirm that the selected folder remains
   visible with useful status. Restart the runtime and refresh; do not select a
   different package or create a new identity to recover this state.
4. Configure a public HTTPS address. Follow the firewall/router guidance. Create
   an outside-network check and send its JSON to a tester using Hearth on a
   different household's network or a supported browser client on cellular with
   Wi-Fi off. The tester confirms that network and runs the check, then returns
   the result. Review it on the host. A wrong identity, expired result or different
   challenge must be rejected. Record tester-declared location honestly.
5. Send a pretty invite code and separate address. The friend installs Hearth,
   joins the intended server/community and completes approved-device admission.
   Exchange encrypted DMs and an encrypted file in both directions. Opening an
   invite must still require review/check/continue and preserve the active session.
6. Enable sign-in startup. Reboot both computers, sign in and verify the same
   server fingerprint, accounts and readable message history. Disable startup,
   stop the host, reboot/sign in and verify Hearth does not start hosting through
   its startup entry. Docker's independent settings are recorded separately.
7. Export a private server backup. Verify the host resumes. On a genuinely fresh
   computer, install Hearth/runtime and import that backup. Keep the old server
   stopped. Verify identical server fingerprint, owner/member accounts, readable
   history and attachment retrieval; update forwarding and repeat the outside
   check. Repeat after interrupting restore to verify its retry journal.
8. Attempt importing onto a computer that already has that host's volumes. It
   must reject before changing them. Check failed-update rollback with the
   disposable operator fixture; never deliberately corrupt a real community.

Keep private backups, owner codes, invite capabilities, database credentials and
messages out of checked-in evidence. Record version, frozen source revision,
installer SHA-256, OS/architecture, measured steps, failure details and cleanup.
Manual acceptance is labeled manual; actual runtime measurements are labeled measured.

## Developer verification

- `npm run verify` and the SDK reachability tests cover malformed/expired/mismatched
  network checks, cancellation, compatible discovery and unauthenticated checking.
- `node scripts/verify-setup-ui.mjs` exercises the existing guided browser failure
  and retry flow, including a real 430px viewport.
- `node scripts/verify-host-controls.mjs <signed-bundle>` uses an isolated random
  Docker project for backup rehearsal, a database-mutating failed update,
  interrupted override recovery, collision rejection and fresh-volume restore.
  It compares identity files, credentials and database contents and retries the
  same restore journal. It never operates the user's selected project.
- Add `--integrity-only` for signed TAR extraction, tampered-package and signature
  rejection. It requires the local release signing key; no key is distributed.
- `node scripts/verify-host-join-native.mjs <qa-executable> <signed-bundle>` is a
  Windows WebView2 smoke test using identifier `chat.hearth.hostjoinqa`. It checks
  native saved-host visibility with empty browser storage and a deliberately
  rejected remote Docker endpoint, plus startup enrollment/disable and reopen.
  Build that executable using a dedicated Tauri config with this identifier.
  Its own QA profile and shortcut are removed afterward. This is neither a clean
  machine test nor evidence that a startup entry executes successfully at login.

The manual-only hosted workflow is not dispatched automatically by these scripts.
Windows and the cached Linux desktop image pass Clippy for all desktop targets.
The Linux check uses a disposable source copy and offline cached dependencies;
it does not measure a Linux desktop installation or startup session. macOS native
compilation/runtime verification remains pending.
