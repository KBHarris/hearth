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

The signed local patch **0.4.1 is installed**. Five installation/preservation
checks pass, including exact installed bytes/source/version and unchanged
existing native files. [Installation evidence](evidence/windows-startup-diagnostic-0.4.1-2026-10-25.json).
It is not a new public release or a server update. Required npm checks pass: 156 client, 48 SDK and 15 deployment tests.
Native library tests pass 14 with 3 existing ignored tests; formatting passes.
Regression tests exercise real message-store IPC rejection handling through
MessagingSession startup, check that no replacement store is initialized, redact
unknown error text and preserve active/preparing-call cancellation.

## Confirmed missing-file condition and recovery patch

The user confirmed the exact 0.4.1 error after normal sign-in: the saved Windows
key exists but this profile has no matching encrypted history file. Existing
history files remain in the earlier packaged app cache. Directory listings from
Codex alone do not establish which file the normal app can use.

Local 0.4.2 adds **Recover existing history**, shown only for this exact missing-
history condition in the desktop client. The explicit action runs in the actual
signed-in client's Windows context. It looks only for the current account/server/
device's hashed store filename inside earlier packaged Preview app-data folders.
It reads the existing OS key without creating, replacing or exporting credentials.

Each candidate is locked against product writers, size/link/journal checked,
copied into an encrypted temporary snapshot, and authenticated read-only by
SQLCipher using that existing key. The schema, row revision and sealed envelope
must validate. Identical copies are deduplicated; different valid copies or any
active source stop recovery. The verified encrypted snapshot is published as a
new destination file atomically, with no overwrite. Source bytes remain unchanged;
there is no whole-profile merge. Normal messaging startup then verifies its own
identity-bound envelope and resumes the existing state.

Client verification passes 157 tests plus SDK/deployment/type/lint/build checks.
Native library verification passes 17 tests (3 existing ignored); clippy passes.
The tests cover packaged-path discovery, source preservation, wrong keys,
conflicting copies, hot journals, busy sources, identical snapshots and refusal
to overwrite. A restricted test runner initially denied hard-link publication;
the same tests pass with normal Windows filesystem permissions.

The signed local **0.4.2 recovery patch is installed** at source `b3a1101`.
All five installation/preservation checks pass, including matching native binary/
source/version and unchanged original profile/store files. The installer initially
stopped while Hearth was running; after the user closed it, installation passed.
[Installation evidence](evidence/windows-history-recovery-0.4.2-2026-10-25.json).
Actual recovery is still pending the user's normal Windows-menu launch, sign-in
and **Recover existing history** click.
No original history has been reset or overwritten. Installed 0.4.1 profiles were
backed up and verified unchanged. Railway remains paused and Spotify disabled.
