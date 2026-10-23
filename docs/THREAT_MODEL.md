# Threat Model (draft)

> Phase 1 draft. It is updated with every phase, and every new server-side field must be
> added to the metadata inventory below.

## Invite addresses and transport

### Phase 4 additions (2026-10-23)

The metadata inventory also includes signed `governance.media_version` (optional
legacy-compatible version 1), connect/listen/speak/camera/screen bits, and the
public `stage` channel kind. The server stores `voice_rooms.policy_signature`
and a SHA-256 `roster_digest` of sorted, length-framed device/incarnation/public
contribution values. These contain no private key; changes advance the media
revision, including a revoked device removed through a database cascade.

An authenticated SFU admission may contain `local_url`, a loopback-only WS
endpoint. Only a client authenticated against a loopback backend may use it;
remote clients use the public WSS endpoint. SFU/TURN transport credentials and
media networking preferences live in the host's private media directory and are
included in protected server backups. They authorize routing, never decrypt
participant media. The optional TLS relay reads the existing host certificate
volume without Docker control; it waits for issuance and reloads after renewal.
No TLS validation bypass is configured in the product.

Event details, RSVP identity and shared playback controls remain MLS-encrypted
application content and encrypted local history. Explicitly opted-in providers
receive only a public media identifier and position/control data inside an opaque
sandboxed frame. They can observe the user's IP, public application/site identifier
and provider browser/account. Hearth supplies no account identity or OAuth token.
Spotify playback is disabled for this release; its SDK origin is not authorized.
Root frame policy excludes the application origin, preventing isolated code from
navigating back and regaining application storage/native access. Browser escape
and native storage/IPC probes pass locally. See [stages and activities](STAGES_AND_ACTIVITIES.md)
for the player isolation and stale-host bounds. Device/output choices stay in
client session memory; device identifiers are not persisted or signaled.

Invite sharing may use a recipient-facing public HTTPS origin while the owner
stays on its existing authenticated loopback connection. Only the selected local
host may supply an automatic public-address hint, and the local identity must
match before applying it. Envelope encryption remains bound to the recipient
origin; only its hash and ciphertext reach the relay. The bearer token stays on
the authenticated transport and is never sent to an editable sharing address.
Pretty codes require an explicit server address; a bare code is never resolved
through DNS or an external global directory. Legacy links remain readable.

## Local owner enrollment

