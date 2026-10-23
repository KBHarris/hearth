# Community voice rooms

Subsequent development adds optional [SFU rooms](SFU_ROOMS.md) and
[computer audio](COMPUTER_AUDIO.md). The historical four-person mesh checkpoint
below retains its original evidence and limits.

Phase 4 local development slice, 2026-10-22. A community owner can create a
**Voice** channel. Members open it and choose **Join voice room**; nobody rings,
and the channel remains available after everyone leaves. This is separate from
private group-call invitations. Preview capacity is four simultaneous people,
one approved device per account, from a channel audience of up to 128 devices.
The installed Preview 0.3.6 and existing host are unchanged. Railway stays paused.
The [local checkpoint](evidence/phase4-community-voice-local-2026-10-22.json)
records the first audio-only routes, failures, regression checks and source
hashes. The subsequent [room video slice](ROOM_VIDEO.md) adds cameras and
simultaneous screen video, with a newer capability gate.

## Participation and privacy

Join requires signed community admission, a current approved MLS device,
channel read/send permission and accepted community rules. Read-only listeners
and separate connect/speak/video permissions are future work. Bans, kicks,
timeouts, device removal and rules screening are checked by the backend; clients
also verify the signed policy and device identity. All devices in the channel
must announce control format 4 before room media can start. Audio-only format 3
devices must upgrade; migration 0027 adds the version without rewriting 0026.
Existing private
group calls still use format 2 controls and their original exporter context.

The join dialog discloses direct-peer address exposure and offers relay-only
when TURN is configured. The first participant chooses the active room's policy;
others must review and match it. An occupied room cannot silently downgrade
relay-only. An empty room may start with a newly reviewed policy. Each new
connection must verify the selected relay in relay-only mode.

The first person waits with the microphone off. A second joins without waiting
for other channel members, and more can join until the preview capacity is
reached. New participants trigger fresh pair keys and rebuilt peer connections.
Continuing microphone sources and mute state are preserved; brief audio gaps
are possible. Ordinary leave, including the owner's departure, does not own or
end the room. The last remaining person releases capture while waiting.

Leaving stops original/clone tracks, workers and connections synchronously and
drops local ephemeral private-key references. Returning generates a new private
contribution and incarnation. Locks, MLS epoch changes, authorization failure,
stalled verification and the 50-minute preview session deadline also stop media.
Changing general MLS membership or governance may require everyone to rejoin;
seamless general channel rekey remains open. A late permission grant cannot start
capture after the user leaves or a newer attempt begins.

## Public occupancy and client-only media keys

`VoicePresence` and `VoiceRoom` are Rust-owned protocol types. An approved device
signs a domain-separated statement binding the server, channel, MLS epoch,
room generation, random incarnation, public P-256 contribution, privacy choice,
active/departed state and issue/expiry times. Presence leases last at most 30
seconds and renew while joined. The server stores only these **public** statements
and room routing metadata. It never receives the ephemeral private contribution,
ECDH shared secret, MLS exporter base or derived frame keys. Public ECDH points
are connection metadata, and this visibility differs from private group calls,
whose contributions remain inside MLS.

The backend serializes occupancy changes, enforces four slots and one device per
account, rejects stale updates and advances the room revision on occupancy
changes. A room survives becoming empty. A new MLS epoch creates a new room
generation. Clients verify participant signatures against approved MLS identities,
check current policy and expiry, reject duplicate accounts and refuse a decreasing
revision or a changed membership manifest at the same revision.

Media keys combine a pair's nonextractable ECDH contribution with a client-only
MLS exporter. The context binds server, channel, epoch, room generation, revision,
privacy, selected devices and signed public contributions/incarnations. Returning
to an earlier subset cannot restore that subset's old keys because the room
revision has advanced. A cold client creates a fresh incarnation/private key.
Each mesh generation has disposable key wrappers; replacing old workers does not
destroy the current participant's continuing contribution.

SDP and peer ICE information travel through encrypted MLS controls and never
enter ordinary message history. A four-person full mesh has six peer pairs and
twelve directed streams. Larger rooms need the planned SFU and measured limits.
One authenticated MLS `room-heartbeat` broadcast per participant every ten
seconds advances only that sender's peer links. Child heartbeat sends are
coalesced at the room boundary; ordinary private-call heartbeat behavior is
unchanged. Fresh signed channel policy and room leases are checked independently,
with a 25-second verification watchdog. Presence statement duration is at most
30 seconds; a five-second future-clock allowance applies to signed issue times.
Camera, screen video and multiple shares now use the existing encrypted video
slots, with separate explicit capture consent and immediate teardown on room
membership changes. See [room video](ROOM_VIDEO.md). Shared computer audio and
separate track publication permissions remain open; existing 1:1 camera and
screen video remain separate.

## Bounds and acceptance

The server controls availability and can withhold valid occupancy statements.
A signed active lease can remain valid for up to 30 seconds; remote disappearance
or a withheld departure is bounded by lease expiry rather than guaranteed instant
delivery. Local leave/lock stops capture immediately. The server cannot forge
another device's contribution or decrypt pair media. Selected endpoints can
record or disclose content. WebCrypto/JavaScript reference disposal is not a
secure-erasure guarantee, and independent security review remains open.

Use `node scripts/verify-direct-calls.mjs --rooms` for the disposable local
community-room fixture; `--turn`, `--turn-tcp`, `--desktop` and `--room-revoke`
select route/runtime and permission scenarios. Generated tracks and test autoplay
are used. Physical permissions, microphones/speakers, independent networks,
NAT/firewalls, TURN-TLS, macOS/Linux and external SFrame interoperability remain
separate gates. These commands do not update the installed client or host.

| Completed local scenario | Outcomes |
| --- | ---: |
| Chrome direct, four-person room and empty-room reuse | 19 |
| Chrome relay-only through loopback TURN/UDP | 20 |
| Isolated Windows WebView2 through loopback TURN/TCP, including native cleanup | 21 |
| Signed permission change, capture teardown and denied rejoin | 16 |

All room routes decode twelve directed audio paths before the permission or
handover steps. They hold the active room for 32 seconds past the peer watchdog
to verify encrypted heartbeats and signed lease renewal, with no final HTTP 429
responses. Rapid five-account provisioning runs in a preceding request window;
production limits are unchanged. Existing private-group rejoin and 1:1
voice/camera/screen/recovery regressions also pass. Normal production assets omit
the acceptance entry and canaries.
