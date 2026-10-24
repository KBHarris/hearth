# SFU community rooms

The development client supports an optional LiveKit SFU for community Voice
channels. Configuring an SFU on the Hearth backend selects this transport for
those rooms, with a 25-account admission limit and one approved device per account.
Without an SFU, rooms retain the four-person direct mesh. Private three-person
calls and 1:1 calls retain their existing transports. This is not yet an installed
Preview release.

Join/leave works as a persistent room, without ringing or requiring everyone to
answer. A person alone waits without opening the microphone. Each active SFU
endpoint uses one bidirectional connection with the pinned SDK; it publishes each original
source once, instead of uploading a separate copy to every participant. Camera,
screen video and explicitly selected computer audio have independent sources.

## Keys and admission

Hearth signs the SFU mode into room occupancy. Room identity, revision, joined
devices, incarnations, privacy policy and MLS epoch bind each client context.
Every publisher creates fresh random sender material combined with the MLS
exporter and wraps it individually to the other joined devices using the
existing authenticated ECDH agreement. These bundles travel inside MLS control
ciphertext. Unjoined channel members cannot unwrap a bundle addressed to others.

The backend issues a 60-second LiveKit token only to the authenticated, approved
device with a current signed room lease at the requested revision. It grants
publication/subscription in one revision-specific room under that device's
incarnation, disables data publication and metadata updates, and contains no
media keys. The backend's SFU API secret remains private. Clients subscribe only
to expected identities, known source types and encrypted publications after
installing that publisher's key.

