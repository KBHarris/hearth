# Test the latest Hearth build with two PCs

This Windows x64 test bundle includes guided Host/Join, encrypted communities,
50 MB files, member profiles, readable invites, roles, reports, forums and polls.
Both people install **Hearth Preview 0.3.1**. The steps below assume a fresh test host.
Keep any existing host's database, operator configuration and signing keys together;
never regenerate credentials for existing volumes. The local older
test deployments and profiles were retired on 2026-10-15. Create new accounts for
this test and export fresh recovery kits after enrollment.

## What to send

Send your buddy only `Hearth_Test_*_Windows_x64.zip` from the prepared folder.
It contains the unsigned installer, a short guide and its SHA-256 checksum. Your
buddy does not need Docker, Node, a setup code or the host folder.

Keep `Hearth_Server_Test_*.tar`, `deploy` and the host guide on your PC. Generated
`.env`, `s3.json`, owner codes, passwords and recovery kits are private.
The manifest pins the source commit, server image and file checksums.

## Host: start the new server

You need Docker Desktop running Linux containers, Node.js 22+ and an internet
connection for prerequisite images and HTTPS setup. Prerequisite installation is
manual; starting and stopping a configured Hearth host is available in the app.

Install the client on your PC too. Open **Hosting & updates** (server icon on the
left, also available from **Host a server**), turn off public HTTPS for this first
local check, and choose the extracted folder containing `manifest.json`. Choose
**Start server**. The app imports the matching server image if needed and creates
private configuration. Expand **Owner setup → Get owner setup code**.

Open **Hearth Preview → Host a server**, enter `http://127.0.0.1:8183`, check it, and
choose **Set up owner account**. Enter the private setup code and create your new
owner account. The setup code is cleared when the hosting panel closes; select it
and copy before closing. This uses Compose project `hearth-guided-test`, backend 8183 and S3
18335, with separate data volumes. Keep this folder in place while hosting.

## Host: make it reachable from your buddy's house

1. In **Hosting & updates**, stop the local host, enable public HTTPS, enter your
   public IPv4 or DNS name without a scheme, path or port, and **Save host settings**.
   Your generated passwords and keys are preserved.
2. Point router TCP 80/443 forwarding at this PC and allow those ports through the
   firewall. Leave backend 8183, S3 18335 and the database private. If the router's
   WAN address is private/shared or differs from your public address, resolve the
   upstream routing/CGNAT situation before attempting direct public hosting.
3. Check that public ports 80/443 are available for this bundle's HTTPS proxy.
   If another service owns them, resolve that conflict before starting the proxy.
4. Choose **Start server** in the hosting panel. Refresh status and check Hearth's
   public address. Running services alone do not prove outside reachability.
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
   to finish. The readable code has 32 random characters, grouped in fours. The
   short link lasts up to 24 hours; the account invitation remains single use and
   community expiry/use limits still apply.
3. Send that complete `hearth://join/#...` invite privately, separately from the
   ZIP. It includes the server address and public identity. Do not send the owner
   setup code. Keep your owner client signed in while your buddy joins.
4. Your buddy extracts the ZIP, runs the installer, opens **Hearth Preview → Join a
   server**, pastes the entire invite, checks it and continues to account setup.
   Alternatively, click the invite and choose **Review invite** in Hearth, then
   check and continue. A link never switches servers automatically.
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
- Upload/download a small text file, PNG and a file of exactly 50,000,000 bytes in
  both directions; compare bytes. Check rejection above 50 MB and cancel/retry.
- As server owner, remove a file with confirmation; verify a new download fails
  while other messages still work. Previously downloaded copies remain available.
- Open **Server Members**, check names/roles, open a profile and compare/copy the
  fingerprint. Resize and test Escape/focus return. No Online/Offline grouping is used.
- Try threads, pins, local search, encrypted profiles and presence.
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

Use **Hosting & updates → Stop server / Start server**. Hosting continues when the
client app closes. Stopping preserves data. Remove router forwarding when public
testing is finished.

**Check for updates** checks signed app and hosted-server releases. Update the app
first if required. Server updates pause hosting, snapshot its data and operator
configuration, rehearse restoring PostgreSQL and verify the restored identity
before applying the new image. A failed start restores the previous image and data.
**Restore last backup** also permits explicit recovery; it replaces changes made
since that backup. Backups stay private in the app's data folder.

The command-line alternative remains available from the bundle folder:

```powershell
docker compose -f deploy/compose.yaml -f deploy/compose.https.yaml stop
node deploy/setup.mjs --https
```

The first command stops without deleting data; the second resumes public hosting.
