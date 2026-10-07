# ADR 0003: OPAQUE feasibility across WASM and Rust

- Status: provisional; local WASM-client/native-server scenario passes
- Date: 2026-10-07

## Context

Phase 0 requires registration and login with the client in WASM and the server in Rust.
Password authentication must not turn into sending a password to the home server. The
experiment must exercise a real cryptographic runtime rather than only compile bindings.

## Decision

Continue with stable `opaque-ke` 4.0.1 behind an optional `opaque-spike` feature. Use
Ristretto255, TripleDH, SHA-512, and Argon2. The spike uses the library's default Argon2id
profile (19 MiB, two iterations, one lane). This is an experiment configuration; the product
profile needs versioning and measurements on supported devices before selection.

Keep the cryptographic flows in the permissive crypto crate. The WASM client owns its
opaque state and exports serialized protocol messages. A separate native Rust executable
owns ephemeral server setup, the password file, and one-use login state. It communicates
over local stdin/stdout only, accepts no password field, and exposes no network endpoints.
Neither normal builds nor the UI enable these test entrypoints.

## Recorded evidence

`npm run spike:opaque:wasm` passed on Windows with Node WebAssembly and a separate Rust
process. The complete adversarial scenario took about 3.6 seconds in this debug build;
this is not a production latency benchmark. Native unit tests also passed.

Checks cover:

- Serialized registration and successful login, matching session-key comparison tags,
  stable client export key, and consistency with the server key received at registration.
- Different session keys on fresh logins.
- Rejection of wrong passwords and dummy responses for unknown users.
- Rejection of a modified server response and a forged client finalization.
- One-use client/server state, replay rejection, and a successful fresh login after failure.
- Absence of the fixed password canary in protocol bytes and the server's serialized
  password file. The test report contains only outcomes and elapsed time.

The comparison tag is a domain-separated test hash, not a product session/channel-binding
design. It is exchanged only between local test processes and is not printed in reports.
The password file is checked inside Rust and never exported by the test process.

## Remaining product requirements

- Use TLS for authentication transport and treat registration uploads/password files as
  sensitive. OPAQUE is not permission to serve production authentication over plaintext HTTP.
- Persist and protect the server setup secret and records; define backup/restore, rotation,
  and credential migration behavior.
- Bind identifiers and protocol context to the actual account and server. Registration
  authorization, duplicate usernames, session expiry, rate limits, and atomic consumption
  of login state are outside this fixed-user, single-attempt experiment.
- Enforce and persist server-key consistency through an explicit trust and recovery model.
  The spike only proves agreement with the key from its own registration.
- Define session issuance/channel binding and key derivation separately from OPAQUE's
  export key. A matching test tag does not implement application sessions.
- Run client cryptography in a worker and benchmark production release builds in supported
  browsers and desktop webviews. Current evidence uses Node's WASM runtime.
- Review JS/WASM password-buffer lifetime and secure storage. Cached export-key bytes are
  zeroized in Rust, but this does not prove that all runtime copies are erased.
- Review end-to-end account security before exposing public registration or login.

## Reproduction and references

Run `npm run spike:tools` once, then `npm run spike:opaque:wasm`. The script builds the
optional native process and WASM client, drives the checks, and stops the child process.
No test records survive process exit. CI includes this check and the native unit scenario;
hosted CI results remain unconfirmed.

Primary API reference checked on 2026-10-07:
[opaque-ke 4.0.1](https://docs.rs/opaque-ke/4.0.1/opaque_ke/).
