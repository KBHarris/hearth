# Threat Model (draft)

> Phase 1 draft. It is updated with every phase, and every new server-side field must be
> added to the metadata inventory below.

## Assets

1. Message, attachment, and media plaintext
2. User identity and device private keys, and recovery kits
3. Social graph: who talks to whom, who belongs to which community, and when
4. Account credentials

## Adversaries

| Adversary | Capabilities | Must NOT learn or do |
|---|---|---|
| Honest-but-curious server operator | Full DB, S3, logs, and SFU access | Any content (1). Plaintext passwords and client credential secrets (4). |
| Malicious server operator | Above, plus modified server code | Content (1). Injecting undetected devices into a user's identity; clients must warn on key changes. |
| Federation peer | Everything its own users can see, plus the S2S traffic it receives | Content of groups it has no members in. |
| Network attacker | Passive or active on the path | Anything beyond TLS-protected traffic metadata. |
| Malicious community member | Legitimate member access | Content from before they joined, beyond what the channel's history policy allows. Content after removal. |
| Bot | Granted channels only | Plaintext of channels it wasn't granted. |
| Lost or stolen device | Local store | Content, if the OS keystore is locked. Continued access once the device is revoked. |

## Metadata inventory (server-visible)

| Data | Why needed | Retention |
|---|---|---|
| `instance_settings` | Operator configuration | Until changed |
| Server signing key | Federation identity | Life of the server |
| `accounts`: random ID, username, owner flag, profile version, creation time | Account lookup, authorization and credential compatibility; usernames are server-visible | Account lifetime; account deletion is not implemented yet |
| `accounts.password_file` | Sensitive OPAQUE registration record; never a plaintext password | Account lifetime, including database backups |
| `opaque.setup` | Sensitive persistent OPAQUE server secrets; required for existing credentials | Life of the account database, including matching backups |
| `setup.code` and its in-memory digest | Operator-only random owner bootstrap capability; routes close after successful claim | Server data lifetime; unusable for another claim after setup completion |
| `auth_login_exchanges`: hashed exchange ID, nullable account ID, username, secret OPAQUE state, expiry | Bind and atomically consume a pending login; dummy records conceal unknown usernames at the protocol layer | Consumed on any submitted proof; otherwise 2 minutes plus cleanup delay, and possible database backup retention |
| `auth_sessions`: hashed token, account ID, creation and expiry times | Authenticate and revoke a 256-bit bearer session | Logout or 24-hour expiry plus cleanup delay, and possible database backup retention |
| OPAQUE spike setup, password file, and pending login state | Opt-in, fixed-user feasibility test only; no product auth endpoint | Test process lifetime; memory only |
| Media spike API secret, scoped JWTs, room/participant IDs, signaling, and RTP metadata | Loopback synthetic fixture only; no product media API | Fixture lifetime; generated secret configuration removed on normal shutdown |

Later Phase 1 milestones add device public keys, MLS KeyPackages, ciphertext envelopes,
and delivery timestamps. Each gets a row here, with its justification.

## Phase 0 discovery and client storage

`/health`, `/.well-known/hearth`, and `GET /api/v1/setup` expose public operational metadata:
database health, application and protocol versions, configured server name, public signing
key, federation preference, and the existence of the setup-complete setting. These GETs allow
cross-origin reads without credentials so alternative web clients can discover a server.
This CORS policy is scoped to those routes, not the gateway or future authenticated APIs.
An unavailable database returns an unavailable setup response rather than claiming setup
is incomplete. Federation preference is configuration, not proof of working federation.

The discovery flow saves the last successfully checked server origin in `hearth.server-url`
local storage until the user forgets it or clears site data. This is unencrypted local
metadata that can reveal the user's chosen server to someone with access to the browser
profile. It contains no credentials, identity keys, or message content. Discovery uses HTTPS
except for loopback development origins, omits credentials, rejects redirects, validates
response shapes, and requires compatible protocol advertisements. The displayed signing key
is server-advertised. Authentication now pins it on first use; initial independent
authentication still requires an operator comparison.

## Phase 1 owner authentication

