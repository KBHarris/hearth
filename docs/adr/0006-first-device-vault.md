# ADR 0006: First-device enrollment and encrypted local identity vault

Status: accepted for the Phase 1 prototype, 2026-10-07.

## Decision

Create a random Ed25519 account identity, a distinct device key and a random 32-byte
reserved local storage key inside the authentication WASM worker. The account identity
certifies the device. Both keys sign a domain-separated enrollment containing the account
ID, advertised server signing key and device public key. Strict Ed25519 verification
rejects weak public keys. The authenticated server accepts only public keys and signatures.

`GET /api/v1/auth/identity` returns the account's public identity and first-device roster.
`POST /api/v1/auth/device/first` locks the account row and atomically binds that identity
and device. An exact retry is idempotent; another identity or another device returns 409,
even with a valid password session. This initial milestone permitted one device;
[ADR 0007](0007-recovery-and-registration.md) adds separately authorized restore/linking.
Roster reads use one repeatable-read
snapshot. Clients compare all enrollment fields with their saved identity before using it.

Keep the 64-byte OPAQUE export key within WASM after successful login. HKDF-SHA-512 derives
a 32-byte wrapping key with the versioned account/server scope as salt and
`hearth/v1/local-identity-vault` as info. XChaCha20-Poly1305 encrypts a 96-byte payload
(account seed, device seed, reserved store key), with a fresh random 24-byte nonce.
Associated data is the context, one-byte version 1, account ID and server signing key.
The envelope is version + nonce + authenticated ciphertext: 137 bytes, encoded as 274
lowercase hex characters. No private key or export key is returned to JavaScript.
Malformed, tampered, wrong-account, wrong-server or wrong-key envelopes fail closed.
After accepted enrollment, discard the wrapping material and retain the unlocked identity
only for the worker's lifetime. Sign-out, expiry and client teardown terminate that worker.

Browser storage uses IndexedDB `hearth-identity-v1`, store `vaults`, keyed by
`<server public key>:<account ID>`. An atomic read/write transaction preserves an existing
envelope. Desktop storage uses pinned `keyring` 3.6.3 with Windows Credential Manager,
macOS Keychain or Linux Secret Service. It stores the already encrypted envelope, with
no file fallback. A non-secret filesystem lock serializes desktop app processes.
Only the bundled main window, or the fixed debug Vite origin, can invoke storage commands.
See the [keyring platform documentation](https://docs.rs/crate/keyring/3.6.3/source/README.md)
(checked 2026-10-07). Linux users need an unlocked Secret Service.

Persist before enrolling. A creator losing a local storage race opens the winner's saved
envelope using its still-retained export key. An interrupted server enrollment can retry
the same saved proof. Existing envelopes are never replaced, including damaged data.
An authenticated install with no local vault and an already-bound remote identity remains
unlinked; it must not create replacement keys. Storage cancellation/deadlines bound the UI;
an OS write may finish later, but the canceled flow submits no subsequent enrollment.

## Validation

Native crypto checks exercise wrapping, fresh nonces, tampering, wrong keys and scopes,
weak keys, certificates and forged enrollment proofs. PostgreSQL acceptance exercises
authentication, account/server binding, competing initial claims, idempotent retry,
replacement and additional-device rejection, and revoked sessions. Product WASM/native
HTTP acceptance restores the same identity after a fresh login and server restart and
confirms that no vault ciphertext or password is sent to the server. The dated report is
identity-vault-wasm-native-2026-10-07.json (historical report in Git history).

Local Chromium UI checks observed first enrollment, identical fingerprints after sign-out
and sign-in, and an unlinked fresh browser origin. The final screenshot and post-reload
sign-in check were blocked when browser access changed. Windows native OS-store acceptance
exercises create/read, a new process reading the same entry, preservation against alternate
writes, damaged-entry preservation and cleanup; see the
Windows report (historical report in Git history). This CLI check is not packaged webview
authentication proof. macOS store acceptance runs in CI; Linux store runtime and packaged
authentication remain separate validation gates. Build success alone does not close them.

## Limits and next steps

This ADR specifies identity storage. Subsequent work adds recovery, linking and member
registration in ADR 0007 and integrates the reserved store key with encrypted MLS state.
SQLCipher and complete messaging acceptance remain phase gates. Password change and device
revocation are not implemented. Clearing browser data or deleting the OS credential loses
this installation; the password alone cannot recreate it. Do not silently reset keys.

The first device trusts successful password authentication and the pinned server's initial
identity. A compromised client can steal unlocked keys; a malicious first server is not
authenticated by first-use pinning. Signed rosters prevent simple substitution against
saved keys, but key transparency, recipient identity verification and a security audit
remain future work. The full Phase 1 encrypted-DM exit criteria are still open.
