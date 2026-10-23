# Private group voice

**Current development, 2026-10-23:** private groups now support camera, screen and
separate opt-in computer audio with format-5 admission. Microphone switching,
mute preservation and an actual linked-device MLS epoch change pass together
with decoded media. Final direct rejoin (27 checks) and block revocation (17)
regressions pass locally. Physical devices and outside-network acceptance remain
manual. The dated 2026-10-22 text below retains the original voice checkpoint.

Local Phase 4 implementation, 2026-10-22. Three-account private conversations now
have a **Group voice call** action in the development client. The installed
Preview 0.3.6 and the user's running host are unchanged. Railway remains paused.
See [the original group checkpoint](evidence/phase4-group-voice-local-2026-10-22.json)
and [the rejoin checkpoint](evidence/phase4-group-rejoin-local-2026-10-22.json).
Persistent community channels are a separate [four-person voice-room slice](COMMUNITY_VOICE.md).

## Joining and leaving

Choose one approved device for each of the other two people, review direct or
relay-only privacy and start the call. Your microphone stays off until another
person answers. That pair can talk immediately; the third person can answer
later. An unanswered invitation never starts capture on that device.

Leaving removes your connections and stops your original microphone and cloned
tracks. The other two people stay in the call, including when the original
caller leaves or closes their messaging session. The remaining pair gets fresh
media keys while keeping its microphone sources and mute state. Connections and
encryption workers are rebuilt during that transition, so a brief audio gap is
possible. No uninterrupted-network or physical-device claim is made.

If only one person remains, the call stays open and releases that person's
microphone. **End group call** leaves locally. Mute affects every outgoing peer
link. The group interface is voice only; existing 1:1 camera and screen video
remain separate.

While another selected participant is still present, **Rejoin group call** lets
you return to the same call after leaving or declining. Rejoin checks access
again, requires another explicit click and creates a fresh ECDH key and microphone
source. Continuing participants keep their microphone sources and mute settings.
Leaving retains only public membership state in memory, with no private media
key or microphone; it also frees the active call slot for another call. Lock,
chat epoch change, another group invitation/start, expired peer heartbeats or
closing the client removes the rejoin option. It is not recovered after restart.

This is an invited private call, not a persistent community voice channel.
The first slice selects three devices from exactly three accounts. Changing
selected devices mid-call, larger rooms, group video/share and SFU support remain
open. Unanswered invitees may also join the continuing call later.

## Admission and fresh media keys

`GroupMembership` replaces the earlier fixed admission policy for the product
controller. The [earlier foundation](GROUP_CALLS.md) and its frozen evidence are
historical; the product no longer waits for all three answers or ends the whole
call on an ordinary leave. Each device's signed MLS public contribution expresses
its own consent. Controls are encrypted to the MLS chat; Rust emits live call
notifications only to selected devices. Other approved chat devices can read
public contributions but lack the ephemeral private secrets. The actual sender
is authenticated; another participant cannot forward a contribution under that
device's identity. Selected devices process membership controls in MLS delivery
order, even when the encrypted control names another selected recipient.

Each selected device generates a fresh nonextractable P-256 ECDH private key.
Each active pair combines its shared secret with a client-only MLS exporter base
through HKDF-SHA-256. The exporter and hashed transcript bind server,
conversation, room, epoch, selected devices, oriented peer connection, privacy
policy and public participation state. Initial pairs require only their two
contributions. An unjoined invitee knows the chat's MLS state but lacks their
pairwise ephemeral private secrets.

A join changes the transcript and every existing pair's connection identifier
and derived media key. A leave retains the departed public contribution as a
tombstone. Survivor keys therefore differ from both the full-group keys and
the earlier two-person keys; returning to two people never restores an old key.
Old workers, connections and cloned sender tracks are closed before replacements
are used. The original source and mute state survive while at least one peer
remains. A pending microphone grant is stopped if its call/capture generation
has already ended. Temporary secret buffers are cleared; WebCrypto/JavaScript
memory destruction is not a secure-erasure guarantee.

