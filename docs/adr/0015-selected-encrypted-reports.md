# ADR 0015: Selected encrypted reports

Date: 2026-10-12. Status: implemented; local browser acceptance in progress.

Ordinary moderation must not give the home server access to message content. A
reporter explicitly selects text messages and a reason, previews the exact evidence,
and chooses a moderator device. No surrounding context is selected automatically.

New application messages carry an additional domain-separated Ed25519 device
signature inside MLS. It binds the server, channel, operation ID, MLS epoch,
cross-signed sender identity and typed content. Live delivery matches this proof to
the authenticated MLS credential and envelope; archived import checks the original
sender and epoch authorization. Existing messages remain readable, but unsigned
legacy messages cannot become verifiable reports.

A moderator verifies the disclosed device signature and account/device certificate.
This is a supplemental sender proof authenticated during MLS delivery. It is not
a disclosed MLS ratchet key or a claim of third-party verification of the original
MLS ciphertext. It deliberately makes selected signed content attributable to its
sender when a recipient chooses to report it; ordinary MLS ciphertext stays private.

Report encryption uses an approved moderator device's signed X25519 key, an ephemeral
sender key, HKDF-SHA256 and XChaCha20-Poly1305. The key derives from the sealed device
secret with a separate domain, so reopening the same device can decrypt its inbox.
The reporter signs the complete opaque envelope. A linked or recovered new device
does not gain the previous device's inbox keys.

The server checks authenticated membership, READ, current scoped MODERATE, approved
devices, the registered recipient key, envelope signatures and bounded quotas.
It stores only the encrypted envelope and content-free resolved flag. Report IDs,
channel, reporter, recipient, device keys, timestamps and encrypted sizes remain
visible metadata. The inbox is capped at 1,000 reports per community; each account
can submit 10 reports per day. A query returns at most 100 reports for the recipient
account and channel. Revoked moderators cannot read or resolve the queue.

Selected text edits include their signed versions in the explicit preview. Files,
attachment keys and unrelated messages are excluded. A report is at most 64 KiB,
with ten selected messages and twenty signed versions. Deleted local text and its
proofs are removed from the local report ledger. Already submitted evidence and
copies kept by recipients cannot be recalled by deleting the original message.

Local native crypto and real product-WASM/HTTP checks cover sender/content forgery,
recipient binding, altered envelopes, membership/permission denial, idempotent
submission, restart, resolution and plaintext canaries. Browser checks cover the
selection preview and moderator's verified inbox. Hosted and packaged checks remain
open until the expanded Phase 3 suite runs against the final implementation.
