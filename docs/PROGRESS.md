# Progress

**Normal-profile recovery accepted, 2026-10-25:** the user confirms that local
0.4.2 recovery works. The reported missing-history startup blocker is resolved
by manual acceptance, not measured telemetry. Restored history is saved in the
normal profile for future launches; repeated-launch/reboot behavior has not yet
been observed. [User acceptance](evidence/windows-history-recovery-user-acceptance-2026-10-25.json).
Earlier pending checkpoints below retain their original scope.

**Missing history identified, 2026-10-25:** the normal Windows client can access
its saved encryption key but has no corresponding history file in that profile.
Signed local 0.4.2 is installed and adds explicit recovery of one matching earlier encrypted store,
authenticated with the existing OS key. It preserves the source, refuses overwrite,
conflicting copies and active files, and never creates replacement keys. Client
checks pass 157 tests; native checks pass 17 tests plus clippy. All five installation/preservation checks pass. Actual normal-profile
recovery remains pending the user's sign-in and recovery click. See [recovery details](MESSAGING_STARTUP_RECOVERY.md).

**Real-use messaging gate reopened, 2026-10-25:** the user reports encrypted
messaging failing immediately after normal sign-in to 0.4.0, despite the saved
server sidebar working. Retry reproduces it. A signed local 0.4.1 diagnostic patch is installed; it
preserves fixed native storage errors and removes idle call-ended notices;
156 client tests, 14 native tests and five installation/preservation checks pass.
The underlying storage condition is
still unconfirmed; no keys or history were reset. See
[the startup investigation](MESSAGING_STARTUP_RECOVERY.md). The published 0.4.0
release and prior local acceptance evidence retain their original scope.

