# Hearth: notes for Claude

Privacy-first federated Discord alternative. Read [PLAN.md](PLAN.md) for the architecture and
[docs/ROADMAP.md](docs/ROADMAP.md) for the current phase before starting work.

## Fast verify

Run both of these before reporting work as done:

```bash
npm run verify
cargo fmt --all --check && cargo clippy --all-targets -- -D warnings && cargo test
```

This Windows machine has **no local Rust toolchain**. Run the cargo commands in Docker:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/src" -v hearth-cargo:/usr/local/cargo/registry -v hearth-target:/target -v hearth-rustup:/usr/local/rustup -e CARGO_TARGET_DIR=/target -w /src rust:1-bookworm bash -c "cargo fmt --all --check && cargo clippy --all-targets -- -D warnings && cargo test"
```

Also run `cargo check -p hearth-wasm --target wasm32-unknown-unknown` after changes to
`hearth-proto`, `hearth-crypto`, or `hearth-client-core`.

## Invariants (do not break)

- **The server never handles plaintext content.** Nothing in `hearth-server` may parse,
  log, or store message, attachment, or media content. Any new server-side field needs an
  entry in the threat model's metadata inventory.
- `hearth-client-core` has **no I/O and no platform deps**, so it stays compilable to
  `wasm32`.
- Wire types live in `hearth-proto`. `packages/sdk/src/protocol.ts` mirrors them by hand
  until codegen lands, so change both together.
- Add new SQL as new migration files in `crates/hearth-server/migrations/` and never edit
  a migration that has already been committed.
- **License boundary (ADR 0001):** `hearth-proto`, `hearth-crypto`, and `packages/sdk` are
  Apache-2.0 OR MIT and must never depend on an AGPL crate or package. Reusable protocol and
  crypto logic goes in those crates; application logic goes in `hearth-client-core`.
- Signatures always use a domain-separation context string (see `DEVICE_CERT_CONTEXT`).
- The desktop crate (`apps/desktop/src-tauri`) is excluded from `default-members`, because
  it needs platform webview libraries. Check it with `-p hearth-desktop`.
