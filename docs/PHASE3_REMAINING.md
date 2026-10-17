# Phase 3 remaining work

Updated 2026-10-17. This is the agreed work order for the remaining Phase 3 scope.
Items 1–9 are implemented and locally validated; they are not included in the
immutable Hearth Test 0.3.0 distribution. Hearth Preview 0.3.4 is published and
installed locally. See [local acceptance](evidence/phase3-local-2026-10-16.json)
and [19 installer/package checks](evidence/windows-preview-2026-10-16.json).
The patch additionally passes [13 in-place upgrade/package checks](evidence/windows-preview-0.3.2-2026-10-16.json)
and [nine native hosting/rollback checks](evidence/host-startup-regression-2026-10-16.json).
The [public Preview release](https://github.com/KBHarris/hearth/releases/tag/v0.3.2)
and both signed Preview update feeds are live; anonymous downloads are verified.
Preview 0.3.3 was [published](https://github.com/KBHarris/hearth/releases/tag/v0.3.3)
and installed, adding code-only/public-address sharing and the Linux compatibility
pin. All [15 package/upgrade checks](evidence/windows-preview-0.3.3-2026-10-17.json)
pass. Its [eleven public downloads and both feeds](evidence/preview-0.3.3-release-2026-10-17.json)
match the tested artifacts. The first full hosted run failed on the now-locally
corrected Linux dependency; a further run is awaiting explicit authorization.
The [0.3.4 checkpoint slice](evidence/host-join-checkpoint-2026-10-17.json) removes
the desktop Node prerequisite and adds protected local owner authorization. Its
[18 installed checks](evidence/windows-preview-0.3.4-2026-10-17.json) and
[eleven anonymous downloads/both update feeds](evidence/preview-0.3.4-release-2026-10-17.json)
pass. Docker runtime installation, startup enrollment and fresh-host restore
remain checkpoint work.
Existing implementation and dated evidence are in [the development guide](PHASE3_DEVELOPMENT.md).

The [Actions budget standard](CI_STANDARD.md) applies to every item: validate locally
first and keep hosted workflows manual-only. Request the final-source cross-platform
run at closeout; do not spend hosted minutes on each feature, push or PR.

## Ordered checklist

1. [x] **Raise file uploads to 50 MB.** Accept files through 50,000,000 bytes,
   replacing the current 8 MiB client limit. Align client, protocol, server,
   storage and proxy limits, allowing for encryption overhead. Update visible
   limits and errors. Check boundary sizes, encrypted round-trip integrity,
   cancellation and rejection above the limit; retain private storage.
2. [x] **Let the server owner delete uploaded files.** Provide a clear owner
   action with confirmation and visible completion/error states. Define explicit
   operator authority separately from community ownership and ordinary membership;
   extend the permission matrix with allowed and denied cases. Block new reads,
   remove stored ciphertext and handle active upload leases, retry and restart.
   The server receives no plaintext or decryption keys. Previously downloaded
   copies cannot be recalled; removal must not break the remaining conversation.
3. [x] **Add the member sidebar.** Use the heading **Server Members**, with circular
   avatars (initials as a fallback), names and readable role labels. Use the
   current community's authorized membership and role data; the heading does not
   authorize revealing every server account or membership in private communities.
   Reflect joins, departures and role changes without losing drafts or sessions.
   Make the list easy to open on narrow windows and usable with a keyboard.
   Replace the hidden Conversation members workflow for everyday discovery.
   Do not group by Online/Offline: current encrypted presence reaches shared
   conversations only, and missing/expired presence is not proof of being offline.
4. [x] **Open a profile modal from a member.** Show their avatar, display name,
   username, about information, applicable roles and identity fingerprint, with
   an easy way to copy/compare the fingerprint. Use verified identity data and
   authorized profile data; distinguish unavailable data from verified data.
   Avatar images, if added, follow the encrypted-file model. Support Escape,
   focus return and narrow layouts. Keep identity comparison available in DMs.
5. [x] **Use readable short invites.** Server-account, community and combined
   invitations use a random 32-character code grouped in fours. Preview 0.3.3
   shares only that code with a separate server address, including the public
   address when the owner is connected locally. Store only a domain-separated code hash and client-encrypted
   invite envelope; preserve identity pinning, expiry, use limits and approved
   device requirements. Keep old links compatible and never send bare codes to DNS.
6. [x] **Control local hosting from the desktop UI.** Add Start, Stop and Status
   for the configured local host, available before sign-in. Report missing runtime
   prerequisites and startup failures clearly. Keep host data and identity persistent.
7. [x] **Audit before making the GitHub repository public.** Review source, all
   reachable history, PR content, Actions logs/artifacts and release assets. Resolve
   any actual private data or credentials before changing visibility. Keep workflows
   manual-only and validate the budget policy locally.
8. [x] **Add one-click updates for both app and hosted server.** Use a public,
   signed release source after the audit; verify downloads, preserve server data
   and signing identity, and verify backup/rollback before applying migrations.
   Show honest unavailable/error states until a usable release exists.
9. [x] **Validate the changes and prepare the next test build.** Extend the real
   HTTP/private-S3, two-client UI and packaged Windows checks for the four items
   above, including permission failures, 50 MB encrypted files, physical deletion,
   roster/role updates, profile fingerprints, invite resolution, hosting controls
   and signed update failures. Run normal Rust/web/WASM checks.
   Produce a new versioned installer/server package with matching source, manifest
   and checksums. Keep the existing 0.3.0 distribution immutable.
10. [x] **Real two-PC test waived for this preview.** Waived by the user on
   2026-10-16; this is not a claim of completed two-household testing. Future acceptance: install on a clean buddy
   PC; exercise native owner/account creation, invitation, approved devices,
   encrypted DMs/channels, files, owner deletion, roles, member profiles and
   reopen/reboot persistence. Use the public HTTPS address before sharing an
   invite and verify access from another household. Record failures and fix them.
   The current manual deployment path is sufficient for this Phase 3 test.
11. [x] **Real notification delivery waived for this preview.** Waived by the user
   on 2026-10-16; provider/OS delivery remains unverified. Future acceptance: in supported secure browsers, test
   opt-in, actual provider acceptance, OS notification display, click navigation
   and disabling delivery. Notifications remain generic and content-free. Local
   push fixtures alone do not close this item.
12. [ ] **Complete current cross-platform acceptance, then close Phase 3.**
   Validate the manual-only budget controls and finish local checks. The user
   authorized one full hosted milestone run on 2026-10-16 after the startup fix;
   it failed Linux desktop compilation. That dependency correction passes locally.
   A further full milestone is awaiting explicit authorization. Run current Windows, macOS
   and Linux packaged runtime acceptance against
   the final Phase 3 source, including the new features and existing permission,
   reporting, retention and account-departure coverage. Investigate a hosted job
   startup failure if it recurs; older green artifacts do not validate this build.
   Fix remaining failures, record results and confirm preceding items pass or have explicit preview waivers
   before marking Phase 3 complete.

## Following Phase 3

The [full Host/Join installation checkpoint](GUIDED_SETUP.md#next-implementation-slice)
remains next, before Phase 4 media: installer-managed services and owner enrollment,
local versus public address guidance, HTTPS/firewall/outside-reachability checks,
cross-platform native invite acceptance, background startup and clean-machine
acceptance. Guided client entry, pasted invites and Windows native handoff are implemented.
The optional tunnel/relay evaluation remains part of that setup checkpoint.
Desktop hosting controls and app/server updates have moved into the active scope
above at the user's request; completing those does not close the remaining installer
and outside-network acceptance work.

The 50-person, one-week community trial remains an open **Phase 2** human gate;
the two-PC test does not substitute for it. It is not silently marked complete by
finishing the Phase 3 checklist. See [the roadmap](ROADMAP.md).
