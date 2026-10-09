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
| `accounts.identity_key` | Public Ed25519 account identity, immutable after its first enrollment | Account lifetime, including backups; deletion is not implemented yet |
| `account_devices`: account ID, device public key, certificate, account/device enrollment signatures, creation time | Validate account/server-bound device ownership and return the public roster | Account lifetime, including backups; revocation is not implemented yet |
| `device_link_offers`: hashed high-entropy code ID, account/device IDs, encrypted identity kit, device signature, creation/expiry | Relay an approved-device handoff without learning its code or private identity | Successful consumption or 3-minute expiry plus cleanup delay, including possible backups |
| `account_invites`: hashed invite code, issuer account ID, used flag, creation/expiry | Owner-authorized single-use account creation | Until account deletion or expired-invite cleanup, including possible backups |
| Registration mode and server name in `instance_settings` | Owner-controlled onboarding policy and public discovery | Until changed, including backups |
| `mls_key_packages`: package hash, account/device IDs, signed public KeyPackage bytes, claimed flag, creation/expiry | Single-use public MLS join material; private package secrets remain in the encrypted client store | Consumed at accepted commit or one-hour expiry plus cleanup delay, including possible backups |
| `consumed_mls_packages`: public package digest, device ID, consumption time | Prevent a delayed upload retry from re-advertising a consumed package, including after pool expiry | Device lifetime, including backups |
| `conversations`: random ID, MLS epoch, public device-proof manifest, creation time | Serialize commits and validate the roster against approved devices | Conversation lifetime; deletion is not implemented, including backups |
| `conversation_accounts` and `conversation_devices` | Fixed Phase 1 DM audience and per-device fan-out; exposes the social graph | Conversation lifetime, including backups |
| `delivery_operations`: random operation ID, conversation/account/device IDs, action, optional target operation, payload digest, creation time | Idempotent retry and author-only edits/deletes; operation kinds and reply timing are visible, reply targets remain encrypted | Conversation lifetime, including backups |
| `device_delivery_cursors`: device public key, next sequence | Gap-free, persistent ordering for offline delivery | Device lifetime, including backups |
| `delivery_events`: recipient device, sequence, conversation/operation IDs, public signed envelope, ciphertext, ephemeral flag, creation time | Ordered Welcome/commit/message backlog without decryption | Conversation lifetime; deletion replaces originals/edits with markers; typing is hidden after ten seconds, with backup retention possible |
| Gateway challenge, token digest, authenticated account/device, resume scope ID, sent/acknowledged cursor and heartbeat times | Bind each connection to possession of an approved device and bound delivery window | Connection memory only; sequence metadata remains in the database |
| Optional HTTPS proxy: public IPv4/domain, TLS certificate/private key and ACME account data | Authenticate public transport and automate renewal; public certificates disclose the certified address to the CA and certificate-transparency ecosystem | Persistent Caddy volumes; public certificates/CA records have external retention |
| Optional HTTPS proxy: transient request headers/bodies, paths, peer addresses and operational errors | Route REST and gateway traffic to Hearth without decrypting MLS; control requests can contain bearer/invite/bootstrap secrets, so access/body logging is not enabled | Connection memory and Docker operational logs; operator controls log retention |
| OPAQUE spike setup, password file, and pending login state | Opt-in, fixed-user feasibility test only; no product auth endpoint | Test process lifetime; memory only |
| Media spike API secret, scoped JWTs, room/participant IDs, signaling, and RTP metadata | Loopback synthetic fixture only; no product media API | Fixture lifetime; generated secret configuration removed on normal shutdown |

All routing information above is metadata. MLS private content is never decoded by the server.

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
session keys are discarded. The export key is retained inside WASM only until the local
identity vault is unlocked and its enrollment accepted, then zeroized. Username and advertised Ed25519 server identity
are bound into the exchange. OPAQUE password records and server setup remain sensitive:
compromise of matching server secrets and records enables offline password guessing. No
claim of password immunity after a full server compromise is made.

The browser stores public signing-key pins in `hearth.server-key:<origin>` until site data
is cleared. A changed key blocks sign-in. This protects subsequent connections, not a
malicious first server or compromised web client code. Passwords and bearer tokens are not
persisted by the application. Tokens remain in React memory; JavaScript strings and browser
form/password-manager handling cannot promise memory erasure. Reloading drops the local
token without revoking its server session. Logout revokes the current token; no session
listing, device revocation or password change is implemented yet.

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

