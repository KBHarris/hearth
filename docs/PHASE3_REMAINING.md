# Phase 3 remaining work

Updated 2026-10-15. This is the agreed work order for the remaining Phase 3 scope.
The additions below are planned; they are not included in Hearth Test 0.3.0.
Existing implementation and dated evidence are in [the development guide](PHASE3_DEVELOPMENT.md).

## Ordered checklist

1. [ ] **Raise file uploads to 50 MB.** Accept files through 50,000,000 bytes,
   replacing the current 8 MiB client limit. Align client, protocol, server,
   storage and proxy limits, allowing for encryption overhead. Update visible
   limits and errors. Check boundary sizes, encrypted round-trip integrity,
   cancellation and rejection above the limit; retain private storage.
2. [ ] **Let the server owner delete uploaded files.** Provide a clear owner
   action with confirmation and visible completion/error states. Define explicit
   operator authority separately from community ownership and ordinary membership;
   extend the permission matrix with allowed and denied cases. Block new reads,
   remove stored ciphertext and handle active upload leases, retry and restart.
   The server receives no plaintext or decryption keys. Previously downloaded
   copies cannot be recalled; removal must not break the remaining conversation.
3. [ ] **Add the member sidebar.** Use the heading **Server Members**, with circular
   avatars (initials as a fallback), names and readable role labels. Use the
   current community's authorized membership and role data; the heading does not
   authorize revealing every server account or membership in private communities.
   Reflect joins, departures and role changes without losing drafts or sessions.
   Make the list easy to open on narrow windows and usable with a keyboard.
   Replace the hidden Conversation members workflow for everyday discovery.
   Do not group by Online/Offline: current encrypted presence reaches shared
   conversations only, and missing/expired presence is not proof of being offline.
4. [ ] **Open a profile modal from a member.** Show their avatar, display name,
   username, about information, applicable roles and identity fingerprint, with
   an easy way to copy/compare the fingerprint. Use verified identity data and
   authorized profile data; distinguish unavailable data from verified data.
   Avatar images, if added, follow the encrypted-file model. Support Escape,
   focus return and narrow layouts. Keep identity comparison available in DMs.
5. [ ] **Validate the changes and prepare the next test build.** Extend the real
   HTTP/private-S3, two-client UI and packaged Windows checks for the four items
   above, including permission failures, 50 MB encrypted files, physical deletion,
   roster/role updates and profile fingerprints. Run normal Rust/web/WASM checks.
   Produce a new versioned installer/server package with matching source, manifest
   and checksums. Keep the existing 0.3.0 distribution immutable.
6. [ ] **Complete the real two-PC test.** Install the new build on a clean buddy
   PC; exercise native owner/account creation, invitation, approved devices,
   encrypted DMs/channels, files, owner deletion, roles, member profiles and
   reopen/reboot persistence. Use the public HTTPS address before sharing an
   invite and verify access from another household. Record failures and fix them.
   The current manual deployment path is sufficient for this Phase 3 test.
7. [ ] **Verify real notification delivery.** In supported secure browsers, test
   opt-in, actual provider acceptance, OS notification display, click navigation
   and disabling delivery. Notifications remain generic and content-free. Local
   push fixtures alone do not close this item.
8. [ ] **Complete current cross-platform acceptance and close Phase 3.** Run hosted
   checks and current Windows, macOS and Linux packaged runtime acceptance against
   the final Phase 3 source, including the new features and existing permission,
   reporting, retention and account-departure coverage. Investigate a hosted job
   startup failure if it recurs; older green artifacts do not validate this build.
   Fix remaining failures, record results and confirm all preceding items pass
   before marking Phase 3 complete.

## Following Phase 3

The [full Host/Join installation checkpoint](GUIDED_SETUP.md#next-implementation-slice)
remains next, before Phase 4 media: installer-managed services and owner enrollment,
local versus public address guidance, HTTPS/firewall/outside-reachability checks,
native invite opening, background hosting, updates, backup/restore and clean-machine
acceptance. The existing guided client entry and pasted invites are already implemented.
The optional tunnel/relay evaluation remains part of that setup checkpoint.

The 50-person, one-week community trial remains an open **Phase 2** human gate;
the two-PC test does not substitute for it. It is not silently marked complete by
finishing the Phase 3 checklist. See [the roadmap](ROADMAP.md).
