# ADR 0002: OpenMLS feasibility and receive transactions

- Status: provisional; local Windows and WebAssembly scenario passes
- Date: 2026-10-07

## Context

Phase 0 requires group creation, membership, and encryption in native desktop and WASM
before committing to product integration. A compilation check alone cannot establish that
the runtime randomness and cryptographic provider work.

## Decision

Continue with OpenMLS 0.9 and its RustCrypto 0.6 provider behind the opt-in `mls-spike`
feature. Keep the experiment in the permissive crypto crate, with thin WASM and Tauri
entrypoints. Normal server builds do not enable it. Raise the workspace minimum Rust
version to 1.91 to satisfy the selected dependencies.

Use the X25519/AES-128-GCM/SHA-256/Ed25519 ciphersuite for this experiment. Basic credentials
label test devices only; they do not authenticate user identities. Production credentials
must be bound to Hearth's device identity and verification model.

## Recorded evidence

The same fresh in-memory scenario passed in each locally available execution path:

| Runtime | Result | Scope |
|---|---|---|
| Native Rust unit test, Windows | Pass | Actual crypto and TLS-encoded protocol messages |
| Node WebAssembly | Pass | Built WASM and matching wasm-bindgen bindings, OS-backed randomness |
| In-app Chromium browser WebAssembly | Pass | Web bindings, browser randomness, no console errors |
| Windows Tauri executable | Pass | Headless `--mls-spike` entrypoint; no webview IPC exercised |
| macOS / Linux desktop | Pending | CI build and headless execution steps added; hosted results not available |
| Windows Tauri WebView2 IPC | Pass | Bundled diagnostic UI invokes the native MLS scenario; separate media/discovery checks also pass |

Checks: two-member join from a serialized Welcome, messages in both directions, private
message framing, no plaintext canary in serialized ciphertext, rejection of modified and
replayed messages, matching exporter secrets, exporter rotation on removal, and rejection
of post-removal messages by the removed member.

## Receive-state finding

In this scenario, processing a corrupted ciphertext advanced receive ratchet state before
returning an error. Processing the original valid ciphertext afterward failed. The test
now snapshots the in-memory provider and reloads the group after rejected input, and
requires the original valid message to decrypt after that rollback.

Production receives need an atomic transaction spanning provider state and the in-memory
group, with rollback on rejected input. Copying all provider state is a feasibility test
strategy, not a product storage implementation. Validate transaction semantics for
application messages and commits before integrating the delivery service.

## Consequences and remaining gates

- This supports proceeding to product integration; it does not establish product E2EE
  readiness, security review, cross-platform webview support, or load performance.
- Implement durable encrypted storage, authenticated device credentials, KeyPackage
  lifecycle, ordered commits, crash recovery, and multi-device handling in Phase 1.
- Run the desktop OS matrix and actual webview integration tests. Browser evidence here
  covers one Chromium runtime, not Firefox or Safari.
- Keep content/key debug features disabled. The test exports only boolean results and a
  member count; keys and message content stay within the scenario.
- Domain-separate exporter uses. The spike's exporter label is test-only; media exporter
  labels and rotation policy need their own reviewed design.

## Reproduction and references

Run `npm run spike:tools`, then `npm run spike:mls:wasm`. For browser execution run
`npm run spike:mls:browser` and visit its printed loopback URL. For the desktop executable,
run `cargo build -p hearth-desktop --features mls-spike` followed by
`node scripts/verify-desktop-mls.mjs`. The browser harness stops with Ctrl+C.

Upstream API references checked on 2026-10-07:
[OpenMLS 0.9](https://docs.rs/openmls/0.9.0/openmls/),
[joining from Welcome](https://book.openmls.tech/user_manual/join_from_welcome.html), and
[processing messages](https://book.openmls.tech/user_manual/processing.html).
