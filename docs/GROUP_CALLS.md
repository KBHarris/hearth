# Three-person voice admission

Historical foundation checkpoint. The product now uses
[independent joins and continuing group voice](GROUP_VOICE.md): two people can
start and keep talking after someone leaves. The fixed admission policy below
records the earlier checkpoint, not the current calling behavior.

Local Phase 4 foundation, 2026-10-22. **Group calls are not usable yet.** The
development interface and server call-readiness endpoint still admit only 1:1
calls. This checkpoint adds the private wire format, Rust membership/exporter
checks, a pure admission state machine and client-only ephemeral key agreement.
It creates no microphone capture, peer connections, group interface or relay
allocations. See [the checkpoint](evidence/phase4-group-admission-local-2026-10-22.json).

## Fixed first scope

The planned first group slice is voice for exactly three accounts in an existing
private MLS conversation. Select exactly one approved device per account. The
roster is sorted and fixed for the call. Community voice rooms, adding people
mid-call, group video/share and SFU support remain later work. A participant
leaving will end this first group call; survivors will need a fresh invitation
and fresh keys. Existing 1:1 calls keep their current behavior.

## Implemented admission boundary

`GroupAdmission` consumes only controls already authenticated by the Rust MLS
engine. It returns outgoing controls for a future controller to deliver through
the same encrypted messaging session. It performs no I/O itself.

1. The caller selects the roster and explicitly starts. The other two selected
   devices receive `group-invite`; invitations do not grant capture permission.
2. Each invitee explicitly answers and sends `group-join` to the caller. The
   caller waits for both joins before broadcasting `group-ready` and its key.
3. After ready, each answered device sends its own `group-key` directly to each
   other selected device. Keys are pinned by authenticated sender. Forwarding
   another person's key through the caller cannot satisfy this step.
4. The caller sends `group-start` after receiving every contribution. Each device
   requires its own consent, ready/start and all three direct contributions.
   Out-of-order ready/key/start delivery is supported. A caller claiming ready
   or start alone cannot substitute an unanswered participant's contribution.
5. Decline, leave, a changed pinned key or explicit access/epoch loss permanently
   ends that admission instance. It cannot be revived by delayed controls.

Controls bind room ID, conversation, MLS epoch, sorted device roster and privacy
policy. Parent controls use the room ID as `call_id`; a future pair connection
will use its own call ID with the same `group_id` and `participants`. Rust checks
that all three selected devices resolve to the three distinct MLS accounts;
linked devices cannot substitute for another person. Group fields are omitted
entirely from ordinary 1:1 serialization, preserving that wire representation.
The 1:1 controller explicitly ignores group controls and pair envelopes.

Expired/mismatched controls are ignored. Admission is bounded to 60 seconds,
active peer heartbeat loss to 30 seconds and total lifetime to 50 minutes. The
future controller must drive heartbeat/deadline checks independently of network
requests, stop all capture on end and retain ended room IDs against reinvitation
replay. `canPublish` is only the consent barrier: deriving and installing keys,
waiting for encryption workers and rechecking live permissions are additional
requirements before capture/publication.

## Client-only media keys

An MLS exporter alone is insufficient to exclude unselected devices that already
belong to the chat: those devices know the chat's exporter state. Each selected
device therefore generates a fresh nonextractable WebCrypto P-256 ECDH private
key. Only its uncompressed 65-byte public key is included in encrypted controls.

For each selected pair, `GroupKeyAgreement` combines its 256-bit ECDH shared
secret with the Rust-exported MLS base using HKDF-SHA-256. The MLS base is the
salt. HKDF info is SHA-256 of the canonical JSON transcript containing the
`hearth/v1/group-call/media` domain, server, conversation, room, epoch, caller,
complete selected roster, privacy choice, sorted pair and all public contributions.
The info hash also respects Node WebCrypto's 1 KiB info bound. The Rust exporter
separately binds the group ID, roster, pair call ID, oriented endpoints, epoch and
privacy choice, leaving the existing 1:1 exporter context unchanged.

The helper rejects mismatched local keys, foreign contexts, invalid public points,
unselected/self peers and use before admission. Key failure ends admission and
disposes its local private-key reference. It rechecks disposal, room generation
and deadlines after asynchronous crypto, so late results cannot reopen a call.
Temporary shared-secret, salt and failed-result buffers are zeroed. The returned
key buffer belongs to the caller, which must zero it after transfer/installation.
WebCrypto key destruction and JavaScript memory reclamation cannot be guaranteed;
dropping a reference is not a secure-erasure claim.

Tests establish pair agreement, distinct pair keys, frame authentication and
failure to decrypt another pair using the third device's own derived key. This
is local implementation evidence, not an independent security review or proof
against a compromised/colluding selected endpoint. Authorized participants can
always record or redistribute content.

## Integration still required

- Add a distinct group-format capability lease/readiness gate before sending
  these controls. The existing 1:1 lease must not imply group-format support;
  older devices must not receive content they cannot decode.
- Implement the mesh controller and interface, with explicit per-device choices,
  one shared microphone source cloned into pair senders, and encryption-worker
  readiness before capture. Prevent concurrent 1:1/group calls.
- Authenticate live account/device/block status for the whole roster; end all
  capture before applying any MLS membership change. Coalesce permission checks
  without weakening backend request limits or delaying revocation enforcement.
- Bind pair offers deterministically to the admitted room/roster; automatically
  answer only those exact expected mesh edges after group consent and key setup.
- Exercise three real product clients: all six directed decoded/encrypted audio
  paths, pending-consent silence, relay-only selection on every edge, cancellation
  during permissions/crypto/capture, leave, epoch changes and device revocation.
- Verify disposable browser/native fixtures and cleanup, then physical devices,
  internet/NAT/firewall routes and platform behavior. No group media route,
  performance or bandwidth acceptance is claimed at this checkpoint.

The messaging observer registry now supports multiple independent call consumers.
An MLS commit waits for every publication-pause acknowledgment; unsupported
consumers are locked. A failing listener cannot suppress notification or teardown
of the others. Actual group capture must still be wired to that lifecycle.

Railway, hosted CI, the installed Preview 0.3.6 and the user's host remain unchanged.
