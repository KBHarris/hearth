# ADR 0007: Portable identity recovery, approved-device links and member registration

Date: 2026-10-07. Status: implemented; local native HTTP/PostgreSQL/product-WASM
acceptance passes. Packaged UI and platform acceptance remain Phase 1 gates.

## Decision

Recovery exports only the account's portable Ed25519 identity seed. A fixed Argon2id
profile (64 MiB, three passes, one lane) derives an XChaCha20-Poly1305 key from a
16–1024-byte passphrase. Version, account, home-server key and identity public key
are authenticated. Strict lengths and a 4096-byte input bound prevent configurable
resource costs. Restoring creates a fresh device key and local store key; it does
not copy MLS epochs or old messages. Password authentication remains required.

An approved device can transfer this same portable authority using a random 128-bit
link code. The server receives its SHA-256 identifier, an encrypted kit and a device
signature binding the identifier and ciphertext to the account and server. The
same-account authenticated recipient has three minutes to fetch and restore it.
Enrollment consumes the offer atomically; exact public-proof retries succeed.
Expired, forged, cross-account and identity-substituted requests fail closed.
Possession of the decrypted identity remains authority after relay consumption.

The owner can set a server name and select closed, invite-only or open registration.
Invite-only is the default after bootstrap. A random 256-bit invitation authorizes
one account registration for 24 hours; only its hash is stored. Advisory transaction
locks serialize settings changes and invitation consumption. New registrations
cannot set the owner flag, and all credentials use the existing OPAQUE profile.

## Storage and failure behavior

The identity envelope remains create-or-read, including recovery. Restore saves it
before requesting device enrollment. A concurrent winning envelope is reopened
rather than overwritten. Damaged or locked storage is preserved. An unlinked client
retains its OPAQUE export key inside WASM until linking/restoring completes or the
session ends. A linked client clears the wrapping material after enrollment.

## Evidence and limits

Local acceptance (historical report in Git history)
records fifteen outcomes, including actual OPAQUE second-account creation and
concurrent single-use invitation claims. PostgreSQL tests separately exercise
expired links, signature forgery and identity substitution. This does not establish
native UI behavior, Linux Secret Service runtime availability, device revocation,
old-history recovery, or completed Phase 1 messaging acceptance.
