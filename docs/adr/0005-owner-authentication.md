# ADR 0005: First owner and product OPAQUE authentication

Status: accepted for the Phase 1 prototype, 2026-10-07.

## Decision

Start Phase 1 with a usable owner account before adding device identity and encrypted
messages. Owner registration requires a random 256-bit setup code available only through
the operator's filesystem/CLI. A PostgreSQL transaction with an advisory lock and unique
owner constraint atomically records the account and completes setup. Concurrent claims
produce one success. Public registration remains closed.

Use `opaque-ke` 4.0.1 with profile
`hearth-opaque-r255-sha512-argon2id-m19456-t2-p1-v1`: Ristretto255, TripleDH/SHA-512,
Argon2id v0x13 with 19,456 KiB, two iterations and one lane. The context is
`hearth/auth/opaque/v1`; identifiers bind the username and advertised Ed25519 public server
key. The client pins that key per origin on first authentication. Profile changes need
an explicit migration; silently changing stretching parameters would break credentials.

The React client uses a separate WASM worker. It sends only serialized protocol messages,
and retains no application password or token in browser storage. Session and export keys
from OPAQUE were discarded in this initial milestone. [ADR 0006](0006-first-device-vault.md)
now specifies short-lived export-key retention for local identity wrapping. Tokens are
independent 256-bit random bearer secrets, sent in an
Authorization header over HTTPS (HTTP only for loopback development). PostgreSQL stores
SHA-256 token hashes, with 24-hour expiry and explicit logout revocation.

Persist pending OPAQUE login state with a hashed random exchange ID and two-minute expiry.
Atomically delete it before validating the proof, including bad proofs, so two submissions
cannot both authenticate. This also permits an in-flight exchange to survive a restart.
Expired exchanges/sessions are rejected immediately; periodic cleanup removes expired
rows. No authentication bodies or secrets are logged.

Persist `opaque.setup` alongside `server.key` and `setup.code`. Create secret files with
0600 permissions on Unix and refuse permissive or malformed existing files. On Windows,
operators protect the directory ACL. If an existing account database has missing signing
or OPAQUE keys, refuse startup rather than issue incompatible replacements. Back up the
database and server data together.

## Validation

Native crypto tests cover identity/context binding and password rejection. Isolated
PostgreSQL tests cover concurrent owner/login submissions, hashed session storage, expiry,
invalid-proof consumption, revocation, unknown users, body rejection, rate limits and
restart persistence. The actual product WASM client also passes HTTP acceptance against a
native server, including missing-key startup rejection; see the
local report (historical report in Git history) and
hosted report (historical report in Git history).

Browser checks exercised owner setup, automatic sign-in, sign-out, wrong password,
fresh sign-in and reload against a disposable database. Native packaged auth runtime
remains a separate validation gate; a desktop build is not runtime proof. Hosted auth
passes for implementation commit `085fa19` in run `37682030457`.

## Limits and next steps

This prototype has process-local rate limits and exact CORS origins. Public deployment
requires TLS, protected backups and additional abuse/security review. First-use pinning
does not authenticate a compromised first connection, and a compromised web client can
steal passwords. OPAQUE records plus matching server secrets permit offline guessing;
password strength remains relevant.

Client sessions are memory-only, so reload requires another sign-in while the earlier
server token remains valid until expiry. There is no password change, recovery, session
management, second-user registration or encrypted messaging yet. First-device enrollment
and protected local vaults are implemented in ADR 0006; linking, recovery, second-account
registration and MLS delivery remain open. The full Phase 1 exit criteria remain open.