Native automatic owner enrollment is available only to the bundled main window.
It accepts the selected host's configured loopback HTTP port, sends readiness
requests directly to 127.0.0.1 without proxies or redirects, and checks the
displayed server identity and incomplete setup before retrieving the local code
through Docker. The form retains it in memory for at most five minutes and clears
it on submit, cancellation, expiry or unmount. No code is written to browser
storage, a URL, an input or the clipboard by this handoff. A compromised host OS
can already read its operator files and is outside this protection boundary.
Native configuration generation uses OS randomness and exclusive first creation;
it preserves existing credentials, rejects conflicting storage configuration,
and still refuses regeneration over persistent volumes missing their original files.

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
| `conversations`: random ID, optional unique channel ID equal to that ID, MLS epoch, public device-proof manifest, creation time | Bind a channel to its MLS group, serialize commits and validate approved devices | Conversation lifetime; deletion is not implemented, including backups |
| `conversation_accounts` and `conversation_devices` | Fixed Phase 1 DM audience, append-only admitted channel audience and per-device fan-out; exposes the social graph | Conversation lifetime, including backups |
| `delivery_operations`: random operation ID, conversation/account/device IDs, action, optional target operation, payload digest, creation time | Idempotent retry and author-only edits/deletes; operation kinds and reply timing are visible, reply targets remain encrypted | Conversation lifetime, including backups |
| `device_delivery_cursors`: device public key, next sequence | Gap-free, persistent ordering for offline delivery | Device lifetime, including backups |
| `delivery_events`: recipient device, sequence, conversation/operation IDs, public signed envelope, ciphertext, ephemeral flag, creation time | Ordered Welcome/commit/message backlog without decryption | Conversation lifetime; deletion replaces originals/edits with markers; typing is hidden after ten seconds, with backup retention possible |
| Gateway challenge, token digest, authenticated account/device, resume scope ID, sent/acknowledged cursor and heartbeat times | Bind each connection to possession of an approved device and bound delivery window | Connection memory only; sequence metadata remains in the database |
| `communities`: random ID, display name, owner account ID, creation time; `community_members`: community/account IDs and join time | Authenticated directory and authorization; names and membership are server-visible metadata, not encrypted message content | Community lifetime, including backups; deletion/retention follows later |
| `community_categories` and `community_channels`: random IDs, community/category relationship, display name, channel type and creation time | Member-visible navigation, MLS routing and owner-only announcement authorization; only the community owner creates structure | Community lifetime, including backups |
| Channel roster responses: community/channel metadata, account IDs/usernames/owner flags and approved public device enrollment proofs | Member-visible audience preparation and local identity pinning; contains no package private secrets or epoch/history keys | No additional server table; no-store HTTP responses; public identity pins remain in the encrypted client snapshot |
| `community_invites`: SHA-256 digest of random 256-bit capability, community/creator IDs, expiry, max uses, used count and creation time | Authorize atomic community admission; member retries do not consume a use. Account registration invitations remain separate | Expired/exhausted rows pruned when creating invites; remaining rows and backups persist until later retention work |
| `communities.authority`, `community_members.admission`, `community_channels.policy` | Public owner/device proof and signatures binding owner, admitted account identity, channel kind, history policy, revision and per-channel history epoch floors; receivers verify independently of the host | Community lifetime, including backups; revocation follows Phase 3 |
| `community_invites.certificate` and `community_members.invitation` | Owner-signed invite digest, issuer proof, issue time and channel epoch cutoffs; the joining client pins the certificate against the typed capability. Policy `created_at` and `history_open_for` are signed immutable public metadata; only explicit invite IDs authorize later-created channels | Community lifetime, including backups |
| `channel_archives`: sequence, operation/conversation IDs, epoch and signed ciphertext upload with sender public proof | Policy-scoped encrypted backfill. Device-targeted exporter-key handoff stays inside MLS and X25519/XChaCha wrapping | Conversation lifetime; message deletion removes original/edit archives, including possible backup retention |
| `encrypted_blobs`: opaque ID, conversation/account/device IDs, ciphertext byte count/SHA-256 digest, ready flag, erasure and creation time | Authorize private S3 leases, membership checks and upload quotas. No filename, MIME, thumbnail, file key or plaintext digest reaches the server | Signed retention, account erasure or operator removal; incomplete leases expire after 20 minutes plus cleanup delay |
| `blob_removals`: opaque file/conversation IDs, removing server-operator account and timestamp | Deny re-reservation after owner removal and physical cleanup; operator authority grants no content keys or community membership | Durable removal receipts; stored object deletion is retried while existing upload leases expire |
| `invite_envelopes`: domain-separated SHA-256 lookup ID, creator account, random nonce, encrypted invite envelope and creation/expiry timestamps | Resolve readable 160-bit random share codes. The raw code and admission capabilities stay in client memory/link fragments. AES-GCM key derivation uses a separate domain and binds the server origin; lookup hashes cannot decrypt envelopes | Up to 24 hours, 64 live envelopes per account and 10,000 per server; creator account deletion erases its envelopes. Underlying admission expiry/use limits still apply |
| Private S3 objects, access credentials and short-lived signed PUT/GET URLs | Store only chunk ciphertext. URLs authorize one opaque object for five minutes; already-issued URLs cannot be recalled immediately | Persistent storage volume; credentials in private operator configuration; URLs remain valid until expiry |
| Local encrypted file cache | Ciphertext only, indexed by local account/server/device/conversation/object scope; 32 entries/32 MiB bound. Worker authenticates digest and every chunk before returning plaintext | Browser/webview profile lifetime or bounded eviction; decrypted object URLs are temporary |
| Optional HTTPS proxy: public IPv4/domain, TLS certificate/private key and ACME account data | Authenticate public transport and automate renewal; public certificates disclose the certified address to the CA and certificate-transparency ecosystem | Persistent Caddy volumes; public certificates/CA records have external retention |
| Optional HTTPS proxy: transient request headers/bodies, paths, peer addresses and operational errors | Route REST and gateway traffic to Hearth without decrypting MLS; control requests can contain bearer/invite/bootstrap secrets, so access/body logging is not enabled | Connection memory and Docker operational logs; operator controls log retention |
| OPAQUE spike setup, password file, and pending login state | Opt-in, fixed-user feasibility test only; no product auth endpoint | Test process lifetime; memory only |
| Media spike API secret, scoped JWTs, room/participant IDs, signaling, and RTP metadata | Loopback synthetic fixture only; no product media API | Fixture lifetime; generated secret configuration removed on normal shutdown |
| Product call control ciphertext and ordinary DM routing/action metadata | Signed MLS offers/answers/heartbeats/hangups, group contributions/departures and key-update controls reuse encrypted delivery. SDP, ICE addresses, call IDs, selected rosters, public contributions and restart/key markers remain inside MLS; frame keys remain client-only | Existing encrypted delivery/outbox retention; expired controls cannot create a live call |
| Current-call-format device capability leases | Prevent new private call content from stalling legacy clients. Approved own devices announce support; DM readiness checks require all MLS devices. No public capability directory | In memory for 90 seconds, bounded to 4096 device entries; backend restart clears it |
| Group/room format support (`group_media_capabilities.device_key`, `format`) | Record that an approved device can parse the requested private-group or community-room control format, separately from online presence. The group-mode/version query is visible to the host; no room ID, active roster, contribution or media key is stored here. A 1:1-only announcement removes support; an older group client downgrades its public version | Database and host backups; downgraded on old-group-format announcement, removed on 1:1-only announcement or device-certificate deletion. Existing public certificate retention and account-deletion limits still apply |
| Community voice room (`voice_rooms`: channel ID, room generation, MLS epoch, revision, relay-only choice) | Persistent channel occupancy coordination and replay-safe mesh generations. Room activity and privacy mode are visible to the host; no media key, SDP or media content | Until channel deletion, plus existing database/backup retention. A new MLS epoch replaces the generation |
| Signed voice occupancy (`voice_presence`: channel, device/account IDs and public signed presence) | Four-person capacity, one-device-per-account enforcement and live approved participant discovery. Presence exposes an ephemeral **public** P-256 contribution, incarnation, privacy and issue/expiry times. Private ECDH keys, shared secrets, exporter bases and frame keys never cross this API | Active leases expire within 30 seconds. Expired/revoked active entries are pruned on room access; departed public entries are pruned on access after expiry plus two minutes. Device/account/channel deletion cascades; backups retain their ordinary limits |
| Operator STUN/TURN endpoints, backend TURN shared secret and temporary relay credentials | Authorize relay allocations independently of media encryption. Approved account devices obtain one-hour credentials with random scope; endpoints/credentials reveal relay choice and timing to the relay | Static secret stays in private backend configuration; temporary credentials expire after one hour and are never diagnostic fields |
| Optional `voice_rooms.sfu` mode and signed occupancy `sfu: true` | Bind topology into public room generation, participant signatures and client key context; selects four-person mesh or up to 25 joined SFU accounts | Room lifetime and ordinary database backup retention; mode changes replace leases/generation |
| SFU access response: channel/room IDs, revision, public endpoint, revision-specific LiveKit room name, device-incarnation identity, short-lived JWT and expiry | Authenticate one currently joined approved device and authorize publication/subscription; token grants no media key, provider API secret, data publication or metadata mutation | No-store authenticated response; JWT valid for 60 seconds, connection metadata retained according to media operator settings |
| Optional SFU API key/secret and generated private LiveKit configuration | Backend mints bounded admission tokens; SFU verifies tokens. These credentials can authorize routing but cannot decrypt client-encrypted frames | Private operator files/backend environment until explicitly rotated; excluded from source and build contexts |
| Operator request-capacity profile (`HEARTH_REQUEST_PROFILE`) | `standard` retains 600 authorized requests/minute and 16 concurrent requests; opt-in `sfu25` supports 3,600 and 64. Per-account 120/minute, login bounds and gateway capacity stay unchanged; profiles remain bounded | Operator configuration and process memory until changed/restarted; no content keys or extra account data |
| SFU connection metadata: device-incarnation identity, revision-specific room, track/source identifiers, SDP/DTLS fingerprints, ICE transport credentials, timing, addresses and encrypted RTP traffic | Route encrypted microphone/camera/screen/computer audio without frame-decryption keys; traffic volume reveals activity. SFU transport signaling is visible to the SFU, while Hearth's room-key controls remain MLS ciphertext | Live connection memory and media operator retention; generated production configuration uses error-level logs; no application recording or data publication is enabled |

