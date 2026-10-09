# Phase 2 test with two PCs

You host a fresh Phase 2 server on Windows with Docker Desktop (Linux containers) and
Node.js 22+. Both PCs install **Hearth Phase 2 Test**. Your friend needs no development
tools. The unsigned test installer may prompt Windows SmartScreen and installs WebView2
if missing. This app uses a separate profile from the original Hearth installation.

Use the versioned folder under `target/manual-test/phase2-*`. Send your friend only
`Hearth_Phase2_*_Windows_Test.zip`. Keep the server archive and host folder on your PC.
Do not share generated `deploy/.env`, `deploy/s3.json`, owner codes or recovery kits.
`manifest.json` identifies the source commit and SHA-256 hashes of the prepared files.

## Start locally first

Extract the client ZIP and install the app on your PC. Open PowerShell in the versioned
bundle folder, then run:

```powershell
docker load --input (Get-ChildItem Hearth_Server_Phase2_*.tar).FullName
node deploy/setup.mjs
node deploy/setup.mjs --show-setup-code
```

Connect the app to `http://127.0.0.1:8182`. Enter the owner code and create a **new** account.
This stack uses project `hearth-phase2-test`, separate PostgreSQL, server-key and file
volumes. It does not upgrade the existing Phase 1 database or carry accounts/history over.
Keep the bundle folder in place: Compose mounts its storage configuration and Caddyfile.

## Public HTTPS for your friend

Compare the router's WAN IPv4 with an IP-check website with any VPN disabled. They must
match and be publicly routable. Resolve double NAT/CGNAT with the ISP if they differ.
Reserve this PC's LAN address and forward **TCP 80 and 443** to it. Allow these ports
through Windows Firewall. Keep backend 8182, S3 18334 and PostgreSQL private.

Edit the generated configuration:

```powershell
notepad deploy/.env
```

Set `HEARTH_PUBLIC_ADDRESS` to your actual public IPv4 or domain, without a scheme,
port or path. Preserve all generated passwords and keys. A domain is optional; Caddy
is configured to request a short-lived public IP certificate and renew automatically.
Certificate issuance and reachability between your two houses require this human test.

If the old Phase 1 proxy is still using ports 80/443, stop **only that proxy** before
starting Phase 2 HTTPS. The old backend and its data remain available:

```powershell
docker stop hearth-proxy-1
node deploy/setup.mjs --https
```

Check `https://YOUR_PUBLIC_ADDRESS/health` from a phone on cellular data. Expect
`"status":"ok"` without a certificate warning. Both clients should use this same HTTPS
address. A router without NAT loopback may prevent access from your own LAN; resolve
that routing issue before the two-PC test. Leave Caddy running for certificate renewal.

To return the public ports to Phase 1 later, stop the new proxy and restart the old one:

```powershell
docker compose -f deploy/compose.yaml -f deploy/compose.https.yaml stop proxy
docker start hearth-proxy-1
```

These commands preserve both sets of data. Do not delete volumes to troubleshoot.

## Accounts, DMs and community approval

1. Install the same Phase 2 app on both PCs and connect to the HTTPS address.
2. In **Server settings**, keep registration **Invite only** and create an **account
   invite**. Send that code and the client ZIP to your friend. They register a new account.
3. Both people export a recovery kit with a separate passphrase. Compare identity
   fingerprints over your existing trusted call or messaging channel.
4. Start a DM by username. Test text both ways, replies, edits, deletes, typing, and an
   offline message while one client is closed. Reopen/sign in and confirm history persists.
5. Create a community and a text channel. Create a **community invite** under
   **Manage community** and send it to your friend. This differs from the account invite.
6. Your friend joins and opens the channel. Compare their fingerprint, then approve
   their pending membership on the owner PC. Keep an existing approved client online
   for new-device rekeying and historical-key handoff.

## Phase 2 checklist

Record pass/fail and any visible error for these checks:

- Categories and text channels; owner-only announcement posting, with member reactions.
- Replies, reactions, owner channel pins and threads. Markdown and mentions render safely.
- Read markers, local profile/bio and presence. Invisible presence appears offline.
- A sender-written link preview; neither client nor server automatically fetches metadata.
- Search on each device, including mixed-case words and a deleted message disappearing.
- A small text file and PNG in both directions. Downloaded bytes match the original.
  Image thumbnails are created locally and encrypted. The current file limit is 8 MiB.
- Owner publishes a channel custom emoji, then both send `:name:` in messages. Publish
  again after a new member joins a channel without earlier history.
- **None history:** post before inviting; the new member cannot read that earlier message.
- **Since invite:** set policy first, post a before-invite marker, create a fresh community
  invite, then post an after-invite marker. Join/approve a fresh test account/device;
  history should include only messages at or after the signed invitation cutoff.
- **Full history:** set policy before posting and inviting; an approved fresh device gets
  archived content when an existing holder is online. Enabling history later cannot
  reconstruct messages that were never archived.
- Optional recovery/linking on a fresh device: compare identity, approve it and test new
  messages plus the relevant channel history policy.

For history comparisons use a fresh account/device; changing a policy cannot erase
messages or keys already delivered to someone's device. History archives retain epoch
keys locally, trading some retrospective forward secrecy for history availability.
Completed encrypted file objects have no automated retention purge yet (Phase 3).
The product limit remains 128 devices per channel; the synthetic 1,000-member benchmark
does not increase it. Voice/video, federation and governance remain later phases.

The two-PC session is a useful smoke test. Phase 2's separate 50-person community running
for a week remains an open acceptance gate.

## Troubleshooting and reporting

```powershell
docker compose -f deploy/compose.yaml -f deploy/compose.https.yaml ps
docker compose -f deploy/compose.yaml -f deploy/compose.https.yaml logs --tail 80 proxy
```

If file uploads fail, check storage health and the HTTPS `/hearth-blobs/` proxy route.
If joining/history waits, keep the owner signed in and check pending approval. For a
request-limit message, wait a minute, then retry. Record the manifest source commit,
Windows versions, failed checklist step and visible error. Exclude passwords, codes,
tokens, private messages and recovery passphrases from reports.

Stop services with `docker compose -f deploy/compose.yaml -f deploy/compose.https.yaml stop`.
Restart with `node deploy/setup.mjs --https`. Back up matching PostgreSQL, server-key and
storage volumes together with operator configuration. Remove router forwarding when
public testing ends.
