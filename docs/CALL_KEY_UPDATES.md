# Active call key updates

Phase 4 development slice, 2026-10-22. This applies to an established call between
two selected approved devices in a two-account DM. A linked device may change the
MLS epoch while the selected pair remains authorized. This is not group calling
and does not change the installed Preview 0.3.6 client or running host.

## Transition

1. Before applying an incoming MLS commit or producing a local DM device-add
   commit, pause media transforms and wait for the worker's acknowledgment before
   applying the commit. In-flight asynchronous crypto must not publish
   output after the pause. Discard old media key references and retain the capture
   tracks; mute and stopping existing video/share remain available.
2. Verify and persist the MLS transition. Recheck current backend routing,
   approved device proofs, both selected endpoints, block policy and current
   client capability leases. A removed group or unauthorized endpoint ends capture.
3. The original caller coordinates one transaction identified by a random 256-bit
   value. Both peers derive a new exporter base bound to that transaction, current
   server/conversation/epoch, original device ordering and relay-only policy.
4. Install new SFrame keys while paused. New random direction/track KIDs give
   each key a fresh counter namespace. The peer replies ready only after its
   worker confirms installation. The caller sends commit and resumes; the peer
   resumes and sends done. These four fixed control kinds travel exclusively in
   signed, MLS-encrypted delivery. They never contain a media key.
5. Return to connected only after confirmation, advancing authenticated media
   under the new keys and another positive relay selection check when required.
   The peer connection, microphone/camera/share tracks and mute state survive.

## Failure behavior

An independent 20-second timer covers stalled authentication, worker commands
and missing acknowledgments. Hangup, session locking and permission denial stop
capture. An epoch change during network recovery, or another epoch before the
current key update finishes, ends the call. There are at most 32 successful key
updates per call; the existing 50-minute preview call limit still applies.

Worker generations invalidate old encrypt/decrypt operations before their results
can be enqueued. Previously observed retired sender KIDs are dropped explicitly;
other old/wrong-key frames fail authentication. There is no overlapping old-key
decryption window or plaintext fallback. Already transmitted frames and copies
held by recipients cannot be recalled.

Completed transaction IDs remain rejected for the rest of the call. Stale,
mismatched, wrong-epoch or wrong-peer controls cannot confirm a different update.
Ended calls never resume capture automatically. An incomplete update is not
retried with an old key.

## Acceptance boundaries

The synthetic fixture uses real account/device linking and normal serialized
messaging maintenance to add a third approved device to an active two-person
DM. It checks new matching client-only keys, decoded audio/video continuity,
preserved mute/capture and normal hangup. Focused regressions cover stale frames,
in-flight invalidation, epoch rollback, authorization failure, replay, incomplete
handshakes, session lock, repeated changes and timeout cleanup.

Use `npm run test:calls -- --rekey`, with `--turn`, `--turn-tcp` or
`--desktop --turn` for the local relay/native variants. This is separate from the
rapid connection-restart stress matrix so production request limits remain
enforced. Both participants and all devices must run the current development
client; earlier development call implementations do not support these controls.

Physical capture, actual outages/network switches, independent networks,
TURN-TLS, cross-platform behavior and installed-release acceptance remain open.
General group membership/call admission, SFU integration and participant controls
are separate work. See [the roadmap](ROADMAP.md) and [call guide](DIRECT_CALLS.md).
The [2026-10-22 checkpoint](evidence/phase4-call-rekey-local-2026-10-22.json)
records the frozen direct/relay/native matrix and the earlier fixture failures.