Version 2 controls use `group-member` descriptions of the exact form
`01:joined:04…` or `01:left:04…`: a two-digit participation round (01–32), state
and 130-character lowercase uncompressed P-256 public key. The transcript also
binds each device's round. A higher round can join again; leave dominates join
within one round. Lower rounds, repeated leaves and late old contributions cannot
replace the current round. A leave arriving before its matching join still leaves
a tombstone. Changing a pinned key within an active round ends local media.
Legacy unbound leave controls cannot remove a version 2 participant. Every local
rejoin generates a new private contribution; after 32 joins, start a new call.
The observer/resumed controller use different membership objects so unfinished
authorization or capture from the previous call attempt cannot enter the new one.

The controller automatically answers only the exact deterministic peer links
derived from its admitted transcript. Pending offers are bounded and checked
against the new link identifiers. Late negotiation, diagnostics or key-derivation
results from a previous membership generation cannot end or reopen the new one.
Both encryption-worker readiness and live authorization precede capture on each
link; authenticated incoming frames must advance before connected is shown.
There is no plaintext fallback.

## Compatibility, permissions and lifetime

Group format support is distinct from online presence. Approved devices announce
support through the existing media endpoint with `?group=true&format=2`. The backend
stores only the device key and public format number in `group_media_capabilities`
(migrations 0024–0025); no
call ID, participant list, public contribution, media key or media content enters
this table. A 1:1-only announcement removes support, and a version 1 group
announcement downgrades support. Existing records migrate as version 1.
Every device in the MLS chat must have announced version 2 support before these
controls can be used. An upgraded device can subsequently be offline without
its old presence lease ending the other participants' call. Existing 1:1 live
format leases retain their previous behavior.

The client verifies approved certificates and current MLS membership/epoch.
The server's group readiness check rejects a block between any pair in the
conversation. Repeated checks are coalesced across peer links while independent
authorization deadlines remain active; production request limits are unchanged.
Access loss, session lock or an MLS chat epoch change stops all local media
before the crypto transition. General MLS membership changes still require a
new call; call participation changes within the fixed chat use the rekey flow
above. A failed edge is allowed a bounded recovery; stale results are scoped to
that connection generation.

Active contributions/heartbeats are refreshed every ten seconds. Missing peers
expire after thirty seconds. Initial unanswered outgoing calls expire after a
minute; invitees can answer later while a live call continues. Connections have
a separate 45-second setup deadline, authorization has a 25-second watchdog and
the preview call has a 50-minute lifetime. Ended room IDs remain blocked against
late invitations. Timers are independent of stalled network/crypto requests.

## Acceptance boundaries

Local acceptance uses real accounts, approved devices, PostgreSQL, product MLS,
the group interface and actual peer connections with generated audio. It checks
two-person startup, late third join, all six decrypted/decoded directions,
pair-key agreement/isolation, mute, caller departure, survivor rekey, preserved
capture/mute, last-person microphone release, terminal cleanup and private wire
canaries. Relay checks verify every active link selects a relay with zero host
candidates. Separate permission testing blocks a pair and requires capture to
end everywhere. See the checkpoint for the exact completed route/platform runs.

Rejoin acceptance exercises the actual button, verifies fresh matching keys and
all six decoded paths, keeps survivor sources/mute, resends authenticated old
join/leave controls and leaves again. Browser direct, loopback TURN/UDP and
TURN/TCP, and isolated Windows WebView2 relay runs pass. The final observer timer
expiry guard has a focused regression and repeated direct/native relay runs;
the checkpoint labels earlier browser relay/block reports with their exact
source cut. The normal production bundle excludes acceptance pages and canaries.

Physical microphones/speakers, operating-system permission prompts, independent
networks, NAT/firewall changes, TURN-TLS, other platforms and external SFrame
interoperability remain separate acceptance gates. Local TURN TCP means TCP to
the relay; it does not prove an all-TCP media route. Selected endpoints can
record or redistribute content. This implementation has not had an independent
security review.
