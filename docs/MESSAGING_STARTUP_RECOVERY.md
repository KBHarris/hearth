# Windows messaging startup investigation - 2026-10-25

The user opened Preview 0.4.0 normally and signed in. Gold Team remained in the
sidebar, but encrypted messaging immediately failed before opening General.
Retry reproduced the failure. The displayed `Could not open encrypted messaging`
hid the underlying reason; an unrelated call-ended banner also appeared.

## Confirmed code defects and local patch

Native IPC storage errors are plain strings. The messaging startup catch accepts
only `Error` objects and replaced those strings with its generic fallback. The
message-store boundary now converts a fixed allowlist of storage rejections to
`Error` objects. Arbitrary IPC/OS error text is redacted, so paths, identifiers
and secret material cannot become UI error messages.

Native storage now distinguishes these existing fail-closed cases without
changing storage behavior:

- A saved key exists but this profile has no corresponding history file.
- A history file exists but this Windows context has no corresponding saved key.
- The OS credential store cannot be accessed.
- The remaining locked/damaged/conflicting store condition retains its existing
  fixed message. It is not evidence that corruption or data loss occurred.

The direct-call lock callback now leaves idle calls quiet. Active calls, including
preparation before an offer exists, still end when messaging authorization locks.

The local patch is version 0.4.1; it is not a new public release or a server
update. Required npm checks pass: 156 client, 48 SDK and 15 deployment tests.
Native library tests pass 14 with 3 existing ignored tests; formatting passes.
Regression tests exercise real message-store IPC rejection handling through
MessagingSession startup, check that no replacement store is initialized, redact
unknown error text and preserve active/preparing-call cancellation.

## Open real-use gate

The exact native failure has not yet been captured in the normal Windows client.
The new messages are diagnostic improvements, not a confirmed recovery fix.
No original key, encrypted database or user profile has been reset, copied,
merged or deleted. Existing encrypted database metadata remains present from the
command runner's view; its AppData virtualization does not establish what the
normally launched app sees. This is the same environment distinction documented
in [saved-host recovery](HOST_SIDEBAR_RECOVERY.md).

After installing the local patch, the user must open Hearth normally, sign in
and report the exact new message. Preserve the original profile/history. Do not
create fresh storage over an existing key/file mismatch or infer a safe migration
from directory listings alone. Railway stays paused and Spotify disabled.