All routing information above is metadata. MLS private content is never decoded by the server.

### Direct call recovery

Same-epoch media recovery reuses the approved device pair, call ID, relay policy
and client-only SFrame workers. ICE restarts change transport credentials without
resetting media encryption counters or acquiring capture again. Random transaction
markers inside authenticated encrypted SDP bind answers to one outstanding offer.
Per-call replay tracking, deterministic glare resolution and six transactions per
minute bound negotiation work. Only an already-consented, established call accepts
restart negotiation. A late restart cannot ring a new call or reopen stopped capture.

Clients reauthorize new descriptions and positively recheck relay-only selection
before returning to connected. Authenticated media must advance during recovery.
An independent 20-second deadline stops capture if negotiations or authorization
stall; ordinary authorization/heartbeat watchdogs still apply. Hangup, session
lock and device/DM access loss remain capture-ending events. Epoch changes during
network recovery end capture; stable established 1:1 calls use the bounded
[key-update handshake](CALL_KEY_UPDATES.md). Old key references are discarded,
in-flight crypto outputs are invalidated, and media resumes only with peer/worker
confirmation and advancing new-key frames. Overlapping epochs and update timeout
end capture. Approved MLS devices remain within the conversation trust boundary.
General group rekey and full messaging/network reconnection remain open.
The local automatic-trigger test injects a connection-state event and is not proof
of real outage recovery, cross-network privacy or physical-device permissions.

