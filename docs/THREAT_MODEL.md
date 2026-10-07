# Threat Model (draft)

> Phase 0 draft. It is updated with every phase, and every new server-side field must be
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
| OPAQUE spike setup, password file, and pending login state | Opt-in, fixed-user feasibility test only; no product auth endpoint | Test process lifetime; memory only |
| Media spike API secret, scoped JWTs, room/participant IDs, signaling, and RTP metadata | Loopback synthetic fixture only; no product media API | Fixture lifetime; generated secret configuration removed on normal shutdown |

Phase 1 adds accounts, device public keys, MLS KeyPackages, ciphertext envelopes, and
delivery timestamps. Each gets a row here, with its justification.

## Phase 0 discovery and client storage

`/health`, `/.well-known/hearth`, and `GET /api/v1/setup` expose public operational metadata:
database health, application and protocol versions, configured server name, public signing
key, federation preference, and the existence of the setup-complete setting. These GETs allow
cross-origin reads without credentials so alternative web clients can discover a server.
This CORS policy is scoped to those routes, not the gateway or future authenticated APIs.
An unavailable database returns an unavailable setup response rather than claiming setup
is incomplete. Federation preference is configuration, not proof of working federation.

The browser saves only the last successfully checked server origin in `hearth.server-url`
local storage until the user forgets it or clears site data. This is unencrypted local
metadata that can reveal the user's chosen server to someone with access to the browser
profile. It contains no credentials, identity keys, or message content. Discovery uses HTTPS
except for loopback development origins, omits credentials, rejects redirects, validates
response shapes, and requires compatible protocol advertisements. The displayed signing key
is server-advertised; this build does not pin or independently authenticate it.

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
