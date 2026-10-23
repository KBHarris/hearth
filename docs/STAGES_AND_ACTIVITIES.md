# Stages, events and shared playback

Stage channels use the same encrypted room transport as community voice. The
default audience may connect and listen. The owner can allow a participant to
speak or move them back to the audience; permission changes replace the room's
media context. Promotion never opens a microphone: the promoted participant
chooses **Start speaking**. Connect, listen, speak, camera and screen permissions
are separate signed grants. Legacy signed policies retain their original bytes
until explicitly upgraded. A listening revocation removes that participant and
rotates the continuing room's keys.

Scheduled events and RSVPs are MLS-encrypted messages. Only the event creator
can cancel it. RSVP identity comes from the authenticated message sender, and
later responses replace that sender's earlier response. Titles, descriptions,
times and locations have bounded validation. Event details stay in encrypted
local history and never become server-visible calendar fields.

Shared playback supports canonical YouTube video and SoundCloud track URLs.
Spotify playback is disabled for this release by the user's decision on
2026-10-23; its additional SDK origin is not authorized. Existing encrypted
Spotify activity metadata remains readable, with no player connection offered.
Creation, play/pause and seeking are encrypted; the
creator controls a monotonic playback revision. Each listener separately opts
in before a provider request/player loads. Revoking consent removes that player.
Provider sign-in, availability and autoplay rules still apply. Hearth does not
collect provider account tokens or pass its own identities, messages or keys to
provider scripts. A provider can observe the listener's IP/browser/account.

The external player API executes in an opaque `data:` iframe with a sandbox and
its own CSP. Its bridge accepts only parent-origin/source-bound controls with a
per-player nonce. Provider frames cannot read Hearth's document or local storage.
The native acceptance probe separately checks that an opaque frame cannot invoke
native commands. The accepted message vocabulary contains public playback
position/control data only. Provider scripts are allowed by the document CSP
solely so the inherited policy also permits their isolated player frame.

Position updates have bounded clock-skew handling. If the host stops updating,
the local player pauses after 45 seconds. These controls do not distribute media
files, bypass a provider subscription, or establish independent SFrame
interoperability. Actual provider availability/account/autoplay and device/network
acceptance remain in [the release checklist](PHASE4_RELEASE_CHECKLIST.md).