### Private group voice

Private group controls carry room IDs, a fixed sorted selected-device
roster, admission controls and ephemeral P-256 public contributions inside existing
MLS control ciphertext. It adds no cleartext server field or stored server table.
The group ID/roster is also bound into the client-only exporter context. Ordinary
1:1 envelopes omit these extensions, and the 1:1 controller ignores group controls.
Group readiness is now separately requested for three-account private chats;
ordinary 1:1 readiness retains its two-account guard.

The product admission state requires explicit local consent and a directly
authenticated contribution from each active peer before permitting pair key
agreement; unanswered invitees cannot derive those pair keys. Each selected
pair adds a fresh nonextractable ECDH secret to its MLS base with a
domain-separated HKDF transcript. Other chat devices know MLS state and public
contributions but lack those ephemeral private keys. Pair-key tests include a
third participant's failed decryption attempt. Compromised or colluding selected endpoints can disclose content.
Key disposal is reference removal plus temporary byte-buffer zeroing, without a
WebCrypto/JavaScript secure-erasure guarantee. See [the exact scope](GROUP_VOICE.md).

The current [private group voice controller](GROUP_VOICE.md) permits independent
joins and ordinary leaves. Each participation change replaces pair connections,
workers and derived keys, while preserving source/mute for continuing callers.
Public departure tombstones prevent restoring pre-join keys or resurrecting a
departed device through delayed controls. Explicit same-session rejoin uses a
fresh ECDH contribution and a higher bounded participation round; leave dominates
join within a round. Old round controls cannot remove the rejoined participant.
After leaving, only public membership state is retained locally while peers are
live; no microphone, worker or ephemeral private key remains. Rejoin verifies
current permissions again. Format 2 capability gates prevent sending these new
controls to older parsers. The call has no original-caller lifetime
dependency. The last participant releases capture while waiting. Group-format
support is durable capability metadata rather than a presence lease; server
readiness enforces blocks between every account pair. Real-network, physical-device,
full-platform and independent security/interoperability acceptance remain open.

### Guided setup invitations