SFU media uses the pinned LiveKit encoded-frame E2EE implementation and a custom
per-participant key provider. Before capture, a local worker challenge confirms
that the key is installed. Raw sender bytes are cleared after import. This
profile differs from Hearth's direct-call SFrame worker; independent SFrame
interoperability remains open. See [LiveKit encryption documentation](https://docs.livekit.io/transport/encryption/).

Every signed join/leave revision creates fresh publisher keys and a different
physical SFU room. Continuing microphone/camera/share sources remain local and
are republished only after fresh admission and encryption readiness. Microphone
mute is preserved independently of screen audio. A room returning to one person
stops capture. Permission/device loss, stale authorization, unexpected encryption
errors stop unauthorized publication. Bounded network/MLS recovery pauses owned
sources, replaces admission/keys and resumes only after fresh verification;
failure or the independent deadline stops capture. Permission loss remains
capture-ending for the restricted participant. Promotions never acquire a
microphone without that person's explicit speaking consent.

Relay-only mode uses Hearth's authenticated TURN configuration and checks both
SFU connection directions for selected relay candidates before exposing media.
The route check handles both the SDK's single-connection mode and its dual
publisher/subscriber mode; an absent unused subscriber is never treated as a
second active transport.
Public SFU reachability and TURN reachability need separate deployment checks.

## Optional self-host package

Run `npm run media:setup` to prepare private files in `deploy/media/data/`.
It creates credentials once and preserves them on retries. The directory is
excluded from Git, Docker build context and Railway build inputs. Do not paste
its files into diagnostics. No Docker services are started by this command.
Keep this private directory with the operator's backups. Existing guided-host
backups now collect these private media settings/credentials and restore their
paths. A disposable 0.4.0 package passes native preparation, credential
idempotency, tamper rejection, rollback and fresh restore. Media credentials
authorize routing and do not replace user recovery kits.

Use the generated environment file together with the existing host environment
and `deploy/compose.yaml` plus `deploy/compose.media.yaml`. The overlay adds a
pinned LiveKit image and backend SFU settings. Defaults bind signaling and media
ports to loopback: 7880/TCP, 7881/TCP and 7882/UDP. Custom ports are supported
through `--signal-port`, `--tcp-port` and `--udp-port`.

Larger rooms need an explicit backend request-capacity profile in addition to
media capacity. Use `--profile=sfu25` when preparing a host for that milestone.
The server's default `standard` profile keeps 600 authorized requests/minute and
16 concurrent requests. `sfu25` permits 3,600/minute and 64 concurrent requests;
both retain the 120-request per-account minute limit, existing login bounds and
64 gateway-connection limit. Unknown profile names fail startup. This changes
capacity for the whole selected Hearth instance; it is not a media-key setting.
The initial 26-client/default-profile run hit HTTP 429 before reaching the
25-person room, so it is retained as failed capacity evidence.

Add `--turn` to prepare the common coturn relay configuration and include
`deploy/compose.turn.yaml`. It uses the backend's existing short-lived REST
credential mechanism for both direct calls and SFU relay-only connections.
Ports default to 3478/TCP+UDP and UDP allocations 49160-49259. The local profile
contains an explicit loopback-peer exception for disposable development. Public
profiles omit that exception. TURN-TLS and certificate provisioning remain open.
LiveKit's embedded TURN remains off: its SFU-scoped credentials do not replace
the common relay needed by Hearth's direct calls. Operators may evaluate it for
an SFU-only deployment without requiring duplicate relays.

For example, after preparing the base host environment, the development package
can be selected with:

```powershell
docker compose --env-file deploy/.env --env-file deploy/media/data/.env -f deploy/compose.yaml -f deploy/compose.media.yaml -f deploy/compose.turn.yaml up -d
```

This command starts the selected stack and must be run deliberately for the
intended host. Current automated package checks start only separately named
disposable media/relay services. Loopback SFU acceptance uses a browser test
flag permitting loopback WebRTC candidates; it does not establish normal-client
connectivity to a loopback-only media package.

An outside deployment additionally requires an explicit WSS URL, public IPv4
advertised address, public bind, DNS/TLS termination and working media port
routing. Use `--url=wss://media.example --advertise-ip=PUBLIC_IP --bind=0.0.0.0`
only after preparing that host. The setup command does not configure routers,
firewalls or certificates. See [LiveKit deployment requirements](https://docs.livekit.io/transport/self-hosting/deployment/).
Railway stays paused; its application HTTPS endpoint does not establish SFU
public UDP reachability.

## Acceptance boundaries

The disposable product fixture uses real local accounts, approved devices, MLS
admission and production room controls, with synthetic microphone/camera/screen
and computer-audio sources. It checks decoded media, mute, membership key changes,
authorization and cleanup. Synthetic sources do not establish physical picker,
installed-client, internet/NAT, TURN-TLS or full-platform behavior. Physical
devices, independent networks, long-duration load and release gates remain open.

Separate signed connect/listen/speak/camera/screen permissions, device switching,
stage consent, events and opt-in synchronized playback are now implemented.
Stage audience/promotion/demotion/revocation passes a three-person local fixture.
Private-group media/device/MLS recovery and Windows native direct-call isolation
also pass locally. Spotify is disabled for this release by the user's decision.
The 25-person stable-media/load run remains a release gate; reaching the final
join in a failed fixture is not a pass. See the release checklist and progress
for the current evidence. Earlier checkpoints retain their original scope.

The distributed one-PC capacity fixture uses a clocked silent `AudioContext`
sink for generated sources and PCM measurement, plus the production `Playback`
component. This avoids spending a hardware output for each synthetic client.
Chromium's [Windows audio manager](https://raw.githubusercontent.com/chromium/chromium/main/media/audio/win/audio_manager_win.cc)
declares a 50-output-stream ceiling (source checked 2026-10-23). A small local
26-context/26-player diagnostic starts only 24 hardware players; silent context
sinks allow all 26 players and all generated PCM. The full SFU assertions still
require actual received/decrypted audio, video, separate computer audio and
wrong-key rejection. These fixture sinks do not validate physical devices or
change normal-client playback. An experimental HTML-output routing diagnostic
decoded audio on 26 short-lived sites but did not resolve full-room churn; its
full run failed and was separately marked as diagnostically modified after an
output reset. It is excluded from release acceptance. The current capacity
fixture divides its 26 sites between two independent disposable browsers to
avoid coupling every simulated client's output resources to one browser. Its
relay forwards only local fixture operations and validates endpoint index,
origin, source and nonce. Accounts, MLS, signaling, keys, SFU transport and decoded
media remain real product paths; all PCM and privacy assertions remain required.

Focused diagnosis uses immutable fixture assets:

- `node scripts/verify-direct-calls.mjs --group-epoch --immutable --checkpoint=private-epoch-focused`
  checks only private-call linked-device MLS recovery and six decoded audio paths.
- `node scripts/verify-direct-calls.mjs --sfu-policy --immutable --checkpoint=sfu-policy-focused`
  checks three joined people, removes one person's read permission, and requires
  the surviving pair to rotate keys and decode audio without recapture/unmute.
  It retains the normal request limits and setup budget interval. It is not a
  capacity, video, physical-device or internet acceptance result.
- `node scripts/verify-direct-calls.mjs --sfu-connect --desktop --turn-tcp --checkpoint=native-sfu-pair`
  isolates two joined Windows WebView2 endpoints, both decoded audio directions,
  relay-only routes, encryption before publication and capture/storage cleanup.
  Disposable Docker TURN/SFU loopback does not establish public relay reachability.