**Released and upgraded, 2026-10-25:** [Preview 0.4.0](https://github.com/KBHarris/hearth/releases/tag/v0.4.0)
is published. All 14 public assets match the validated local checksums. The
installed Windows client and original selected server are both 0.4.0 at source
`df97a1e`; the server is healthy and its SFU/relay services are running. The
actual signed update performed its backup/restore rehearsal. Original operator
credentials, server/OPAQUE keys, accounts/devices, durable encrypted history and
storage match the protected baseline. The installed client matches the frozen
native binary apart from the verified Tauri NSIS bundle marker, and all 19
bundle/upgrade checks pass. [Publication and preservation proof](evidence/preview-0.4.0-publication-upgrade-2026-10-25.json).
The local automated Phase 4 release work is complete. Manual device/network,
normal Start-menu sidebar, clean installation/reboot/fresh restore and remaining
platform acceptance stay open; Railway/hosted CI remain paused and Spotify disabled.

The following dated checkpoints retain the work and original failure history.

**Accepted local release gate, 2026-10-25:** the complete isolated 25-person SFU
run passes all 16 checks at acceptance commit `eeb4b2a`, using production media
source `df97a1e`. All 600 directed audio paths, video/screen/computer audio, load,
wrong-key rejection, membership rotation, targeted permission removal, track
cleanup and request limits pass. The final audit inspects up to 4,521 captured
frames per endpoint; the prior arbitrary 4,096-frame ceiling was a test defect.
The never-joined device correctly owns no publisher keys. All npm verification
passes (151 client tests), and production assets exclude acceptance code.
[Sanitized evidence](evidence/phase4-release-local-2026-10-25.json) freezes 23
passing reports. The installed Windows client is now 0.4.0 and all 19 bundle/upgrade
checks pass; publication and actual server/media upgrade are next. Railway remains paused and Spotify disabled.

Earlier checkpoints below retain the original failed results and investigations.

**Isolation update, 2026-10-25:** the final isolated `df97a1e` result actually
records successful targeted permission removal. Its stage label was stale when
the subsequent combined cleanup/privacy assertion failed. The new four-person
isolated-renderer lifecycle check passes all 16 checks, including track cleanup,
key privacy, history filtering and permission removal. The wire audit contained
an unrelated 4,096-frame ceiling that reported failure solely from traffic volume.
The corrected acceptance audit scans every captured frame, requires actual traffic
and checks every owned key, including a leak in frame 5,000. A never-joined
device correctly owns no publisher keys and is covered by regression evidence. No production
media, permissions, request limits or watchdogs changed. A fresh complete 25-person
run is still required before publication; old failed evidence remains unchanged.

**Checkpoint confirmed, 2026-10-25:** the final isolated run at `df97a1e`
(`sfu25-isolated-final-2026-10-24`) finished with `outcome: fail` during
`Distributed permission revocation`. Its recorded media/privacy checks are true,
but that does not override the failed overall result. The remaining blocker is
to isolate and resolve this final permission-removal failure, then obtain a passing
complete capacity result. No new release or installed client/server upgrade has
occurred. No additional test run was started for this status check.

**Current release gate, 2026-10-24:** no release or installed client/server upgrade
has occurred. Railway remains paused and Spotify disabled. The latest complete
25-person run (`eb8e7b2`) passed 600 decoded microphone paths, camera/screen and
computer audio, load, wrong-key rejection and leave/rekey, then failed targeted
permission removal when one unaffected survivor ended. Its trace shows HTTP 409
and one rejected outbox control. That run remains failed; the rebuilt candidate
has been superseded by source `df97a1e`. Its signed candidate and production
image checks are ready; capacity acceptance, installed validation, publication
and actual client/server upgrades remain pending.

**Serialized upload conflict isolated, 2026-10-24:** a room control can lose the
epoch race after local preflight and encryption. After Rust rejects and rolls
back that exact upload, its HTTP 409 now requests fresh verified room admission.
Forbidden/malformed controls and ordinary chat retain their previous terminal
handling. Periodic publisher-key repeats also use the existing bounded recovery
for transient signaling instead of ending capture. Regressions fail before the
corrections and pass after, including forbidden-repeat capture cleanup. No grant,
key validation, request limit or product watchdog was relaxed.
The three-person forced-conflict fixture passes 11 checks with real MLS and
decoded survivor audio, preserved capture/mute, fresh keys, cleanup and no
throttling. Required npm checks pass, including 149 client tests. It injects
exactly one simulated HTTP 409 after serialization:
`target/direct-calls-evidence/sfu-conflict-isolated-2026-10-24/sfu-room-direct/result.json`.
The `guided-eb8e7b2` candidate is marked superseded and has not been installed
or published.
The `df97a1e` candidate has been rebuilt and assembled with passing production
asset isolation and eight production-image recovery checks. The first capacity
attempt on that source failed with a network error during admission 6, before
voice joins, and remains failed. All builds and other fixtures completed before
a fresh isolated attempt, `sfu25-isolated-final-2026-10-24`; it also records only
sanitized network error codes. No installed client/server changes have occurred.


**Private-call issue isolated and corrected:** call signaling now publishes its
waiting state before asynchronous delivery/SDP work, so a fast authenticated
answer is accepted and a connected event cannot be overwritten by a late send
acknowledgement. Both deterministic timing regressions pass. A focused immutable
three-account linked-device MLS test passes all 15 checks, including six decoded
audio directions after the epoch change, fresh keys, retained capture/mute,
cleanup, and no plaintext keys/SDP on the wire. Evidence:
`target/direct-calls-evidence/private-epoch-isolated-2026-10-23/group-direct/result.json`.
The combined private camera/screen/computer-audio/device/MLS recovery gate also
passes 16 checks. These remain local synthetic-media results. The new `--group-epoch` mode isolates this transition
without unrelated device-switch waits. The earlier transient fixture lookup now
waits for conversation metadata rather than throwing while it refreshes.

**Focused room permission transition, 2026-10-24:** new signed governance can
arrive before the MLS epoch has committed it. Rust already rejects sending in
that state; room exports/signaling now detect the policy/epoch mismatch before
crypto and return the existing retryable 409. Own permission loss remains a
terminal 403. The queue regression fails before the correction and passes after;
valid work still invokes Rust. The immutable three-person SFU permission-removal
case passes all 10 checks: only the restricted participant stops, survivors keep
capture/mute, rotate keys and decode both audio directions, and all tracks clean
up without throttling. Evidence:
`target/direct-calls-evidence/sfu-policy-bound-epoch-2026-10-24/sfu-room-direct/result.json`.
Required npm checks pass, including 146 client tests. This closes the focused
case, not the full 25-person permission gate. Diagnostic errors record only the
fixed operation name, never inputs, message content or keys.

**Windows transport isolation, 2026-10-24:** the two-person native SFU/TURN-TCP
fixture passes 10 checks, including real decoded audio, encryption before
publication, selected relays with no host candidates, provider isolation and
native storage cleanup. The earlier connection failure did not reproduce when
run alone; no transport change is claimed. Evidence:
`target/direct-calls-evidence/native-sfu-pair-2026-10-24/sfu-room-native-turn-tcp/result.json`.
The complete Windows media repeat now passes 20 checks, and combined private
video/computer-audio/device/MLS recovery passes 16 at source `dd36a69`. Evidence:
`target/direct-calls-evidence/native-sfu-final-policy-2026-10-24/sfu-room-native-turn-tcp/result.json`
and `target/direct-calls-evidence/private-media-final-policy-2026-10-24/group-direct/result.json`.
The complete stage repeat hit the fixture runner timeout without returning a
renderer result. It is retained as a failed/unfinished run in
`target/phase4-sfu-evidence/stage-final-policy-2026-10-24.log`; it is not a pass.
A shorter promotion/demotion cycle now has named policy steps, a 30-second
fixture watchdog per owner operation and bounded operation-name-only traces.
The isolated promotion/demotion cycle passes 8 checks, and isolated listening
removal passes 8, including decoded survivor audio. The full stage runner had a
six-minute controller allowance despite 255 seconds of mandatory budget waits;
its test-only allowance now covers those waits and setup, while each owner
policy action has a 30-second fixture watchdog. Product authorization/recovery
deadlines and request limits are unchanged. The complete stage sequence now passes all 10 checks with the corrected test
controller budget, including repeated-promotion consent and targeted listening
revocation. No further stage product change was needed. Evidence:
`target/direct-calls-evidence/stage-final-bounded-2026-10-24/sfu-room-direct/result.json`.
The final 25-person acceptance run is in progress. Evidence:
`target/direct-calls-evidence/stage-cycle-isolated-2026-10-24/sfu-room-direct/result.json`
and `target/direct-calls-evidence/stage-listen-isolated-2026-10-24/sfu-room-direct/result.json`.

Remaining work is being diagnosed one issue at a time with small focused cases;
the complete capacity matrix will run again only after those corrections pass.

## Earlier checkpoints retained for provenance

**Capacity checkpoint, 2026-10-23 (source `dae3fb2`):** implementation is
present, but the complete 25-person SFU release gate has not passed. The latest
distributed run decoded all 600 directed microphone paths among 25 participants,
then failed at **Distributed camera and screen**. This is a failed full run, not
a stable voice/video/screen/load acceptance result. Its raw result is retained at
`target/direct-calls-evidence/sfu25-durable-checkpoints-2026-10-23/sfu-room-direct/result.json`.
The final Windows SFU repeat passes 20 checks, private-group media/device/MLS
recovery passes 16, stage consent/permissions pass 9, and the complete npm suite
passes with 130 client tests. Rust formatting, Clippy, default tests and the
isolated database policy regression also pass.

No new release has been published; the installed client and selected existing
server remain unchanged. Current installers/images predate the latest source and
must be rebuilt after the full gate passes. Next: diagnose the camera/screen
failure, pass the complete room fixture, rebuild and freeze final evidence,
publish signed assets, then perform and verify the authorized data-preserving
client/server upgrades. Automatic approval review previously reached the account
usage cap; work resumed after the reset. Railway remains paused and Spotify stays
disabled. The investigation entries below are chronological history.

**Resumed scheduling correction, 2026-10-23:** an overloaded delivery batch can
otherwise keep all sixteen envelopes ahead of a fresh authorization request.
Delivery now saves and publishes a shorter accepted prefix when urgent media work
is waiting or processing has taken 250 ms, then services that work before the next
prefix. Fresh authorization also takes priority over queued key exports, with one
serialized MLS owner and the existing storage/publication barrier. Eight focused
queue/prefix tests pass, including resumption without loss/replay and no exposure
after a failed save. Request limits, leases and authorization deadlines remain
unchanged. The full capacity gate is being repeated before release.

The adaptive-prefix repeat keeps all 25 endpoints connected with fresh access
checks (maximum recorded policy-read time about 2.4 seconds), but fails the PCM
matrix: two receiver sites have tracks but no decoded samples. This remains a
failed capacity run. A separate short 26-site/24-player-per-site WebRTC diagnostic
decodes received tracks on every site when HTML playback is routed into each
site's clocked silent context. The capacity fixture now routes its production
Playback elements through that context too, rather than keeping hardware outputs
for the HTML players. PCM assertions remain on actual received WebRTC tracks;
neither encryption nor decoding assertions are bypassed. This fixture routing
does not establish physical speaker behavior. The full gate must be repeated.

The HTML-output routing repeat also fails the PCM matrix. DOM capture confirms
late decoder/output errors on several live receiver tracks; a diagnostic reset
clears the element errors but does not make the full test pass. That run is
explicitly marked as diagnostically modified and excluded from release evidence.
The next fixture splits its 26 isolated sites between two independent browsers,
with the same real accounts, MLS, E2EE and media assertions. Production playback
now surfaces late element errors, bounds automatic decoder-output recovery to
three retries, keeps gesture failures explicit and cancels stale work on cleanup.
New players inherit volume/deafen before asynchronous output selection; selecting
an unchanged sink avoids reopening it. Five focused playback/output tests pass.

**Phase 4 completion work in progress, 2026-10-23:** the user authorized finishing
all remaining implementation and automated validation, followed by a new release
and data-preserving upgrades of this computer's client and existing server. Human
device/network acceptance may remain. Railway is still paused; no hosted CI run
is authorized or dispatched. Nothing has been released or installed in this pass.

New work includes independent connect/listen/speak/camera/screen permissions with
signed legacy-policy compatibility, stage channel types and explicit speaker
consent, microphone/camera switching, speaker selection/volume/deafen, bounded
community/private-group MLS recovery, and encrypted scheduled events/RSVP and
shared playback controls. Events pass a real two-device MLS and sealed-storage
test. Provider URL normalization and stale-host clock bounds pass unit tests.
Chromium verifies that the opaque player cannot read the parent page/storage
or navigate back to the application origin, and makes no provider request before
consent. Native Windows acceptance also rejects frame access to storage/native
commands. YouTube and SoundCloud's official public examples initialize after
fixture consent; real playback/account/autoplay acceptance remains manual.
The user chose to disable Spotify for this release on 2026-10-23. Its player
connection and creation are disabled and its origins removed from player CSPs.
These are implementation/testing updates, not a claim that Phase 4 has closed.

**Additional local results, 2026-10-23:** the three-person SFU stage fixture passes
listener-only capture, explicit speaking consent after promotion, demotion,
repeat promotion without microphone reopening, targeted listening revocation and
owned-track cleanup. This uses unchanged request/recovery limits and deliberately
paces repeated owner policy edits across their budget windows. The production
TURN-TLS certificate-wait wrapper passes trusted fixture TLS 1.3, authenticated
allocation and bidirectional relay traffic; it does not establish WebRTC TLS
route selection or public certificate/router acceptance. Private-group camera,
screen and separate computer audio now pass together with microphone switching
and an actual linked-device MLS epoch change after consolidating duplicate
heartbeats. The current Windows native direct-call fixture passes 22 checks,
including media, ICE recovery, relay-only selection, block enforcement and
provider/native isolation. No rate or recovery limits were increased.

Native host implementation now stages a matching signed deployment package before
an update, includes media configuration/credentials in protected backup and
restore, and exposes optional SFU/relay controls. A disposable signed legacy host
passes backup rehearsal, failed-update rollback, protected media-file retention
and fresh restore. The packaged WSS route passes an authenticated WebSocket
upgrade through the pinned production proxy with a trusted private certificate.
This computer's selected real host has not been changed.

The focused room/media permission and capture suite passes 23 tests. The first
updated six-person SFU run passes decoded microphone/camera/screen/computer audio,
independent mute, wrong-key rejection, and capture-preserving join/leave rotation;
it then exposes a permission-change recovery race. The corrected epoch handling
is being retested. Large-room attempts are retained as failures: conservative
setup pacing preserves login/account budgets, exact credential/policy reuse and
read-only room checks remove redundant work, and the latest 25-person attempt
reaches 11 joined endpoints without throttling or lease errors before a
connection timeout. The 25-person stable-media/load milestone remains open.

The isolated-renderer 25-person attempt reached its final join before several
leases/verification checks expired; it is a failure, with no stable-media/load
claim. The next attempt uses an optimized server matching production's build
profile, retaining every request, account and lease bound. Its result and the
new browser TURN-TLS route check are pending. Rust formatting, workspace Clippy
and all default Rust tests pass with loopback networking available. The private
S3/real HTTP/MLS regression and new exact-device/block admission tests pass.

**Release candidate 0.4.0, later 2026-10-23:** the production images pass eight
local browser/server/restart/fresh database/key-volume checks. The signed host
package passes six integrity/preparation checks and thirteen native lifecycle,
rollback and fresh-restore checks, including private media settings. The frozen
direct MLS-rekey/TCP fixture passes 17 checks and mesh video join/leave/rejoin
passes 27. Windows SFU/TCP acceptance passes 19, including native isolation.
The 25-person run reaches all 25 connected endpoints but still fails its PCM
matrix as leases expire; this is not accepted as a stable-room pass. Independent
signed keepalives now avoid the durable message queue without refreshing the
separate policy deadline. Bounded stale-snapshot and authorization-deadline
regressions pass; the full room test is being repeated. No release or real-host
upgrade has occurred. Windows reserves the default relay range on this machine;
UDP 30000–30099 passed a bind-only preflight for its eventual private host setting.

Remaining work and release gates are tracked in
[the Phase 4 release checklist](PHASE4_RELEASE_CHECKLIST.md). Historical frozen
checkpoints below retain their original scope and counts.

**Release-gate investigation, 2026-10-23:** the independent-lease 25-person run
reached all joins but failed the sustained PCM matrix: five endpoints lost
authorization or participation, leaving twenty connected. It is retained as a
failure and does not establish room capacity. Additional diagnostics now record
only authorization age, lease time remaining and bounded operation timings.
The concurrent Windows SFU/TCP run failed during joining; its isolated rerun
passes all twenty checks, including the held-durable-queue lease probe, decoded
media, relay-only routes, rekey, permission revocation and native cleanup.
The signed 0.4.0 installer/package remain unpublished candidates. A read-only,
protected baseline of the selected existing host has been taken for eventual
before/after preservation verification; its services and data are unchanged.

The diagnostic repeat confirmed a fresh-policy read delayed by about 21 seconds
behind durable work; its endpoint then correctly stopped at the unchanged
25-second authorization deadline while its independently renewed lease was still
valid. Fresh room reads/key exports/admission now receive service only between
serialized operations or durably saved delivery batches. They do not run against
an uncommitted batch or bypass verification. SFU status repeats use thirty seconds
because signed liveness remains independent; media changes still send at once.
Old-room controls are ignored while a fresh recovery owns admission. The 128
client tests, complete npm verification and direct MLS-rekey/TCP fixture pass.
Full Windows SFU and 25-person fixtures are being repeated before publication.

The updated Windows SFU/TCP fixture passes twenty checks and all thirty directed
audio paths; the direct rekey/TCP fixture passes seventeen. Frozen production
images pass the eight browser/restart/restore checks, and all eleven production
assets pass the acceptance-entry and fixture-canary scan. A subsequent large-room
attempt lost a local connection during its final setup admission, before any
voice join; that failure is retained. The isolated repeat has passed setup and
is measuring media with passive numeric diagnostics. Publication and actual
client/server upgrades still await that room's complete result.

The isolated priority-scheduling run kept all twenty-five endpoints connected
through the PCM deadline, with all 600 subscribed audio paths receiving encrypted
RTP and no encryption-worker/missing-key errors. It still failed PCM: the
distributed fixture had not mounted the product `Playback` component, unlike
the actual room UI and the passing six-person native fixture. Its statistics-only
Web Audio nodes did not start Chromium's remote audio decoders. The fixture now
uses the actual product component with silent output and is being rerun. The
earlier zero-PCM result remains a failure; it is not substituted with transport
statistics. This change affects acceptance tooling, not production media code.

The playback repeat also retained all 25 endpoints but decoded audio on only
eight endpoints, so it failed. A short independent fixture reproduced output
exhaustion: 26 hardware AudioContexts plus 26 players started only 24 players;
replacing context hardware outputs with clocked silent sinks started all 26 and
measured PCM in every context. Chromium's Windows audio manager declares a
50-output-stream ceiling. The full distributed fixture now uses silent context
sinks and explicit fixture autoplay delegation; physical output remains manual.
Its complete npm suite passes, and the full media test is running again.

The clocked-output run passes all 600 directed microphone PCM paths and keeps
the unjoined MLS device capture-free. It then fails at camera/screen startup
when multiple fresh room reads/renewals time out and trigger recovery. This is
not a full capacity pass. Each room read was repeating channel/member/rules
queries for every occupied account while holding the room lock. Current peer
membership, account deletion, invitation time and rules acceptance are now read
in one batch under the same community/policy lock, with the same READ, CONNECT
and LISTEN decisions. An isolated PostgreSQL regression passes deletion,
departure, screening, read/listen denial and re-invitation checks. Limits and
authorization deadlines are unchanged; real media acceptance is being repeated.

The first batched-policy stage repeat hit a temporary HTTP 503 during a role
change and stopped a listener. Room availability failures now enter the existing
paused, thirty-second/three-per-minute recovery; permission denials remain
terminal. The real stage repeat passes all nine checks. A further capacity
attempt exposed independent keepalives still suppressing policy polling through
the old shared schedule. Policy polling now continues every five seconds while
renewal is pending, with one coalesced fresh read and the unchanged twenty-five
second authorization deadline. A regression proves a denial stops capture before
a pending renewal can return. All npm checks pass, including 129 client tests.
The complete capacity fixture is running with this final scheduling correction.

The final Windows SFU repeat passes twenty checks. Capacity still exposes a
fresh-authorization gap on a few endpoints during long normal outbox/maintenance
work. Urgent checks now receive service after each durable save and between
read-only maintenance requests; delivery batches explicitly defer that service
until their saved prefix has been published in order. A regression covers the
save/publication barrier and failure path. The complete npm suite passes with
130 client tests. The Windows repeat now passes 20 checks and private-group
MLS/device/media recovery passes 16. The capacity repeat decodes all 600 directed
microphone paths, then fails during camera/screen sharing; the complete gate and
publication remain pending.

**Phase 4 SFU and computer audio, 2026-10-22:** optional SFU community rooms
are implemented with a 25-account admission bound, current signed device/room
leases and 60-second revision-specific routing tokens. Each publisher derives
fresh sender material from randomness and the MLS exporter, then individually
wraps it to the other joined devices using their authenticated ECDH agreements.
The SFU receives no frame keys. A worker readiness challenge precedes capture;
unknown/plain publications are not subscribed. Format 5 and migration 0028 gate
the expanded layout while private group format 2 is retained.

Camera, screen video and explicitly selected computer/tab audio publish once
per SFU endpoint. Ordinary SFU join/leave changes replace physical rooms and
keys while preserving continuing originals and microphone mute. Microphone
mute remains independent of screen audio; stopping sharing stops its audio.
Permission loss, worker/connection failure and stale authorization stop capture.
A late microphone permission grant now requires fresh authorization before any
clone is returned. Mesh rooms retain their four-person and video-stop policies.

The isolated six-person Windows WebView2 SFU fixture passes 17 checks over
TURN/TCP, using six bidirectional peer connections. All 30 directed microphone
paths decode; camera, screen and computer audio decode and survive membership
rotation. Both logical directions select relays with zero host candidates.
A routing-authorized observer with wrong media keys receives encrypted packets
but decodes zero video frames and silent audio. All 40 tracked original/owned
clone tracks stop, and native SQLCipher fixture credentials/files drain and
are removed. This uses synthetic media and a test loopback/autoplay profile,
not physical-device, installed-client or internet acceptance.

The 25-device signed MLS/key-admission milestone test also passes. It is an
explicit five-minute test; default Rust verification passes 53 tests with six
ignored. All 165 JavaScript tests, typechecking, lint, normal production build,
Rust formatting/clippy, protocol drift and WASM target checking pass. Optional
pinned LiveKit/coturn Compose overlays pass disposable startup, custom-port and
private-file cleanup checks. No user host services or installed client changed.

The live 25-person media/load target and the updated 1:1/mesh computer-audio
regressions are being checked separately. Separate connect/speak/listen and
camera/screen permissions, device switching, general MLS room rekey, resilient
network recovery, stage channels, events and watch parties remain open, along
with physical platforms, independent networks, TURN-TLS and deployment gates.
See [SFU rooms](SFU_ROOMS.md) and [computer audio](COMPUTER_AUDIO.md).
Railway and hosted CI remain paused; this is not a release.

**Phase 4 community room camera/screen video, 2026-10-22:** the local
four-person room now offers independent camera and screen controls after audio
connects. Multiple participants can share simultaneously, using one original
capture per source and a clone for each encrypted peer edge. Admission/policy is
checked before capture, again after the permission prompt, and on each sender.
Cancel/leave/lock/epoch changes invalidate late grants. Permission denial leaves
audio running; unexpected captured audio is stopped. Room roster changes stop
all video originals/clones before rebuilding keys, preserve continuing microphone
sources/mute and require explicit video consent for the new audience.

Authenticated camera/share flags travel in encrypted room heartbeats with a
mesh-scoped monotonic counter. Labeled camera/screen tiles and muted local
previews use the correct negotiated slots; stale or conflicting states cannot
restore a stopped tile. Format 4 and migration 0027 require upgraded channel
devices before room capture, while private-group format 2 is retained. No new
public camera/share fields or media keys reach the host.

Final Chrome direct (26), relay-only TURN/UDP with signed revocation (23), and
isolated Windows WebView2 over TURN/TCP including native cleanup (28) pass 77 room
outcomes. Each decodes twelve distinct video paths alongside twelve audio paths,
from two cameras/two simultaneous shares and twelve owned sender clones. Camera
stop preserves shares/audio; membership changes stop every video original/clone;
rejoining requires fresh video consent. Permission loss stops video and denies
rejoin. The older-client gate rejects audio-only format 3 before capture. Relay
metrics select relays with zero host candidates, and no final room run has HTTP
429 responses. Private-group rejoin (27) and 1:1 voice/camera/share/four-restart
regressions (18) pass another 45 outcomes.

All 151 JavaScript tests and 52 default Rust tests (five ignored), Rust formatting/
clippy, current WASM build/target check, protocol drift, normal production build
and normal Windows desktop compilation pass. The normal production assets were
restored after the isolated native fixture and exclude acceptance entry points
and canaries. Native fixture credentials/files are removed after native calls
drain. Preliminary format-3 runs and the restricted invocation's SDK loopback
failures remain recorded separately from the final format-4 routes. See
[the frozen local checkpoint](evidence/phase4-room-video-local-2026-10-22.json).

See [room video](ROOM_VIDEO.md). Larger SFU rooms, separate connect/speak/listen
and video-publication permissions, shared computer audio, seamless video roster
changes, physical devices and independent-network/platform acceptance remain
open. The installed Preview 0.3.6 and user's host are unchanged. Railway and
hosted CI remain paused.

**Phase 4 community voice rooms, 2026-10-22:** the local development client now
supports persistent Voice channels with explicit join/leave rather than ringing
invitations. Up to four people, one approved device each, can participate from a
larger channel audience. The first person waits with the microphone off, and the
room remains available after everyone leaves or the owner closes their session.
Joining/rejoining uses a fresh nonextractable contribution; occupancy changes
refresh pair keys/connections while continuing sources and mute are preserved.
Read/send permission, signed community admission, device approval, rules screening
and control format 3 are required. Separate listen/connect/speak permissions and
seamless general MLS epoch changes remain open.

Migration 0026 adds the Voice channel kind and bounded public room/presence
metadata. Approved devices sign the room generation, epoch, incarnation, public
P-256 point, privacy, state and short lifetime. The backend never receives media
keys. Clients verify signatures and policy, bind the room revision into keys,
reject backwards/equivocating manifests and stop capture on expired verification.
An existing local crypto-view bug labeled channels as private conversations; the
view now reports its authenticated channel association, with a regression test.
Room liveness uses one MLS-authenticated broadcast per participant instead of
separate network heartbeats for every pair. Default server request limits remain.

The direct scenario passes four-person/twelve-path audio, capacity denial before
capture, owner departure, mute/source preservation, fresh-key rejoin, empty-room
reuse and private wire canaries. The fixture separates its rapid five-account
provisioning burst from media acceptance and holds the room beyond the peer
watchdog to verify heartbeat/lease renewal. Direct Chrome (19), relay-only UDP
Chrome (20), isolated Windows WebView2 over TURN/TCP (21) and signed-permission
revocation (16) pass 76 room outcomes. All twelve full-room directions decrypt
and decode; final room runs have no HTTP 429 responses and relay paths select
relays with zero host candidates. Native fixture credentials/files are removed
after native calls drain. The original private-group rejoin (27) and 1:1
voice/camera/share/recovery (18) regressions also pass.

All 142 JavaScript tests, 52 default Rust tests (five ignored), formatting/clippy,
WASM build/target check, protocol drift, normal production build and normal
Windows desktop compilation pass. Acceptance entry points and canaries are
excluded from normal production assets. The initial Windows run had an oversized
test label and an insufficient harness deadline; the corrected room-only harness
retains its strict report contract and records renderer results before cleanup.
The earlier development failures and the fixture-only source cut are retained in
[the checkpoint](evidence/phase4-community-voice-local-2026-10-22.json).
See [the room guide](COMMUNITY_VOICE.md).
The room-video follow-up above supersedes this audio-only checkpoint's camera/
share limits. Computer audio, larger SFU rooms and physical/independent-network
acceptance remain open. Installed Preview 0.3.6 and the user's host are unchanged;
Railway and hosted CI remain paused.

**Phase 4 same-call rejoining, 2026-10-22:** the development client now offers
**Rejoin group call** after leaving or declining while a selected peer is still
live. Rejoin checks authorization again, creates a fresh ephemeral ECDH key and
microphone source, and refreshes all active pair connections/keys. Continuing
participants keep their original microphone sources and mute state. Leaving
releases media and the active call slot; only public call state remains in memory.
Lock, epoch change, client close, another group start/invitation or expired peers
removes that option. This is bounded to the current session and fixed three-device
private roster, with at most 32 joins per device and the original 50-minute lifetime.

Version 2 `group-member` controls bind the public contribution and joined/left
state to a monotonic participation round. Leaves dominate joins in the same
round, including when delivered first; old joins/leaves cannot resurrect or
remove a later incarnation. Round state also binds pair keys and connection IDs.
The old membership object is invalidated before resuming, so late grants or
capture cannot enter the new attempt. Mesh endpoints share an authorization
grant for at most two seconds; explicit rejoin always requests a fresh grant.
Production request limits are unchanged. Migration 0025 stores only a public
format number beside the existing device capability record; older group
announcements downgrade it and block version 2 controls until upgraded again.

Validation and boundaries are recorded in
[the rejoin checkpoint](evidence/phase4-group-rejoin-local-2026-10-22.json).
Local direct, TURN/UDP, TURN/TCP, isolated Windows WebView2 and block-revocation
scenarios pass 129 group outcomes, including six decoded audio directions after
rejoin, preserved survivor capture/mute, replayed old round controls and a second
leave. The 18-outcome existing 1:1 voice/camera/share/recovery regression also
passes. All 130 JavaScript tests and 50 default Rust tests pass (five ignored),
along with formatting/clippy, WASM build/target check, protocol drift, the normal
production build and normal Windows desktop compilation. The final observer
timer guard was verified by a focused test and repeated direct/native relay
acceptance; the earlier browser UDP/TCP/block reports retain their explicit
pre-guard source hashes. Test relay containers and native credentials/files are
removed; the original four Hearth containers remain up. The checkpoint preserves
development failures and distinguishes local generated media from physical or
internet acceptance.
The earlier group evidence below remains a frozen historical checkpoint.
The installed Preview 0.3.6 and user's host are unchanged; Railway and hosted CI
remain paused. Persistent community rooms, larger rosters, group video/share and
physical/independent-network acceptance remain open.

**Phase 4 private group voice, 2026-10-22:** the development client now supports
three-account private voice calls with independent joins. Two people can talk
while the third invitation is unanswered; the third can join later. An ordinary
leave, including the original caller leaving, keeps the remaining pair in the
call. A join/leave refreshes derived media keys and peer connections while
preserving continuing microphone sources and mute settings. The last person
releases microphone capture while waiting. This replaces the original fixed
all-answer/end-on-leave draft after the user's feedback.

The mesh reuses authenticated MLS signaling and SFrame workers, with one original
microphone per device and cloned tracks per peer link. Public contribution and
departure transcripts bind fresh pair keys; departure tombstones prevent reuse
of pre-join keys. Asynchronous work is scoped to the membership generation.
Group compatibility is stored as approved-device format support (migration 0024),
separately from online presence. Older-format clients block incompatible controls;
a previously upgraded device going offline does not end the other callers' call.
Readiness rejects a private block between any account pair. Chat MLS epoch changes,
lock and lost authorization stop capture before the transition.

Local browser and isolated Windows WebView2 acceptance now cover the product
group interface, real accounts/MLS, independently joining participants, all six
decoded/encrypted directions, direct and relay-only paths, mute, caller departure,
survivor key changes, capture preservation, last-person source release and cleanup.
The separate block scenario stops all three captures. Exact route/check counts,
validation, retained failures and boundaries are in
[the checkpoint](evidence/phase4-group-voice-local-2026-10-22.json).
The group matrix passes 21 direct, 21 TURN/UDP, 21 TURN/TCP, 23 native Windows
TURN/UDP and 16 block-revocation outcomes (102 total). Direct and native relay
runs additionally measure decoded survivor audio after leave/rekey/unmute.
The 18-outcome 1:1 recovery and 16-outcome relay key-update regressions pass.
All matching-key authentication/replay/malformed rejections are zero; relay
links select relays with zero host candidates. Native test credentials/files
are removed after storage calls drain. Web typecheck/lint, all 120 JavaScript
tests, the normal production build, Rust formatting/clippy, 49 default tests
(five ignored), WASM build/target check, protocol drift and normal Windows
desktop compilation pass. Acceptance pages/canaries are excluded from the
normal production assets.

This remains invited private voice for three selected devices, rather than a
persistent community voice room. Same-call rejoining was completed in the later
checkpoint above; larger groups, group camera/share, general chat-membership rekey,
physical devices and internet/
full-platform acceptance remain open. The installed Preview 0.3.6 and user's
host are unchanged; Railway and hosted CI remain paused. See
[the behavior and implementation](GROUP_VOICE.md).

**Phase 4 three-person admission/key foundation, 2026-10-22:** fixed-roster
group call controls now bind exactly one selected device from each of three
private-chat accounts. The pure client state machine requires explicit consent
and directly authenticated public contributions from every selected device.
Each selected pair adds fresh nonextractable P-256 ECDH material to its MLS base
with transcript-bound HKDF-SHA-256. Knowing the chat's MLS state alone is
insufficient to derive that pair's media key. Invalid points, key changes, leave,
deadlines, access loss and late crypto completion fail closed.

The messaging observer registry now supports independent call consumers and
waits for every publication-pause acknowledgment before an MLS commit. Ordinary
1:1 wire serialization remains unchanged; its controller ignores group messages.
Seventeen new JavaScript safety tests and three new Rust tests cover admission,
pair-key isolation/frame authentication, cancellation, observer barriers, real
three-account/four-device MLS roster checks and legacy wire compatibility.
Web typecheck/lint, all 103 JavaScript tests, normal production build, Rust
formatting/clippy, 49 default tests (five ignored), WASM build/target check,
protocol drift and normal Windows desktop compilation pass.
Existing 1:1 acceptance also passes 18 direct recovery checks and 16 TURN/UDP
key-update checks. Both relay endpoints select relays with zero host candidates
and complete one key update; all matching-key authentication/replay/malformed
rejections are zero. These are synthetic loopback regressions, not group media
or physical/internet acceptance. Checkpoint-specific output preserves earlier runs.

**Group calls remain disabled.** The interface, server readiness gate and usable
calling feature remain 1:1. A distinct group-format compatibility lease, shared
microphone/mesh controller, live whole-roster permission checks, lifecycle cleanup
and all six directed audio/relay paths still need integration and acceptance.
The foundation itself performs no capture or networking. See
[the design and next implementation steps](GROUP_CALLS.md) and
[the local checkpoint](evidence/phase4-group-admission-local-2026-10-22.json).
Railway, hosted CI, installed Preview 0.3.6 and the user's host are unchanged.

**Phase 4 active-call key updates, 2026-10-22:** an established two-device call
now survives a verified linked-device addition to its two-account MLS DM. Before
processing or producing the commit, messaging waits for the media worker to
acknowledge publication pause. Old key references and in-flight crypto outputs
are invalidated. Both selected endpoints are reauthorized; fresh exporter keys
bind a random transaction, new epoch, server/conversation, original device pair
and relay policy. Install/ready/commit/done confirmation plus advancing new-key
media and route verification are required before connected is shown again.
Microphone/camera capture, mute state and the peer connection remain in place.

Ten focused safety tests cover pause acknowledgment, old-key/stale-frame drops,
in-flight cancellation, rollback, stale controls, missing confirmation, access
denial, session lock, repeated epochs and stalled-request cleanup. A 20-second
deadline and 32-update call limit bound the transition. An epoch change during
network recovery, overlapping epoch changes, lost access or incomplete updates
end capture. General group-call admission/rekey and physical/network acceptance
remain open. See [the key-update design](CALL_KEY_UPDATES.md) and
[the local checkpoint](evidence/phase4-call-rekey-local-2026-10-22.json).
The frozen key-update matrix passes 15 direct, 16 TURN/UDP, 16 TURN/TCP and
17 native Windows TURN/UDP outcomes (64 total). Both peers confirm one successful
key update in each run, with zero authentication/replay/malformed-frame rejections.
Paused/retired-key frame drops are counted separately. Relay-only runs report
selected relays and zero host candidates. The existing 18-outcome direct recovery
scenario also passes all four restarts. Native fixture storage/credentials are
drained and removed. Web typecheck/lint, all 86 JavaScript tests, production build,
Rust formatting/clippy, 46 default tests (five ignored), WASM build/check, protocol
drift check and normal Windows desktop compilation pass. Normal production assets
exclude synthetic acceptance pages and canaries.

The first integration attempts exposed a mutable two-person UI fixture growing
to three device entries, then an HTTP 429 from combining four rapid ICE restarts
with device linking/maintenance. Both failures are retained. Panel participants
are now snapshotted, and the new `--rekey` scenario runs independently with real
production request limits. The installed 0.3.6 client and running host are
unchanged; Railway and hosted CI remain paused.

**Phase 4 same-epoch call recovery, 2026-10-22:** established calls now attempt
bounded ICE recovery while keeping their existing microphone/camera/share tracks,
peer connection and SFrame workers/counters. Either participant may initiate;
simultaneous offers converge using deterministic glare roles. Encrypted SDP
transaction markers reject stale/mismatched answers and replayed offers. New
descriptions are reauthorized, relay-only routes are rechecked, and authenticated
media must advance before showing connected. Recovery has an independent
20-second deadline and six-transaction-per-minute bound. Mute, stopping active
video/share and hangup remain available while reconnecting.

Ten focused regressions cover transaction/replay handling, glare, rate limits,
authorization denial, epoch changes, hangup, stalled-request timeout and stale
answers. The synthetic route matrix covers caller/callee restarts, simultaneous
restarts, real ICE credential changes, continued decoded audio/video and unchanged
capture/key acquisition. Automatic triggering uses an injected disconnect event;
it does not measure a physical outage. See
[the recovery checkpoint](evidence/phase4-call-recovery-local-2026-10-22.json).
Final acceptance passes 18 direct, 19 TURN/UDP, 19 TURN/TCP and 20 native Windows
TURN/UDP outcomes (76 total), with four completed recovery scenarios on both
peers in every run. Matching-key authentication/replay/malformed rejections are
zero; relay peers report selected relays and zero host candidates. Native fixture
credentials/files are removed after its storage operations drain. Web typecheck,
lint, all 76 JavaScript tests and normal production build pass, as do Rust
formatting/clippy, 45 default tests (five ignored) and normal Windows desktop
compilation. Production assets exclude synthetic acceptance pages and canaries.

The first TURN run passed recovery but failed a subsequent call with no caller
relay candidate, consistent with overlapping ICE allocations exhausting the tiny
fixture quotas. That failure is retained; the disposable fixture now allows bounded
overlap and each new call fetches fresh credentials. No production quotas changed.
Automatic in-call key rotation, full signaling/network reconnection, real network
switches/outages, TURN-TLS, physical capture and group calls remain open. Epoch
changes still end capture. The installed 0.3.6 client/host are unchanged; Railway
and hosted CI remain paused.

**Phase 4 native Windows media acceptance, 2026-10-21:** an explicitly enabled
Tauri acceptance build now runs the product call panel, crypto/WASM, real accounts,
MLS delivery and native SQLCipher message storage in Windows WebView2. Direct,
forced TURN/UDP and forced TURN/TCP runs pass **15/16/16 checks**. Both relay peers
select verified relay candidates and gather zero host candidates. Synthetic audio,
camera and screen video decode, with zero authentication/replay/malformed-frame
rejections; hangup and block revocation stop capture. Each successful native run
verifies that pending storage operations drain and temporary credentials/files are
removed. A browser direct regression also passes all 14 checks.

The first native attempt completed media checks but failed its fixture-completion
call because the command argument wrapper was missing. The wrapper is corrected
and all three final native runs pass. The interrupted directory was removed;
credential cleanup for that first attempt could not be independently verified
from the separate cleanup process. Its failure remains recorded. See
[the native acceptance record](evidence/phase4-native-direct-calls-local-2026-10-21.json)
and [repeatable commands and scope](DIRECT_CALLS.md).

This advances native runtime acceptance, using synthetic tracks and a test autoplay
override. Physical microphones/cameras, screen-picker permissions, installed release
behavior, cross-platform and independent-network/TURN-TLS acceptance remain open.
The user's installed 0.3.6/sidebar profile and existing host were not updated.
Railway and hosted CI remain paused.
Final verification passes all 66 JavaScript tests, typecheck, lint and production
build; Rust formatting/clippy and 45 default tests pass (five database/storage
integration tests remain ignored). Native fixture clippy, the storage-drain test
and default Windows desktop compilation also pass. The normal production bundle
contains neither acceptance page nor synthetic call canaries. Initial restricted
HTTP/mock test failures are retained in local logs; the network-enabled reruns pass.

**Start-menu profile recovery, 2026-10-21:** the user's 0.3.6 screenshot confirmed
the sidebar was still empty. The exact failure was then reproduced by opening
the installed Start-menu shortcut in the real File Explorer UI with no WebView
debug flags. The normal Windows profile contained only `host-backups`; its
`host-selection.json` was absent. Codex-launched tests and PowerShell/COM probes
saw a different, populated AppData view and therefore overclaimed normal-launch
coverage. The retry patch cannot restore a selection that is absent in that profile.

Recovery used the actual client UI to reselect the original signed host package,
preserving its HTTPS/public address, then connect to the running local server.
The real profile now contains `host-selection.json`; **Gold Team** appears in the
sidebar and survives closing/reopening through that same Windows shortcut. The
four original host containers remain running, with no recreation/restart or data
reset. No account login, key migration, new installer or hosted run was performed.
The client is left open at Gold Team's sign-in screen. See
[the normal-launch evidence](evidence/host-sidebar-start-menu-2026-10-21.json) and
[updated recovery/testing notes](HOST_SIDEBAR_RECOVERY.md). Earlier passing reports
remain historical evidence of their narrower test contexts.

**Saved-host sidebar follow-up, 2026-10-21:** the user reported that reopening
Hearth with Docker running still did not show their server automatically. This
reopens the real-use acceptance claim from Preview 0.3.5; its historical passing
fixture does not resolve the new report. Read-only checks found the saved host
selection, matching signed-package files and healthy running host services. The
installed 0.3.5 client showed the saved server during diagnosis, so the original
failure has not been reproduced and its exact cause remains unconfirmed.

The sidebar now retries failed/timed-out native lookups, refreshes on focus,
visibility and hosting changes, preserves the last known host on transient
failure, and exposes a recovery entry when the saved package cannot provide an
address. Four lifecycle tests and six production-UI checks pass. Web verification
passes all 66 JavaScript tests, typecheck, lint and build. A separate local 0.3.6
installer is built from frozen Preview source plus this frontend fix;
unfinished Phase 4 media/cloud changes are excluded. Its exact UI bundle also
passes the six checks. After the user closed Hearth, the local patch was installed
and passed ten Windows native checks: matching version/revision and executable,
saved-host visibility with empty browser storage, focus/reopen behavior, existing
profile visibility and native-file preservation, aligned Desktop/Start shortcuts,
and the original four host containers retained. The initial native fault-injection
attempt timed out waiting for its injection counter; negative cases are covered by the browser fixture,
while the final native run checks actual focus and reopening. See
[the recovery notes](HOST_SIDEBAR_RECOVERY.md) and
[local evidence](evidence/host-sidebar-recovery-2026-10-21.json). Actual normal-launch confirmation
remains open; do not treat the original report as resolved by these fixtures.
Final current-workspace Rust formatting/clippy, 45 default tests (five ignored),
WASM release build and Windows desktop check also pass. Existing cache/linker
warnings remain; PostgreSQL integration and physical-media gates are separate.

**Phase 4 local call matrix completed, 2026-10-21:** the frozen sequential run
passes 14 direct, 15 forced TURN/UDP and 15 forced TURN/TCP outcomes. Both relay
runs report selected relay candidates on both peers and zero gathered host
candidates. All three decode synthetic audio, camera and screen video with zero
matching-key authentication, malformed-frame or replay rejections; block revocation
and capture cleanup pass. TCP here means the client's TURN connection transport;
this is not TURN-TLS or a claim of all-TCP peer relay traffic. See the
[new local matrix record](evidence/phase4-direct-calls-local-2026-10-21.json).
This closes the interrupted local matrix from the prior checkpoint. Physical
capture/permissions, installed product media, independent networks, NAT/firewalls,
TURN-TLS and platform interoperability remain open. The installed 0.3.6 sidebar
patch excludes this development media slice. Railway and hosted CI remain paused.

**Phase 4 encrypted 1:1 call checkpoint, 2026-10-20:** source now includes
authenticated, MLS-encrypted call signaling, device/DM permission checks and
client-only MLS-exported media keys. SFrame encoded-frame encryption must be
ready before capture is published. The product call panel supports explicit
answer/decline, microphone mute, camera, screen video and hangup. Blocks, expired
authorization/heartbeats and conversation epoch changes stop capture; an epoch
change requires a new call. All participating devices must run an active,
compatible client. Calls are currently limited to two accounts and 50 minutes.

Operator-configured STUN/TURN, authenticated short-lived coturn credentials and
relay-only enforcement are implemented. No public STUN service is contacted by
default. A prior loopback TURN/UDP run passed 15 outcomes; its result JSON was
removed when the final rerun began. That rerun was interrupted by a fixture-page
reload during the parallel production/WASM build, before producing a result.
The final UDP/TCP matrix therefore remains incomplete; TCP was not reached.

The retained direct Chromium report passes all 14 outcomes with actual product
UI, accounts, WASM, MLS and peer connections, using synthetic audio/camera/screen
tracks. It verifies decoded media, capture cleanup, block revocation, encryption
and missing-TURN rejection. Final web typecheck/lint/build and 62 JavaScript
tests pass. Rust checks pass: 45 default tests, four isolated PostgreSQL tests,
formatting, clippy, protocol drift, WASM target and Windows desktop compilation.
The HTTP/product-WASM/private-S3 regression passes 96 checks. See the
[call guide](DIRECT_CALLS.md) and
[checkpoint record](evidence/phase4-direct-calls-local-2026-10-20.json).

Work stopped here at the user's usage-limit request. Next: rerun the frozen
local direct/UDP/TCP matrix without concurrent source or WASM changes, then test
physical capture/permissions and installed clients across independent networks,
including TURN-TLS, NAT/firewalls and relay-only privacy. Cross-platform product
media, automatic rekey/reconnect, group calls/SFU and screen audio remain open.
Phase 4 is not complete. Railway remains paused; no hosted CI or deployment was
started. The installed Preview and four existing host containers are preserved.

**Phase 4 local hosting update, 2026-10-20:** native Railway IaC now defines the
backend, private PostgreSQL/bucket, persistent server keys and optional website.
Pinned CLI/SDK tooling prepares a filtered source snapshot, reviews/applies the
definition, assigns generated domains and checks the exact uploaded deployments
and public backend/proxy identity. These provider operations are implemented but
have not been executed against Railway. The user chose **keep it local**; no
cloud resources, usage charges or hosted CI runs were started.

Production server/web images build from both the repository and filtered upload
snapshot. Local Docker/Chromium acceptance passes eight outcomes: private keys and
unprivileged runtimes; headers/deep links; worker/WASM/cache behavior; OPAQUE owner
sign-in, device enrollment and WebSocket upgrade; restart persistence; fresh
database/key-volume restore; missing-key rejection; and secret canaries absent
from logs, including failed proxy requests. Matching restored identity, approved
device and browser session are checked. This fixture does not restore encrypted
objects or prove a provider backup works.

Web typecheck/lint/build, 59 JavaScript tests, the separate IaC typecheck and the
dependency audit pass (zero reported vulnerabilities). See the
[cloud deployment guide](CLOUD_DEPLOYMENT.md) and
[local acceptance record](evidence/phase4-cloud-local-2026-10-20.json).
Protected cloud owner-code handoff, custom domains, actual provider retries,
Railway bucket/CORS and cross-network browser/desktop acceptance remain open.
At that hosting checkpoint, product media was unimplemented; the later call
checkpoint above supersedes that status for 1:1 calls. SFU remains open. The installed Preview and four
running local host services were preserved.

**Stage 4 started, 2026-10-20:** the first cloud-hosting prerequisite is implemented:
private S3 storage supports configurable bucket names, signing regions, path or
virtual-hosted URLs, and existing buckets without bucket-level probes/creation.
SeaweedFS defaults remain compatible. Partial/invalid configuration fails startup
without echoing values; a bucket-creation conflict requires authenticated access
before success. [Storage configuration](STORAGE_CONFIGURATION.md) documents the
settings, Railway credential mapping and supported constraints.

Local configuration/signing/mock checks and an isolated private-S3 transfer test
pass, including 50,000,768-byte ciphertext, byte integrity, incorrect-length and
anonymous-access rejection, signature tampering/expiry and object deletion.
The [local acceptance record](evidence/phase4-storage-local-2026-10-20.json)
also records 43 default Rust tests, four isolated PostgreSQL integration tests,
94 HTTP/product-WASM/private-S3 checks, formatting and server clippy passing.
Virtual-hosted URL generation is checked locally; actual virtual-hosted/Railway
network transfers and browser CORS remain open. At this first storage checkpoint,
Railway IaC, guided provisioning, production browser hosting and product media
were subsequent work; the later local hosting update above records progress. The separate
clean-machine Host/Join acceptance gates remain open. No cloud resources or hosted
CI runs were started, and the installed Preview/running host were preserved.

**Host/Join implementation update, 2026-10-20:** Preview 0.3.5 source adds signed
in-app host preparation, explicit runtime installation, opt-in sign-in startup,
portable backup/fresh restore, and an identity-bound outside-network check with
tester-declared network location. Native saved-host discovery now survives empty
browser server storage and Docker failure, addressing the reported missing-host
entry after reopening. The user's existing saved selection and four running host
services were inspected read-only and preserved.

Local verification passes 53 JavaScript tests, web typecheck/lint/build, 12 guided
browser checks, 14 default desktop Rust tests, 4 signed-package/TAR checks,
12 isolated Docker recovery outcomes and 6 Windows native WebView2 checks.
Fresh-volume restore checks original server/OPAQUE identity files, credentials
and database contents, rejects an existing host and retries the same journal.
This is not a fresh OS installation measurement. Cross-OS clean installation,
actual reboot/sign-in execution, new two-household messaging and fresh installed
host-preparation acceptance remain open in [the acceptance matrix](HOST_JOIN_ACCEPTANCE.md).

The actual [Windows Preview 0.3.5 upgrade](evidence/windows-host-join-preview-0.3.5-2026-10-20.json)
also passes all 16 checks on frozen product source `b84c11f`. The installed app
matches that version/revision, native cold/warm invites still work, and the native
saved host reappears with empty browser storage. Existing profiles/configuration
are preserved and the user's four host services stay running without restart.
All 23 migrations, private storage and signing-identity persistence pass in the
new package's disposable server. Signed release assets and a host-preparation
catalog/TAR were [published and verified](evidence/preview-0.3.5-publication-2026-10-20.json)
on 2026-10-20. All 14 uploaded asset digests match their prepared files;
unauthenticated HTTPS downloads verify the 13 payloads and six latest-feed files,
including the checksum list. The release tag points to frozen source `b84c11f`.
The user and buddy
currently have Windows machines only; macOS/Linux installation acceptance is not
waived by that availability limit.

Phase 3's existing final-source hosted results below remain scoped to Phase 3;
they do not validate the new Host/Join source. No new hosted run was dispatched.

**Phase 3 preview is complete, 2026-10-18.** The requested
[full run 39098465058](https://github.com/KBHarris/hearth/actions/runs/39098465058)
passes all 14 jobs on source `53659dd`, including the final acceptance gate.
Windows, macOS and Linux each pass all 16 Phase 3 packaged outcomes with native
storage draining and fixture cleanup. The Windows community UI passes all 42
checks; HTTP/private-S3 passes 94; Chrome, Firefox and Safari each pass their
17-check browser fixture. The [verified hosted record](evidence/phase3-final-hosted-2026-10-18.json)
preserves all 21 reports and the documented unsupported Linux native-media
capability result, which uses the supported-browser fallback.

The buddy-PC test is accepted by user instruction and the existing provider/OS
notification preview waiver remains in force. Earlier failed runs retain their
original results. The separate full Host/Join installation checkpoint remains
next before Phase 4; this closeout does not complete that installer work or the
separate Phase 2 50-person/week human trial.

Earlier dated records below retain their scope and status at the time.

Phase 3 local closeout, 2026-10-17: source `7ff42f0` passes 94 real HTTP/private-S3,
54 expanded two-client browser and 19 Windows packaged outcomes. The current
product code matches published Preview 0.3.4. A test-only forum navigation race
was fixed: the harness now waits for the selected forum and enabled encrypted
posting controls on both clients, within the existing deadline. The complete
expanded rerun passes forums, reports, polls, ownership in both directions,
50 MB files, exports, departure and narrow layouts. See the
[local closeout record](evidence/phase3-closeout-local-2026-10-17.json).

The same closeout passes 49 JavaScript tests, web typecheck/lint/build, Rust
formatting/Clippy, 34 default Rust tests plus all four otherwise-ignored PostgreSQL
tests on an isolated database, protocol generation and WASM checks. Windows
native Clippy, nine unit checks, the shutdown barrier, five OS-vault checks,
eight SQLCipher checks, native MLS and all 18 synthetic native media outcomes
pass. Manual-only workflow policy and all 11 suite-result tests pass; local
actionlint passes without ShellCheck. The native media fixture was rerun on its
own after an initial shared-port conflict. No product media readiness is claimed.

Phase 3's final-source full hosted acceptance remains the sole open Phase 3 gate.
The corrected source and local evidence are ready for one explicitly requested
`full` run on `codex/phase3-navigation`. No new hosted run has been dispatched;
the earlier frozen-source failure remains recorded. The full Host/Join installer
checkpoint remains separate and open before Phase 4.

Phase 3 manual acceptance update, 2026-10-17: the user instructed us to assume
their buddy-PC test went well. The [manual acceptance record](evidence/phase3-manual-acceptance-2026-10-17.json)
closes that Phase 3 preview gate by user acceptance, superseding its October 16
waiver. No detailed results or independent telemetry were supplied. The existing
real provider/OS notification waiver remains in force. Final-source hosted
cross-platform acceptance and the separate full Host/Join installation checkpoint
remain open; the buddy result does not establish all-OS clean-machine acceptance.

Host/Join checkpoint update, 2026-10-17: [Preview 0.3.4](https://github.com/KBHarris/hearth/releases/tag/v0.3.4)
is published and installed from frozen product source `11cd35e`. Desktop hosting
generates its configuration natively; Node.js is now only an advanced CLI
dependency. **Use this computer's host** authorizes owner setup for the selected
loopback server after checking its identity and setup state. The private code
stays in memory, expires after five minutes and clears on submit/cancellation.
The native shutdown budget now allows ordered Docker service grace periods;
the initial 60-second Stop regression was reproduced and the final rerun passes.

Local validation passes web/Rust verification, nine native unit checks, Linux
desktop compilation, 12 browser setup/failure outcomes, five real Docker owner
enrollment outcomes, native/CLI configuration compatibility and nine complete
Docker lifecycle/backup/rollback outcomes. The [18 installed package checks](evidence/windows-preview-0.3.4-2026-10-17.json)
exercise real WebView2 owner authorization, remote rejection and expiry without
creating disposable accounts in the user's OS key store. Existing native profiles,
operator configuration and the running host are preserved. See the [checkpoint evidence](evidence/host-join-checkpoint-2026-10-17.json).
The distribution secret scan has no findings; all eleven public downloads and
both live feeds match the tested files. At publication time, the installed native
updater reported the app current and offered the signed server update; that update
had not yet been applied to the host. See the [publication record](evidence/preview-0.3.4-release-2026-10-17.json).

The user authorized one corrected full hosted milestone on October 17. The
[run for frozen Preview 0.3.3](https://github.com/KBHarris/hearth/actions/runs/39070916430)
finished with a Windows community UI failure; the [dated record](evidence/phase3-hosted-2026-10-17.json)
retains that result. All seven core jobs, three browser jobs, Linux/macOS desktop
jobs and all three platforms' 16-outcome Phase 3 packaged suites passed. The
Windows UI fixture passed 22 checks, then appended a URL to the signed-in Join
form's prefilled address and timed out awaiting an identity error. Its correction
replaces the address using keyboard input and asserts the resulting value. The
[complete corrected local UI suite](evidence/phase3-ui-correction-2026-10-17.json)
passes all 42 checks against the current 0.3.4 product source; this does not change
the frozen hosted result.
Windows native media checks were skipped after that failure. Linux WebKitGTK
retains its explicitly unsupported media capability result; no Linux media pass
is claimed. Phase 3 hosted closeout remains open; no automatic retry is authorized.
Later 0.3.4 checkpoint changes are locally validated and outside this run's scope.
The [remaining setup order](GUIDED_SETUP.md#next-implementation-slice) is automatic
runtime/package preparation, opt-in startup, fresh-host restore, internet setup
and relay evaluation, then clean-machine/cross-OS acceptance. Docker installation
remains manual. These local improvements do not close the complete checkpoint.

Preview 0.3.3 was published and installed on 2026-10-17 from frozen product source
`9a13cf0`. All [15 package/upgrade checks](evidence/windows-preview-0.3.3-2026-10-17.json)
pass, including cold/warm legacy invite handling, the visible installed version,
and preservation of the existing native profile and running host. The distribution
secret scan has no findings. All eleven anonymous downloads match tested hashes,
and both signed Preview feeds serve 0.3.3. See the [publication record](evidence/preview-0.3.3-release-2026-10-17.json).
New sharing exposes only pretty codes and a separate recipient server address;
the owner can remain connected locally. The corrected hosted run's result is
recorded above. The original failed run remains recorded below; Phase 3 is not
yet closed.

Preview closeout update, 2026-10-16: the user waived the real two-household and
provider/OS notification gates for this preview and authorized one full hosted
cross-platform pass after fixing the host configuration mismatch. These waivers
are not measured passes. The startup fix rejects missing original configuration
when persistent Docker data exists and verifies database credentials through the
service network before starting Hearth. Existing files, data and passwords stay
intact on failure. The real Docker regression passes nine outcomes, including
missing files, wrong credentials, successful retry and migration rollback. The
client header also displays its version; desktop reads the installed native
version, and browser builds use the Preview build version. New Preview host
packages use local port 8080 at the user's request. Host controls read existing
port overrides from .env, retaining compatibility with older packages and custom
ports; startup failures identify the configured port as a possible conflict.
Preview 0.3.2 passes [13 package/upgrade checks](evidence/windows-preview-0.3.2-2026-10-16.json)
and is installed locally. The user's current host was moved from 8183 to 8080
after they authorized closing the conflicting Open WebUI app. Its credentials,
data and identity were preserved; the client now uses the new local address.
The [0.3.2 release](https://github.com/KBHarris/hearth/releases/tag/v0.3.2) is public.
All eleven anonymous downloads match the tested files, the distribution secret
scan has no findings, and both live Preview update feeds resolve to 0.3.2. The
installed native updater confirms the app is current and offers the signed 0.3.2
server update. See the [publication record](evidence/preview-0.3.2-release-2026-10-16.json).
The authorized [full hosted run](https://github.com/KBHarris/hearth/actions/runs/38999371729)
failed on frozen source `96548d8`: Linux deep-link 2.6.2 is incompatible with
rust-ini 0.21.3 (upstream issue #3710). The other two desktop jobs were cancelled
by fail-fast. All seven core jobs and Chrome/Firefox/Safari acceptance passed,
including 94 HTTP/private-S3 outcomes. The [failed milestone record](evidence/phase3-hosted-2026-10-16.json)
is retained; Phase 3 closeout remains pending. No further hosted run was dispatched.

Preview 0.3.3 is being prepared with code-only invite sharing and a separate
recipient server address. A local host can seal for its configured public HTTPS
address while storing the encrypted envelope through its existing authenticated
local connection. The address hint is limited to the selected local host, and
identity checks prevent sending the bearer token to a changed local server.
The upstream-recommended deep-link 2.6.1 compatibility pin passes a local Linux
desktop compilation with the real GTK dependencies. Web verification, Rust
formatting/Clippy/tests, six native unit checks, 14 real guided browser outcomes
and eight setup failure outcomes pass. On October 17 the user confirmed public
HTTPS health responds from a phone with Wi-Fi disabled. Access from the host PC
remains intermittent, consistent with a possible router loopback limitation;
this does not establish its cause or a complete two-household messaging pass.
No TLS verification was bypassed. See the [patch validation record](evidence/pretty-invites-2026-10-17.json).

Current implementation pass, 2026-10-16: 50 MB encrypted files, server-owner file
removal, authorized member sidebar/profile fingerprints, encrypted 32-character
invite relays, desktop hosting controls and signed app/server updates are in
source and the tested Windows Preview 0.3.1 package. Local checks include
94 real HTTP/private-S3 outcomes, 51 broad two-client UI outcomes, 13 focused
readable-account-code outcomes, six Docker host/failed-migration rollback outcomes
and three signed host-package integrity outcomes. The Windows packaged suite
passes 19 outcomes, including an exact 50 MB encrypted transfer and owner removal.
The [sanitized local record](evidence/phase3-local-2026-10-16.json) captures these
results and their dates. The publication audit completed
and the repository is public. Native invite opening advances the Host/Join checkpoint.
All [19 installer/package checks](evidence/windows-preview-2026-10-16.json) pass,
including OS invite association, cold/warm handoff, native Start/Stop/setup-code
controls, all 23 migrations and private storage. The old local install/profile
were backed up and replaced with Preview; the new host package is selected for
local testing. No hosted Actions were dispatched. Following explicit approval,
[Preview 0.3.1 was published](https://github.com/KBHarris/hearth/releases/tag/v0.3.1)
on October 16. All eleven anonymous asset downloads match the tested hashes, and
both Preview update feeds resolve to 0.3.1. See the
[publication verification](evidence/preview-release-2026-10-16.json).

The [ordered checklist](PHASE3_REMAINING.md) records the two explicit preview
waivers and the remaining authorized cross-platform acceptance. Runtime prerequisite installation, independent external
reachability, fresh-host restore and clean-machine setup remain open checkpoint
work. Historical results below do not close these gates for the new build.

Phase 4 scope expanded on 2026-10-16 to include Railway native IaC, guided cloud
provisioning, configurable private S3 storage and optional production browser
hosting. It also explicitly includes direct P2P media, TURN fallback, relay-only
privacy and LiveKit for larger rooms, with separately hosted media where needed.
See [the Phase 4 hosting and media plan](PHASE4_HOSTING_AND_MEDIA.md) for work order
and acceptance. These are planning additions; no Railway deployment, browser
hosting or product media implementation is claimed. Phase 3 and the local
Host/Join installer checkpoint retain their existing acceptance requirements.

Actions policy was corrected on 2026-10-15 to prioritize the user's budget:
[local-first, manual-only hosted CI](CI_STANDARD.md). The default `checks` tier
uses one Linux job; explicitly requested `core` and `full` tiers select broader
acceptance. There are no push, PR, tag, merge-group or scheduled triggers.
Expensive platform matrices wait for Linux acceptance, fail fast, and use one-day
artifacts. Linux packaged acceptance runs once instead of ten repetitions.
The earlier blanket full-suite/merge-gate requirement has been superseded.
The workflow and policy changes remain local until pushed/merged. No hosted
workflow was dispatched and no billing settings were changed. Local validation
does not establish a successful hosted run or measured monetary savings.
The existing 0.3.0 package is unchanged.
Local actionlint/ShellCheck, the budget policy and all eleven suite-result tests
pass. Ten budget-breaking workflow mutations were rejected locally.

Phase 3 scope was updated on 2026-10-15. The [ordered remaining-work checklist](PHASE3_REMAINING.md)
adds 50 MB uploads, server-owner file deletion, a **Server Members** sidebar and
clickable fingerprint/profile modals before the remaining validation gates.
These are planning additions; the current 0.3.0 package has not changed.

The latest two-PC Windows package is ready (2026-10-15):
`target/manual-test/guided-efd4af6/Hearth_Test_efd4af6_Windows_x64.zip` is the
friend-only installer/guide/checksum ZIP. Both PCs install Hearth Test 0.3.0;
the matching host folder contains a pinned server archive and fresh
`hearth-guided-test` deployment on backend 8183/S3 18335. Old test bundles, server
data and profiles were retired on 2026-10-15.
[Fifteen local package checks](evidence/windows-buddy-bundle-2026-10-15.json)
pass, including real NSIS installation, the production WebView2 Host/Join screen,
native version/profile/IPC, latest input guard, bundled-server discovery through
owner setup, all 21 migrations, private S3, identity-preserving restart, HTTPS
configuration and temporary-install cleanup. Native account creation and actual
two-house reachability/messaging remain human acceptance. Follow
[the latest two-PC guide](TWO_PC_LATEST_TEST.md); send only the friend ZIP.

Guided Host/Join setup is in its first implementation pass on
`codex/guided-setup` (2026-10-15). Fresh clients choose Host or Join, inspect a real
server and explicitly confirm before changing servers. Invites carry an origin,
public identity and account/community capabilities without saving those secrets.
The account/device and signed community admission flows remain in force.
Host currently connects an existing deployment; automatic service installation,
native invite handling and independent outside reachability remain open. See
[the guided setup development notes](GUIDED_SETUP.md) for scope and remaining work.
The [dated setup record](evidence/guided-setup-2026-10-15.json) records 46 broad
two-client/private-S3 browser checks followed by 12 final guided-join checks and
seven mock-response failure/cancellation checks. Final npm verification passes
38 tests, typecheck, lint and production build using the existing Phase 3 WASM.
Rust fmt/clippy and 34 default tests pass; four PostgreSQL integration tests remain
ignored by the default Rust command. Windows installed-product smoke acceptance is
recorded above; clean-machine and current macOS/Linux packaging remain open.

The Phase 3 foundation has local validation dated 2026-10-12.
The local HTTP/product-WASM suite passes 90 checks with private S3, including
valid and rejected access across the complete REST inventory and every gateway
operation. Signed account deletion revokes linked sessions, fences late credential
writes, survives restart retries and physically erases retained file ciphertext.
The packaged Windows client passes 17 checks with private S3, including the full Phase 3 workflow
and native SQLCipher/credential cleanup. The native shutdown-barrier regression passes.

The second menu pass includes compact actions, aligned checkboxes, paperclip
attachments, automatic address-derived link cards with an off setting, clear
permission rows, useful empty states and explicit ownership device selection.
Successor-authority ordering and opening a newly created encrypted channel are
fixed. The sidebar now refreshes channel changes from another device without
resetting open management forms. All 41 two-client browser/private-S3 checks pass,
including ownership in both directions, selected reports, polls, account privacy,
exact deletion confirmation and narrow layout. Automated setup stays within the
real server rate limits. Sanitized local evidence is saved for
[HTTP/WASM](evidence/phase3-http-private-s3-2026-10-12.json),
[Windows](evidence/phase3-windows-private-s3-2026-10-12.json) and
[browser controls](evidence/phase3-ui-private-s3-2026-10-12.json).
[Haven parity and setup requirements](HAVEN_PARITY_AND_SETUP.md) now define a guided
Host/Join installation checkpoint before media expansion.
The 2026-10-12 hosted attempts returned `startup_failure` before any job started.
Current macOS/Linux packaged validation remains pending.

## Test workspace cleanup (2026-10-15)

Superseded Phase 1/2 packages, disposable server fixtures, old operator configuration,
ten unused Docker server volumes, nine old image tags, three legacy Windows profiles
and nine saved test credentials were removed at the operator's request. Old staging
guides, bundle scripts and dated reports were retired. Architecture decisions and
reusable acceptance tools remain in source; earlier reports remain in Git history.
The current 0.3.0 bundle and its pinned server image are preserved. All 17 bundle
files retained their SHA-256 hashes across cleanup. New testing starts with fresh
accounts and server data using the latest guide above.

Cleanup validation passes: all local Markdown links resolve, retired paths are
absent, and all 13 manifest checksums match. `npm run verify` passes with local
networking enabled (the sandbox blocked its disposable HTTP fixtures). Rust
fmt/clippy and 34 tests pass, with four PostgreSQL tests ignored by default.