The Host/Join client accepts a versioned `hearth://join/` invite. Version 2 carries
the origin and a random 32-character Crockford Base32 code in its fragment. The
client fetches an encrypted envelope by a domain-separated SHA-256 lookup ID,
then authenticates/decrypts it with an independently derived AES-GCM key bound to
the server origin. The server cannot derive the decryption key from the lookup ID.
Version 1 remains compatible and carries an origin, public server identity and
account/community capabilities directly in its fragment.
It rejects unknown/duplicate fields, credentials, paths and remote HTTP before
resolving short invites and performing public discovery, then checks the invite
key and existing local pin. Bare short codes can resolve in Join a community when
the account's server is already known; elsewhere a full link is required.
It also preserves the active server identity if storage is unavailable. Bare
admission/bootstrap codes are rejected before they can be treated as DNS names.
Invites are pasted into the client; OS protocol handling is a later gate. The
client never sends the whole invite to an HTTP endpoint. Only the relevant
capability goes to the existing authenticated registration/join flow when the
user proceeds; owner bootstrap codes cannot be supplied through invites.

Capabilities remain in component memory, are not added to browser storage or
diagnostic exports, and must be pasted again after reload. Copying explicitly
places them on the OS clipboard (including any enabled clipboard history/sync).
Server origins/names and public-key pins keep their existing local storage policy.
No third-party probe is used: passing local discovery does not establish outside
reachability, and a timeout does not establish a CGNAT or NAT-loopback diagnosis.

## Phase 2 community directory

The first community slice exposes structure only to authenticated members. A server owner
has no implicit read/manage access to communities created by other accounts. Community
owners alone create categories, text/announcement channel records and invitations.
Channel IDs now bind to MLS conversations. Community members obtain public rosters;
online existing devices admit eligible accounts/devices through signed private commits.
Announcement publishing requires the community owner. The server still never decrypts
content or creates epoch keys. Governance and revocation remain Phase 3 work.

Community, category and channel names are explicitly server-visible navigation metadata.
Do not put private message content in directory names. Community creation/admission locks
the account row; structure/invitation mutations lock the community row. Joining locks and
checks an unexpired invite with wall-clock time after contention, then inserts membership
and increments usage atomically. A join requires an existing server account and does not
register an account, enroll a device or grant access to any past MLS epoch.

Requests have a 64 KiB body bound, explicit CORS origins, no-store responses and the existing
admission/request budgets. Limits are 100 communities per account, 1,024 members per
community, 256 categories, 512 channels and 32 active invites. Invites allow 1–1,000 new
members and expire in 60 seconds–7 days. These bounds are not large-channel MLS evidence.

Channel admission/messages lock the community before conversation and device rows;
admission verifies every account against current membership. The client drains backlog,
pins account/device proofs and persists before transmission. With history `none`, new
members/devices receive only post-Welcome messages. A waiting new device needs an
existing epoch holder online. Channels currently support at most 128 devices, and roster
reads reject communities above 128 accounts. See [ADR 0010](adr/0010-encrypted-channels.md).

Clients pin owner roots and verify owner-signed account admissions and channel policies
before accepting roster expansion or Welcome/commit delivery. Compare first-contact
owner/member fingerprints out of band; TOFU does not authenticate a malicious first
directory response. The host can still deny, delay and replay delivery. Fixed DM audiences
retain their account-expansion rejection. See [ADR 0011](adr/0011-owner-signed-channel-admission.md).

History `full` or `since_invite` deliberately retains per-epoch MLS exporter keys inside
encrypted client snapshots. This weakens retrospective forward secrecy for retained
archives: compromise of a device holding those keys can decrypt its permitted retained
history. Owners rotate epochs before signing invites. Since-invite handoff uses the signed
cutoff, including for later linked devices, with explicit signed invite IDs for channels
created afterward. The host cannot lower those floors. An online existing owner device
wraps available keys to a requester's ephemeral X25519 key inside MLS. `none` creates no
new archives and denies handoff; switching policies cannot recall previously shared keys,
plaintext or recipient copies, or restore messages sent before archives were enabled.

Files use random per-file XChaCha20 keys with 1 MiB independently authenticated chunks.
AAD binds server, conversation, opaque object, byte count, chunk size and index. Descriptors
and generated thumbnail keys travel inside MLS; local UI views omit keys. Initial bounds:
8 MiB/file, 128 MiB reserved ciphertext/account, 2,048 objects/account and 16 incomplete
uploads. S3 PUT signatures bind exact Content-Length and application/octet-stream. The
server checks object size on completion; receiving workers verify ciphertext SHA-256 and
AEAD, including truncation and ordering. URLs contain no bearer session token. No automatic
remote Markdown image or link-metadata fetch occurs. Raster previews/custom emoji use
temporary decrypted blob URLs; SVG/HTML attachments are download-only. Deleting a message
does not yet purge ready S3 objects or all prior recipient copies; retention follows Phase 3.

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