[ADR 0005](adr/0005-owner-authentication.md) specifies the versioned OPAQUE profile. A WASM
worker processes passwords locally. Only OPAQUE protocol messages go to the server; client
session/export keys are discarded for now. Username and advertised Ed25519 server identity
are bound into the exchange. OPAQUE password records and server setup remain sensitive:
compromise of matching server secrets and records enables offline password guessing. No
claim of password immunity after a full server compromise is made.

The browser stores public signing-key pins in `hearth.server-key:<origin>` until site data
is cleared. A changed key blocks sign-in. This protects subsequent connections, not a
malicious first server or compromised web client code. Passwords and bearer tokens are not
persisted by the application. Tokens remain in React memory; JavaScript strings and browser
form/password-manager handling cannot promise memory erasure. Reloading drops the local
token without revoking its server session. Logout revokes the current token; no session
listing, device revocation, password change or recovery is implemented yet.

Auth routes use explicit origin allowlists, no credentialed cookies, 16 KiB body limits,
no-store responses, a 16-operation admission bound and process-local request budgets
(120/minute globally, 10/minute per username). Pending exchanges have a capacity check.
These are prototype safeguards, not distributed abuse protection; server restarts reset
the budgets, and unknown-user response timing has not been audited. Public deployment
requires TLS and further review of edge/distributed limits. Native binding and Compose
publication default to loopback. Discovery's permissive CORS is not applied to auth routes.

Server key files are created with Unix mode 0600 before writing; existing permissive Unix
files and malformed key files fail closed. Windows relies on directory ACLs. Startup with
existing accounts refuses to create missing signing/OPAQUE keys. Operators must protect
the database and its backups, including short-lived secret pending-login state, and keep
matching server-data backups. Authentication request bodies, tokens, setup codes and
password files are not logged by the application; deployment proxies must avoid capturing
these bodies and authorization headers. No independent security audit has occurred.

## Phase 0 crypto experiments

Optional `mls-spike` and `opaque-spike` features exercise fresh, ephemeral state. Neither
the normal application nor server enables them. They are feasibility evidence, not usable
account security or encrypted chat. See [ADR 0002](adr/0002-mls-feasibility.md) and
[ADR 0003](adr/0003-opaque-feasibility.md).

The MLS experiment uses test-device BasicCredentials and requires rollback after rejected
ciphertexts. Product identity binding and atomic encrypted storage are not implemented.
The OPAQUE experiment uses a fixed test password, client WASM state, and a separate Rust
stdio process accepting only protocol messages. Its password file and server setup are
sensitive even though plaintext password bytes are absent. Product transport still needs
TLS, and product records require protected storage, rate limits, and reviewed sessions.
The test session-comparison tag is not a product authentication mechanism. Test reports
print outcomes rather than keys, password files, or protocol transcripts.

## Phase 0 media experiment

The separate [media experiment](adr/0004-media-feasibility.md) uses generated audio/video
and client-only random keys. The local SFU sees signaling, participant identities, timing,
packet sizes, and transport addresses. It receives no media key through bootstrap or
signaling. Wrong/stale-key rejection has been measured in local Chromium/WebView2 and
hosted Chrome/Firefox/Safari/WKWebView/WebView2; SFU packet inspection, MLS participant
authentication and exporter binding remain product integration gates. The
saved reports include runtime capabilities and the browser user agent, but exclude tokens,
keys, SDP, and media content. Failure diagnostics contain numeric connection reasons and
ICE state enums and aggregate SDP candidate counts. Native stage markers are numeric;
they accept no arbitrary text. The Windows diagnostic disables mDNS candidate obfuscation
and permits loopback ICE candidates only for its isolated fixture; this profile is
excluded from product builds.
Production transport requires TLS; loopback WS is test-only.

The opt-in Tauri diagnostic mode serves bundled test code with a separate CSP and command
handler; the normal product entrypoint exposes no spike commands. Its reports prove local
WebView2 MLS IPC and media feasibility, not participant authentication or device permissions.
Deployment bootstrap generates a URL-safe database password once, refuses placeholders,
preserves existing files, and binds the stack to loopback by default. Generated `.env` files
and fixture configuration contain secrets and stay ignored. POSIX file modes are requested;
Windows access still depends on the directory ACL and user profile protection.

## Out of scope (stated honestly)

- Recipients who copy or screenshot content.
- Traffic analysis by an operator (timing, sizes, and membership are visible to the home
  server).
- A compromised client device.