## Phase 1 first-device identity and local vault

[ADR 0006](adr/0006-first-device-vault.md) specifies client-only XChaCha20-Poly1305 vaults,
with a wrapping key derived from the OPAQUE export key. Account ID, server signing key,
format version and a domain context bind the ciphertext. Private identity/device keys and
the reserved local storage key stay inside WASM; the server receives only public enrollment
proofs. A password alone cannot replace an established identity or add a device.
The first enrollment still trusts password authentication and first-use server pinning;
independent fingerprint comparison remains necessary for authenticating that initial trust.

The browser stores an encrypted envelope in IndexedDB `hearth-identity-v1`, keyed by the
public server/account IDs. The desktop stores the same encrypted envelope in its OS
credential store under `chat.hearth.identity.v1`; a filesystem lock containing no envelope
serializes multiple processes. Those identifiers and displayed fingerprints are local
metadata. Envelopes remain until site data or OS credentials are deleted. Recovery kits
are available; product vault deletion is not implemented. Missing, damaged or locked storage fails closed
and never overwrites an existing vault. Local backups still contain sensitive ciphertext.
Browser profile deletion requires an approved-device link or an exported recovery kit;
password authentication alone cannot recover the identity.
Linux requires an unlocked Secret Service; the desktop never falls back to unprotected files.

The client persists the vault before requesting enrollment. IndexedDB transactions and
native cross-process locks preserve the first saved envelope; a losing creator reopens it.
The server serializes first enrollment and permits only exact retries. The client compares
its saved identity and device proof against the roster and warns on changes. Sign-out,
expiry, reload or server switching terminate the worker holding unlocked keys. Cancellation
and storage deadlines settle the UI even if an OS prompt remains pending; an already-started
store operation may finish afterward, but no enrollment is submitted after cancellation.
The identity vault wraps the key used by the separate encrypted message snapshot. A compromised
client or same-origin script can access unlocked secrets; browser/JS memory erasure is not
guaranteed. The native command origin guard is not a defense against compromised bundled code.

Recovery kits contain only the portable identity seed, encrypted with Argon2id
(64 MiB, three passes, one lane) and XChaCha20-Poly1305. Account/server/public identity,
version and a domain context authenticate the kit. Device and message-store keys are
generated anew on restore. The kit and passphrase together authorize future devices, so
protect them as recovery credentials; linking transfers that same portable authority.
Kits do not restore old message history or MLS epoch state. Recovery still requires an
authenticated account and an identity-matching cross-signed device proof.

Linking uses a random 128-bit code; only its SHA-256 ID reaches the server. An approved
device signs the ID and encrypted kit, scoped to account/server. Delivery requires an
authenticated session for the same account and expires after three minutes. Enrollment
atomically consumes it; exact enrollment retries remain idempotent. A recipient who has
already decrypted the portable identity retains recovery authority; consuming the relay
does not revoke identity knowledge. There is no six-digit offline-guessable link secret.
An unlinked authenticated client retains its OPAQUE export key inside the worker while
waiting for restore/link, until completion, sign-out, expiry or teardown; no raw key enters
JavaScript. Existing vaults remain immutable even during restore.

Registration defaults to invite-only after owner creation. The owner can select closed,
invite-only or open registration and set the public server name. Invites are random
256-bit capabilities delivered once to the authenticated owner, hashed in PostgreSQL,
single-use and valid for 24 hours. Creation transactions serialize invitation consumption
and settings changes; account creation cannot grant the owner flag. Invitation codes are
sensitive and necessarily submitted to registration; account passwords remain OPAQUE-only.

## Phase 0 crypto experiments

Optional `mls-spike` and `opaque-spike` features exercise fresh, ephemeral state. Neither
the normal application nor server enables them. They are feasibility evidence, not usable
account security or encrypted chat. See [ADR 0002](adr/0002-mls-feasibility.md) and
[ADR 0003](adr/0003-opaque-feasibility.md).

The MLS experiment uses test-device BasicCredentials and requires rollback after rejected
ciphertexts. Product integration now uses cross-signed credentials, transactional rollback
and durable encrypted snapshots; [ADR 0008](adr/0008-encrypted-direct-messages.md) records
its formats, tests and limits separately from the experiment.
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