## Community room camera and screen video

Community room camera/screen development reuses the verified encrypted pair's
prebound media slots. Camera/screen state and a mesh-scoped monotonic counter
travel inside MLS room heartbeats, never in public occupancy metadata. Room
access is rechecked before capture, after permission selection and at each edge
before attaching a clone. Source and clone tracks stop immediately on local
leave/lock, access or epoch failure and room roster changes. Camera/share need
fresh explicit consent for a changed audience. Current read/send permissions
apply to all room media; separate track permissions remain open. See
[room video](ROOM_VIDEO.md) for scope and acceptance boundaries.

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
SeaweedFS starts through a wrapper that copies its private, read-only host credentials
into a mode-0600 service-owned container file before the standard privilege drop.
The host file is not made readable to other users.

## Out of scope (stated honestly)

- Recipients who copy or screenshot content.
- Traffic analysis by an operator (timing, sizes, and membership are visible to the home
  server).
- A compromised client device.


## Phase 3 governance metadata (implementation in progress)

`communities.governance` stores owner-signed public roles, permission bits, account-role
assignments, channel overrides, bans/timeouts, channel limits and optional rules. These
are host-visible administration metadata, never message plaintext. Signatures bind
the server identity and community root. Clients retain the highest observed revision
and reject rollback/removal of a pinned policy. Existing clients must upgrade before
a host enables governance: commits omitting the current snapshot are rejected.
Owner access cannot be denied; signed admission and policy edits remain owner-managed.
Management bits are reserved until delegation is implemented.

`community_audit` records community ID, revision, actor ID, action, snapshot digest and
time. It excludes message content and moderation reasons, persists for the community
lifetime and can remain in backups. It is not an external transparency log.
`community_rules_acceptance` records community/account IDs, accepted rules digest
and acceptance time; changed rules require a new acknowledgement when screening is enabled.

Read revocation blocks REST history, roster and blobs and replaces shared HTTP/gateway
backlog content with ordering markers. New uploads are blocked while a denied member
remains in the MLS group; an online authorized device removes it before posting resumes.
Previously received keys/plaintext/backups cannot be recalled. Issued blob leases can
remain valid for five minutes. Timeouts and slow mode are authenticated host controls;
clients enforce signed static permissions independently of the host, not sender clocks.

Channel epochs retain verified authorization snapshots and actual member device proofs
in the encrypted client store. Historical message validation uses that epoch's roles;
history key handoffs encrypt those snapshots to the selected device. They disclose no
additional plaintext to the host. A bounded cache limits history handoff and store size.

Rules screening permits reading before acceptance and blocks posting, reactions, pins
and file uploads. Rules themselves are public metadata, limited to 4,096 bytes. The host
sees each member's consent digest/time; it is not a cryptographic confidentiality gate.

Retention days and slow-mode seconds are public signed channel metadata. Reads immediately
filter expired message ciphertext. A minute-based worker deletes archives and redacts
stored delivery events, preserving cursor markers, idempotency digests and MLS commit/
Welcome material for offline devices. Blob objects are deleted before their index rows;
failed storage deletion remains retryable. Expired blobs cannot obtain new download
leases. Existing leases, recipient copies, WAL/storage recovery and host backups cannot
be recalled; physical backup expiry remains an operator responsibility. A dishonest host
can retain ciphertext outside this cleanup mechanism.

Ownership transfer adds public lineage metadata: outgoing/successor account identities
and approved device certificates, previous signed roots, exact signed-object digests,
the pending offer and a content-free acceptance audit digest. Digests cover public
certificates and policies, never plaintext messages. Both owners sign the transition;
the host cannot replace a pinned owner. Unused invites are invalidated. Accepted
historical epochs retain their original authority; old-owner objects must be explicitly
endorsed to remain current. The client keeps a retryable acceptance outbox inside its
encrypted snapshot and advances the pin after the server CAS succeeds. First-contact
trust remains a fingerprint comparison. See ADR 0014 for limits and recovery scope.


### Phase 3 account safety, export and browser push metadata

