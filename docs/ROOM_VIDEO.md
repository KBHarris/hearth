# Community room camera and screen video

The original checkpoint below remains frozen. The subsequent
[SFU room implementation](SFU_ROOMS.md) adds a 25-account admission bound,
preserves continuing video sources across ordinary SFU room join/leave changes,
and supports explicitly selected [computer audio](COMPUTER_AUDIO.md). The current
mesh retains its four-person bound and now also preserves authorized continuing
capture while replacing sender clones/keys. Independent signed publication
permissions and format 5 replace the historical combined-media gate described
below. Late/unauthorized capture grants stop before publication. The 2026-10-23
private-group and native direct-call fixtures also cover expanded media.

The remaining text records the original 2026-10-22 checkpoint; its old control
format, source-stop policy and future-work statements are historical.

Phase 4 local development, 2026-10-22. Community Voice channels retain the
four-person preview mesh. After audio connects, a participant can explicitly
choose **Turn room camera on** and **Share screen with room**. Camera and screen
can run together, and different participants can share at the same time. Computer
audio is not captured. This does not install a new client, change the user's
host, deploy Railway or implement the larger-room SFU.

## Consent, authorization and capture

Joining captures neither camera nor screen. Solo rooms capture nothing. Video
publication requires connected room peers, current signed admission/policy,
approved MLS devices and the existing channel read/send permissions. Those
permissions currently apply to all room media; independent connect, speak,
camera and screen permission bits remain future work. Every MLS channel device
must announce room control format 4. Audio-only format 3 fails the room gate
before capture; migration 0027 retains earlier format records and expands the
public version constraint. Private group calls keep their format-2 controls and
exporter context.

The client checks room access before requesting capture and again after the
permission prompt resolves. Each encrypted peer edge also checks authorization
before accepting its video clone. A selected source must provide exactly one
live video track and no audio tracks; unexpected tracks are stopped. Canceling a
pending selection, leaving, locking or changing encryption invalidates late
permission grants. A denied camera/screen prompt leaves room audio running.

Each source is acquired once locally and cloned for the connected peers. Every
edge uses its existing pair key and separately bound camera/screen transform
slots, with independent encryption counters. No new SDP negotiation, media key
export, microphone capture or source per receiver is needed. Sender clones have
their own lifecycle; stopping an edge never makes it own another edge's source.
Camera defaults to 720p/15 fps and screen video to 1080p/10 fps as capture hints,
not measured quality or bandwidth guarantees.

The room shows labeled camera and screen tiles. Local camera/screen state is
carried in encrypted `room-heartbeat` controls: an eight-digit positive counter,
a colon and two binary camera/screen flags. Counters are scoped to the current
mesh key context. Receivers reject malformed or conflicting controls and ignore
older counters. An audio-only null heartbeat cannot restore or erase a newer
versioned state. Video tiles appear only with the authenticated sender's active
flag and the correct negotiated track slot. Stop controls hide a tile even if
the platform retains the last decoded frame on an inactive receiver.

Ordinary camera/screen stop immediately stops the original and every sender
clone, without waiting for network delivery. Browser **Stop sharing** does the
same. Both video sources also stop when room membership changes, before the
new mesh starts. Continuing audio sources and mute state are preserved. The
interface explains that participants must explicitly start video again for the
new audience. Rejoining never automatically restores either source.

The host still sees public occupancy and transport metadata. Camera/screen flags
and counters remain inside MLS ciphertext; no new public presence fields or
database tables are added. The server has no media decryption keys. Clients
cannot prevent selected endpoints from recording or disclosing received media.

## Local validation and remaining gates

`node scripts/verify-direct-calls.mjs --room-video` extends the existing real
account/admission/MLS fixture. `--turn`, `--turn-tcp`, `--desktop` and
`--room-revoke` select isolated local route/runtime and permission scenarios.
Generated canvas video and oscillator audio replace physical devices; the
production room interface drives consent and stop actions.

The fixture exercises two cameras and two simultaneous shares in a four-person
room: twelve directed video streams in addition to twelve audio streams. It
checks distinct decoded pixel colors for camera/screen identity, authenticated
remote state, source counts, encryption rejection counters, independent stop,
membership-change teardown, fresh consent on rejoin and signed permission loss.
Local fixtures do not establish real display picker behavior, physical camera
quality, multi-computer/NAT/firewall reachability, performance limits or macOS/
Linux support. TURN-TLS, SFU integration, seamless video through membership
changes, track-specific permissions and shared computer audio remain open.

The [local checkpoint](evidence/phase4-room-video-local-2026-10-22.json) records
the final format-4 source hashes, route reports, regressions and preliminary
attempts. Each room run validates twelve audio directions and twelve distinct
camera/screen video paths, from two cameras and two simultaneous shares. All
twelve owned video clones stop on membership or permission transitions. Final
room runs have no HTTP 429 responses; production request limits are unchanged.

| Completed local scenario | Outcomes |
| --- | ---: |
| Chrome direct, membership changes and explicit rejoin | 26 |
| Chrome relay-only through loopback TURN/UDP, signed permission revocation | 23 |
| Isolated Windows WebView2 through loopback TURN/TCP, including native cleanup | 28 |

The total is 77 room outcomes. Relay-only media metrics select relays with zero
host candidates, including after video starts. Native temporary credentials and
files are removed after native operations drain. This evidence does not update
the installed client or the user's existing host.

The current verification pass also includes 151 JavaScript tests, 52 default Rust
tests (five ignored), formatting/clippy, WASM/protocol checks, normal Windows
desktop compilation, a restored production build without acceptance entry points
and 45 private-call regression outcomes. Earlier audio-only room evidence remains
frozen in its original checkpoint.
