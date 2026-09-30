# Hearth

Hearth is a privacy-first, self-hostable, federated community chat platform. It is end-to-end
encrypted, has no ads, subscriptions, or tracking, and is licensed AGPLv3.

- **What we're building and why:** [PLAN.md](PLAN.md)
- **Phased build plan:** [docs/ROADMAP.md](docs/ROADMAP.md). We are currently in **Phase 0**.
- **Threat model (draft):** [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)

## Repository layout

```
crates/
  hearth-proto/        versioned wire types (REST, gateway, federation, bots)
  hearth-crypto/       identity keys + device cross-signing (MLS, file crypto: later phases)
  hearth-client-core/  I/O-free client logic, shared by native and WASM
  hearth-wasm/         wasm-bindgen bindings for the web client
  hearth-server/       axum server: REST, WebSocket gateway, Postgres, migrations
apps/
  client/              React + TypeScript UI (the web build and the desktop UI)
  desktop/src-tauri/   Tauri 2 shell around apps/client
packages/
  sdk/                 @hearth/sdk: TypeScript protocol types + client
deploy/
  compose.yaml         self-host stack: server + Postgres + SeaweedFS (S3)
docs/                  roadmap, threat model, ADRs
```

## Prerequisites

- Node.js 22+
- Rust (stable, installed via [rustup](https://rustup.rs)). `rust-toolchain.toml` pins the
  components and the `wasm32` target.
- Docker or Podman, for Postgres and the self-host stack.
- Desktop builds need the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)
  (WebView2 on Windows, Xcode CLT on macOS, and `libwebkit2gtk-4.1-dev` et al. on Linux).

## Quick start

```bash
npm install
cp deploy/.env.example deploy/.env
docker compose -f deploy/compose.yaml up -d --build --wait
npm run dev
```

Open http://localhost:5173. The client proxies `/health`, `/api`, and `/gateway` to
the server on :8080.

Useful commands:

| Command | What it does |
|---|---|
| `npm run verify` | TS typecheck + lint + client build |
| `cargo fmt --all --check && cargo clippy --all-targets -- -D warnings && cargo test` | Rust checks |
| `cargo check -p hearth-wasm --target wasm32-unknown-unknown` | WASM build of the client core |
| `npm run desktop:dev` | Run the Tauri desktop app against the Vite dev server |
| `cargo run -p hearth-server` | Run the server natively (needs `DATABASE_URL`) |

## Security

Please report vulnerabilities privately. See [SECURITY.md](SECURITY.md).

## License

Hearth is split-licensed (see [ADR 0001](docs/adr/0001-license-split.md)):

- The server, the clients, and `hearth-client-core` are licensed under
  [AGPL-3.0-only](LICENSE).
- `hearth-proto`, `hearth-crypto`, and `@hearth/sdk` are licensed under your choice of
  [Apache-2.0](LICENSE-APACHE) or [MIT](LICENSE-MIT), so you can build bots and
  alternative clients under any license.
