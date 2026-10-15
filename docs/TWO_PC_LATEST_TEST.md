# Test the latest Hearth build with two PCs

This Windows x64 test bundle includes guided Host/Join, encrypted communities,
files, roles, reports, forums and polls. Both people install **Hearth Test 0.3.0**.
It has a separate app profile from the older Phase 1/2 test apps. This bundle
creates a fresh server with fresh accounts and keys; it does not migrate an older
test server. Keep old profiles, recovery kits and server data.

## What to send

Send your buddy only `Hearth_Test_*_Windows_x64.zip` from the prepared folder.
It contains the unsigned installer, a short guide and its SHA-256 checksum. Your
buddy does not need Docker, Node, a setup code or the host folder.

Keep `Hearth_Server_Test_*.tar`, `deploy` and the host guide on your PC. Generated
`.env`, `s3.json`, owner codes, passwords and recovery kits are private.
The manifest pins the source commit, server image and file checksums.

## Host: start the new server

You need Docker Desktop running Linux containers, Node.js 22+ and an internet
connection for prerequisite images and HTTPS setup. The app's Host flow checks a
running server; automatic service installation is not part of this test build.

Install the client on your PC too. Open PowerShell in the new bundle folder:

```powershell
docker load --input (Get-ChildItem Hearth_Server_Test_*.tar).FullName
node deploy/setup.mjs
node deploy/setup.mjs --show-setup-code
```

Open **Hearth Test → Host a server**, enter `http://127.0.0.1:8183`, check it, and
choose **Set up owner account**. Enter the private setup code and create your new
owner account. This uses Compose project `hearth-guided-test`, backend 8183 and S3
18335, with separate data volumes. Keep this folder in place while hosting.

## Host: make it reachable from your buddy's house

1. Set `HEARTH_PUBLIC_ADDRESS` in generated `deploy/.env` to your public IPv4 or
   domain, without `https://`, a path or a port. Preserve all generated keys and
   passwords. Do not reuse another bundle's `.env` or `s3.json`.
2. Point router TCP 80/443 forwarding at this PC and allow those ports through the
   firewall. Leave backend 8183, S3 18335 and the database private. If the router's
   WAN address is private/shared or differs from your public address, resolve the
   upstream routing/CGNAT situation before attempting direct public hosting.
3. Only one proxy can own public ports 80/443. If an older Hearth test proxy is
   running, stop only that proxy before starting the new one. For the old Phase 2
   folder, use `docker compose -f deploy/compose.yaml -f deploy/compose.https.yaml
   stop proxy` there. Keep its backend and volumes intact. Do not use `down -v`.
4. Back in this new bundle folder, run `node deploy/setup.mjs --https`.
5. From a phone on cellular data, open `https://YOUR_PUBLIC_ADDRESS/health` and
   check for `"status":"ok"` with no certificate warning. A check from the host PC
   alone does not verify access from another household. NAT loopback may require
   separate troubleshooting if the public address fails only inside your LAN.

Use **Add server → Join a server** on your own client to connect to that same
public HTTPS address and sign in to your owner account. Do this before making
the invite, so its address works at your buddy's house. Your local device keys
are preserved when using the same server identity.

## Invite your buddy

1. In the owner client, create a community and a text channel.
2. Open **Manage community → Invites**, enable **Include a new server account**,
   create the invite, then choose **Copy invite**. Wait for invite preparation
   to finish. This account invitation works once and expires after 24 hours.
3. Send that complete `hearth://join/#...` invite privately, separately from the
   ZIP. It includes the server address and public identity. Do not send the owner
   setup code. Keep your owner client signed in while your buddy joins.
4. Your buddy extracts the ZIP, runs the installer, opens **Hearth Test → Join a
   server**, pastes the entire invite, checks it and continues to account setup.
   Invites are pasted into Hearth; clicking them does not launch this build.
5. Your buddy creates an account, then chooses **Join invited community**. On your
   PC, compare their identity fingerprint over your existing trusted call and
   approve their **Access requests**. They can then open the encrypted channel.

If either person already has an account on this new server, sign in instead of
creating another account. A new/unlinked device may require device linking or a
recovery kit before opening encrypted messages. Reloading clears the pending
invite; paste it again if necessary.

## Two-person checklist

- Both clients show the same community and can send encrypted text both ways.
- Start a DM by username; test reply, edit, delete, reaction and a message sent
  while the other client is closed. Reopen/sign in and check readable history.
- Upload/download a small text file and PNG in both directions and compare bytes.
- Try threads, pins, local search, profiles and presence.
- Create a forum post/reply and a poll; vote from the buddy client and close it.
- Create/assign a role and check a channel permission from both clients.
- Report one selected test message and verify it in the moderator inbox.
- Close and reopen both apps, then restart the host services and check that
  accounts, server identity and readable history remain intact.
- Optional: export recovery kits and test device linking/recovery. Account deletion
  is destructive; use a disposable extra account if testing it.

Record the source commit from `manifest.json`, Windows versions, failed step and
visible error. Exclude private messages, passwords, invite/setup codes, tokens and
recovery passphrases. Voice/video and federation are not included in this build.

## Stop or resume

From this bundle folder:

```powershell
docker compose -f deploy/compose.yaml -f deploy/compose.https.yaml stop
node deploy/setup.mjs --https
```

The first command stops this test without deleting its data. Use the second only
when you want to resume hosting. Before returning ports 80/443 to an older test,
stop this bundle's proxy, then restart that older proxy from its original folder.
Remove router forwarding when public testing is finished.
