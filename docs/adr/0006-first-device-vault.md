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
even with a valid password session. The current protocol deliberately permits one device;
approved linking needs a separate authorization flow. Roster reads use one repeatable-read
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
[identity-vault-wasm-native-2026-10-07.json](../evidence/identity-vault-wasm-native-2026-10-07.json).

Local Chromium UI checks observed first enrollment, identical fingerprints after sign-out
and sign-in, and an unlinked fresh browser origin. The final screenshot and post-reload
sign-in check were blocked when browser access changed. Windows native OS-store acceptance
exercises create/read, a new process reading the same entry, preservation against alternate
writes, damaged-entry preservation and cleanup; see the
[Windows report](../evidence/local-vault-windows-2026-10-07.json). This CLI check is not packaged webview
authentication proof. macOS store acceptance runs in CI; Linux store runtime and packaged
authentication remain separate validation gates. Build success alone does not close them.

## Limits and next steps

This stores identity material only. The reserved store key is not yet connected to
SQLCipher, message history, MLS group state or KeyPackages. There is no vault export,
password change, recovery, linking, device revocation or second-account registration.
Clearing browser data or deleting the OS credential loses this identity; the password
alone cannot recreate it. Do not silently reset keys to resolve storage failures.

The first device trusts successful password authentication and the pinned server's initial
identity. A compromised client can steal unlocked keys; a malicious first server is not
authenticated by first-use pinning. Signed rosters prevent simple substitution against
saved keys, but key transparency, recipient identity verification and a security audit
remain future work. The full Phase 1 encrypted-DM exit criteria are still open.
