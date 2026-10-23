# Computer audio while sharing

The development 1:1, private-group and community-room panels offer an explicit **Include
computer or tab audio when sharing** option. It is off by default and applies
to the next screen-share picker. The operating system/browser still controls
which sources and audio options are offered. A selected source may return video
without audio; Hearth reports that result instead of silently opening another
capture device. This feature has not been released in the installed Preview.

Microphone, camera, screen video and shared audio are independent encrypted
sources. Muting the microphone leaves explicitly shared computer audio running.
Stopping screen sharing stops its audio as well and preserves camera/voice.
Screen audio receives no microphone echo cancellation, noise suppression or
automatic gain. Hearth requests exclusion of its own audio as a browser hint;
support depends on the capture implementation. Choose a tab or specific audio
source when offered to avoid including unrelated application sound or call
playback.

Direct calls and four-person mesh rooms use a fourth authenticated frame-key
slot for shared audio. SFU rooms publish an encrypted screen-audio source once
and route it independently of the microphone. Private three-person ringing
calls now use the same four source slots. Control format 5 is required
before the expanded source layout can publish.

The browser picker remains necessary for every new share. Platform and browser
support differs, and audio-selection constraints are hints rather than a promise
of per-window capture. See the [screen-capture specification](https://w3c.github.io/mediacapture-screen-share/)
and [LiveKit screen-sharing guidance](https://docs.livekit.io/transport/media/screenshare/).
Windows WebView2's window-specific audio request remains an open platform issue:
[Microsoft issue 4327](https://github.com/MicrosoftEdge/WebView2Feedback/issues/4327)
(checked 2026-10-22). Whole-system audio and tab audio must be tested separately
from per-window audio, with the actual picker on each supported platform.

Local acceptance injects synthetic audio into the production controllers to
verify encryption, decoded audio, source isolation, mute, rekey and cleanup.
The 2026-10-23 private-group fixture includes camera/screen/computer audio,
microphone switching and a real linked-device MLS epoch change. Windows native
direct-call acceptance also exercises generated sources and relay-only routing.
It does not validate physical system-audio permissions, platform loopback
capture, echo behavior, installed-client behavior or all supported desktops.
