# Saved-host sidebar recovery

## Actual Start-menu failure and recovery, 2026-10-21

The user supplied a screenshot showing the failure still present in local 0.3.6.
It was reproduced by navigating to the actual Start-menu shortcut in File Explorer
and opening it through the Windows UI, without diagnostic browser flags. This
displayed the empty setup screen and no saved host in Hosting & updates.

File Explorer showed only `host-backups` in the normal
`AppData/Roaming/chat.hearth.preview` directory: `host-selection.json` was absent.
The Codex-launched environment instead saw that file and a saved browser server.
Its packaged AppData view included paths under
`AppData/Local/Packages/OpenAI.Codex_.../LocalCache/`. Microsoft documents this
[AppData virtualization behavior](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes#appdata-operations-on-windows-10-version-1903-and-later).
This concrete profile difference explains the blank sidebar; more retries cannot
find a host selection missing from the normal profile.

The original signed host package was selected through **Hosting & updates →
Choose host package**, preserving its existing HTTPS/public address. This writes
the binding in the actual client's profile. The restored sidebar entry was then
used to connect to the already running local server. Gold Team appeared, and
closing/reopening the same shortcut retained it. File Explorer confirmed the new
`host-selection.json` in the real profile. No server start/stop/reset, account
sign-in, credential/key migration or new application build was performed.

The [normal-launch record](evidence/host-sidebar-start-menu-2026-10-21.json) captures
this measured reproduction and recovery. The existing 0.3.6 runtime was sufficient
once its normal profile had the correct binding.

Future Windows acceptance must open the installed shortcut through the actual
Windows UI and verify both native host discovery and persisted browser selection
after closing/reopening. A direct executable launch, isolated WebView profile,
COM/PowerShell helper, or `GetCurrentPackageFullName` probe alone did not establish
equivalence to the user's launch in this environment. Do not merge private app
profiles or migrate encryption keys just to restore a server shortcut.

## Earlier implementation and test checkpoint

The user reported on 2026-10-20 that their server was still absent after reopening
Hearth with Docker running. Investigation resumed on 2026-10-21. This report
reopens real-use acceptance despite the historical Preview 0.3.5 fixture pass.

Read-only checks found the original saved host selection, unchanged signed host
package files and healthy running Hearth services. The installed Preview 0.3.5
showed the saved server during diagnosis. The exact original failure remains
unconfirmed; a missing database, lost host configuration or an old executable
has not been established.

The previous sidebar performed one native lookup and silently ignored failure.
It also did not refresh after changes in Hosting & updates, and hid saved hosts
whose package could not provide a local address. The implementation now:

- Times out stalled lookups after five seconds and retries failures with bounded
  backoff, up to thirty seconds between attempts.
- Refreshes when the app regains focus, becomes visible, or hosting settings change.
- Keeps the last known host entry during a temporary lookup failure.
- Shows **Your host needs attention** when lookup/package recovery is needed;
  that entry opens Hosting & updates.
- Ignores stale results after a newer refresh or component cleanup.

A saved address already present as a named server remains the sidebar entry;
the native fallback does not add a duplicate. Host discovery does not start,
stop or recreate Docker services, sign the user in, or replace saved identities.

Four lifecycle tests cover startup failure, overlapping refreshes, stalled IPC
and cleanup. Six production-bundle browser checks cover visible recovery,
last-known-host preservation, focus refresh, settings updates and 430px layout.
Run `node scripts/verify-saved-host-ui.mjs` after `npm run build`; the browser
fixture injects native responses and does not alter the actual desktop profile.

The local 0.3.6 patch installer is built from base `16c4cab` plus the sidebar frontend
changes and a packaging version override. It excludes uncommitted Phase 4 media
and cloud implementation. The exact patch bundle passes all six browser checks.
After the user closed Hearth, the local patch was installed and passed ten native
checks covering the exact binary/version, empty-browser-list host discovery,
focus/reopening, existing profile visibility, native files, shortcuts and preserved
host containers. A first test's attempted fault injection through the native bridge
timed out waiting for its injection counter; negative scenarios use the browser fixture, while the final
native result checks real focus and reopening. Desktop and Start-menu shortcuts
now point to the verified installation. The existing client was reopened afterward.
[The evidence record](evidence/host-sidebar-recovery-2026-10-21.json) distinguishes
prepared artifacts from installed-client acceptance. No public release, hosted workflow or
Railway deployment is implied.

This local package uses version 0.3.6; a later different Preview payload must use
a higher version. The main development release configuration remains at public
0.3.5 until the next release is frozen separately.

At this earlier checkpoint, normal-use confirmation remained open. The later
reproduction and recovery above close the local missing-binding report with actual
shortcut acceptance. Clean-machine, cross-platform and Docker-startup installation
gates remain separate.