User blocks store the blocker and blocked account IDs privately per account. They deny direct-message delivery between that pair; shared-community ciphertext still arrives and is hidden by the client. Server bans record the operator and banned account IDs and revoke server sessions; they do not give the operator community signing authority or remove previously distributed encryption keys.

Account exports contain account-owned metadata, public device certificates, membership and block lists, blob metadata, authored delivery-operation metadata with opaque envelopes, and opaque reports submitted by or addressed to the account. No password verifier, session token, authentication exchange or private key is included. Pagination is a live view: concurrent writes can change the dataset between pages. The browser optionally adds readable messages from its local decrypted store, with an explicit checkbox. Those files are plaintext and do not replace the recovery kit.

Opt-in Web Push stores an approved device key, account ID, provider endpoint, P-256 subscription public key and subscription authentication secret, pending timestamp and last-attempt timestamp. These are routing credentials: do not log them or include them in unauthenticated responses. Supported provider endpoints are HTTPS FCM, Mozilla and Apple. The transport validates DNS answers and pins public addresses, disables redirects and proxy environment routing, and limits delivery attempts. Subscription ownership cannot move to another account or device through an upsert.

Push bodies contain only the fixed string `New activity in Hearth.` under RFC 8291 encryption; VAPID uses a separately derived P-256 signing key scoped to this feature. The push provider can observe timing, endpoint and application-server identity. New sends enqueue generic activity for recipient subscriptions, excluding the author, with a 30-second attempt interval and a ten-minute expiry. Typing, edits, reactions, control messages and MLS commits do not enqueue notifications. The service worker ignores pushed content and always displays fixed copy, then opens the local application origin. Desktop-native notifications remain a later platform integration; the web UI reports unsupported contexts explicitly.

## Account departure and local link cards

Account deletion requires an approved device signature and current session, and
retains an exact signed retry proof after revocation. Public identity/admission and
MLS transcript evidence remain; deletion is not complete metadata anonymization.
Late account writes are fenced by database locks and triggers. New publishing
requires removal of departed devices; recipient copies, private local history,
old presigned URL leases and backups cannot be recalled. Physical private storage
cleanup follows upload-lease expiry. See [ADR 0016](adr/0016-signed-account-departure.md).

Automatic link cards parse addresses locally and fetch no remote website data.
The preference is scoped to account and server. Disabling cards changes display
on this device, including already received embeds; it does not alter message
ciphertext or another participant's display preference.

## Native hosting, release updates and invite handoff

Hosting controls are available only through local native IPC. The app stores the
chosen host folder, Compose project, public address and HTTPS preference in its
local profile. A signed distribution manifest authenticates the deployment scripts
and server archive before execution. Docker and Node run as the local operator;
anyone controlling that OS account or Docker daemon can control the host.

Host `.env` and `s3.json` files contain database/storage credentials. Rollback
backups additionally contain database metadata and encrypted events, the server
signing and OPAQUE setup keys, private object storage, optional Caddy certificate
state and the previous server image. Backups remain local until the operator
removes them and must be protected like the original host. Client content keys
are not added to host backups. The setup code is retrieved on request through
native IPC and cleared from the rendered panel when it closes.

Host startup refuses to generate new credentials when labeled persistent data
already exists without both operator files. It checks database authentication
through the service network before launching Hearth; container-local loopback
trust authentication is not used for this check. The password is passed through
the subprocess environment rather than command arguments or logs. A failed check
does not rotate credentials, erase data or rewrite the operator files.

Release requests disclose the client IP and request timing to GitHub. The app
pins the repository, release paths and signing public key. Installer and host
updates require signatures, version binding and artifact hashes; host updates
also bind the source revision and image identity. Stable and Preview use separate
feeds. The private release signing key remains outside version control and
distribution archives. A valid signature authenticates the publisher, not the
absence of defects; server updates retain a rehearsed rollback backup.

Native invite links can be supplied by any website or local process. The OS may
expose launch arguments to local process inspection. Hearth bounds and validates
the URI shape, keeps at most one pending handoff for five minutes in memory, and
does not log or persist it. The platform plugin also retains the current launch
URL in process memory for its lifetime. The UI requires Review, Check and Continue
before changing servers; normal invite validation and server identity pinning
still apply. Existing sessions stay mounted until the user confirms a connection.
