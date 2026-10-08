# Two-PC encrypted DM test

Prepared 2026-10-08. You host Hearth on Windows with Docker Desktop; both PCs run the
Windows client and connect to the same public HTTPS address. Phase 1 platform acceptance
must finish before this is marked ready for the human test.

## Prerequisites

- Host: this checkout, Node.js 22+ and Docker Desktop running Linux containers.
- Both PCs: `target/debug/bundle/nsis/Hearth_0.1.0_x64-setup.exe`. Your friend needs no
  Node.js, Rust or Docker. This is an unsigned debug test installer; WebView2 is installed
  if missing, which requires internet access.
- Reserve the host PC's LAN IPv4 in your router. Forward TCP 80 and 443 to it.
- A publicly reachable WAN IPv4. A domain is optional.

Compare your router's Internet/WAN IPv4 with an IP-check website, with any VPN disabled.
They should match. `10.*`, `192.168.*`, `172.16.*` through `172.31.*`, and `100.64.*`
through `100.127.*` are private or CGNAT addresses. If the addresses differ, resolve
double NAT or ask the ISP about inbound hosting before certificate issuance.

## Start your server

Open PowerShell in the repository root:

```powershell
npm run setup -- --init-only
notepad deploy\.env
```

Set exactly one line to your actual public IPv4, without scheme, port or path:

```dotenv
HEARTH_PUBLIC_ADDRESS=YOUR_PUBLIC_IPV4
```

Keep `HEARTH_HOST=127.0.0.1`, the generated database password and the default
`HEARTH_CLIENT_ORIGINS`. These origins already permit packaged Windows clients. This
test serves the server API; it does not host the browser client.

Forward **TCP 80 → this PC:80** and **TCP 443 → this PC:443** in the router and allow
those inbound TCP ports through Windows Firewall. Do not forward PostgreSQL, storage,
Vite or backend port 8080. Then run:

```powershell
npm run setup -- --https
```

The overlay uses Caddy 2.11.7, persistent certificates, automatic renewal and WebSocket
forwarding. It forces the backend port to loopback. Docker Compose 2.24.4+ is required.
Local backend health and trusted public HTTPS are checked separately. First issuance
may take a little time; rerun after the certificate is ready. Verify
`https://YOUR_PUBLIC_IPV4/health` from a phone on cellular data: expect JSON with
`"status":"ok"` and no certificate warning.

If the public IP works remotely but fails on your own LAN, the router may lack NAT
loopback. You need NAT loopback or an appropriate routing solution so both clients can
use the same public HTTPS origin. Let’s Encrypt IP certificates last about six days;
leave Caddy running for renewal. If your ISP changes the IP, update the configuration,
restart with the same command and use the new address. Export recovery kits first:
client vaults are scoped to the server origin, so signing in at a changed address can
require identity recovery.

## Accounts and DMs

1. Install and launch Hearth on your PC; connect to `https://YOUR_PUBLIC_IPV4`.
   Retrieve the owner setup code locally:

   ```powershell
   npm run setup -- --https --show-setup-code
   ```

   Enter it in Hearth and create your owner account. Keep that code with you.
2. Open **Server settings**, set the server name, keep registration **Invite only**,
   save the settings and press **Create account invite**.
   Send your buddy that invitation, the HTTPS address and the same client installer.
3. Your buddy installs Hearth, connects and registers a separate username. Both people
   stay signed in to prepare their encrypted devices.
4. Open **Back up your identity**, create and download a recovery kit, and keep its
   separate passphrase. Compare fingerprints under
   **Check identities** over your existing trusted communication channel.
5. Under **Start a conversation**, enter your buddy's username and send a message.
   Your buddy replies in that conversation.

Check text both ways, typing, replies, edits and deletes. Close one client, send from
the other, then reopen/sign in and receive the offline message. Restart the same client
and confirm local history remains. Optionally recover on a fresh install: while an
existing participant stays signed in, the new device receives subsequent messages and
does not inherit old history.

Record build, Windows versions, failed step and visible error. Exclude passwords,
invitation/link codes, session tokens and recovery passphrases from reports. This test
covers DMs; communities, attachments and voice/video are later phases.

## Troubleshooting and stopping

```powershell
docker compose -f deploy/compose.yaml -f deploy/compose.https.yaml ps
docker compose -f deploy/compose.yaml -f deploy/compose.https.yaml logs --tail 80 proxy
docker compose -f deploy/compose.yaml -f deploy/compose.https.yaml stop
```

Stopping preserves the database, signing/authentication keys and certificates. Restart
with `npm run setup -- --https`. Back up PostgreSQL with matching server data. Do not
delete volumes to fix connection errors. Remove router forwarding when testing ends.

Unreachable addresses point to NAT, firewall, forwarding or ISP restrictions. Certificate
errors mean issuance is incomplete or the IP changed. Registration requires an unused
member invitation. A fresh install that signs in but cannot decrypt requires linking
or a recovery kit.

## Verified scope and sources

The [local proxy acceptance](evidence/https-proxy-2026-10-08.json) checks the ACME profile,
loopback backend binding, TLS without client SNI, actual server health/discovery and the
real gateway's WebSocket Hello/Challenge. Its isolated test CA is trusted only by that
test process. Public certificate issuance and access between your houses remain untested.

Hosting facts checked 2026-10-08:

- [Let’s Encrypt IP certificates](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability/).
- [Caddy ACME configuration](https://caddyserver.com/docs/caddyfile/directives/tls),
  [HTTPS ports](https://caddyserver.com/docs/quick-starts/https),
  [WebSocket proxying](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), and
  [default SNI](https://caddyserver.com/docs/caddyfile/options#default_sni).
