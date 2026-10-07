# Hearth

Hearth is a privacy-first, self-hostable community chat platform in early development. The
goal is end-to-end encrypted communication and federation, without ads, subscriptions, or
tracking. The application is licensed AGPLv3.

The current build connects to a server, creates its first owner account, and supports
OPAQUE sign-in and sign-out with persistent, expiring server sessions. Encrypted messaging,
device linking, recovery, media, and federation remain on the roadmap.

- **What we're building and why:** [PLAN.md](PLAN.md)
- **Phased build plan:** [docs/ROADMAP.md](docs/ROADMAP.md). **Phase 1 is in progress**; Phase 0 is complete.
- **Threat model (draft):** [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)
- **Implementation and verification notes:** [docs/PROGRESS.md](docs/PROGRESS.md)

## Repository layout

```
crates/
  hearth-proto/        versioned wire types (REST, gateway, federation, bots)
  hearth-crypto/       identity keys + product OPAQUE + opt-in MLS/OPAQUE spikes
  hearth-client-core/  I/O-free client logic, shared by native and WASM
  hearth-wasm/         wasm-bindgen bindings for the web client
  hearth-server/       axum server: REST, WebSocket gateway, Postgres, migrations
apps/
  client/              React + TypeScript UI (the web build and the desktop UI)
  desktop/src-tauri/   Tauri 2 shell around apps/client
spikes/
  media/               isolated synthetic LiveKit E2EE harness; excluded from product UI
packages/
  sdk/                 @hearth/sdk: TypeScript protocol types + client
deploy/
  compose.yaml         self-host stack: server + Postgres + SeaweedFS (S3)
docs/                  roadmap, threat model, ADRs
```

## Prerequisites

- Node.js 22+
- Rust 1.91+ (stable, installed via [rustup](https://rustup.rs)). `rust-toolchain.toml` selects the
  components and the `wasm32` target.
- Docker or Podman, for Postgres and the self-host stack.
- Desktop builds need the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)
  (WebView2 on Windows, Xcode CLT on macOS, and `libwebkit2gtk-4.1-dev` et al. on Linux).

## Quick start

```bash
npm install
npm run spike:tools # installs the wasm-bindgen CLI version matching Cargo.lock
npm run setup
npm run dev
```

Open http://localhost:5173. The client proxies `/health`, `/api`, and `/gateway` to
the server on :8080.

`npm run setup` creates a random database password on first run, preserves existing
configuration, starts Compose, and checks health. An unsafe placeholder password fails
without overwriting the file. The default published address is loopback; public hosting
needs explicit `HEARTH_HOST` configuration and TLS. Use `npm run setup -- --init-only` to
generate configuration without starting services, or `--podman` with a Compose v2 provider.
Retrieve the owner setup code with `npm run setup -- --show-setup-code` (add `--podman`
for Podman). Connect the client to the server, enter that code, and create the owner.
Registration closes after the first successful claim. A native server operator can use
`cargo run -p hearth-server -- --setup-code` with the same environment as the running server.
The code is a secret; it is never exposed by discovery or ordinary server logs.

For a hosted web client, set `HEARTH_CLIENT_ORIGINS` to its exact HTTPS origin(s), separated
by commas, then restart the server. Authenticated routes allow only those origins. Default
origins cover local Vite and Tauri clients. Native servers also bind to loopback by default.
Public hosting requires TLS; this build is an early prototype without a security audit.

Back up PostgreSQL together with the matching server data directory (`server.key`,
`opaque.setup`, and `setup.code`). Losing the OPAQUE setup or signing key prevents existing
accounts from signing in; startup refuses to generate replacements for an existing account
database. Secret files use owner-only permissions on Unix; protect the directory ACL on Windows.

The connection screen accepts a server origin such as `https://chat.example.org`. Addresses
without a scheme default to HTTPS; localhost, `127.0.0.1`, and `[::1]` support HTTP for
development. Only the last successfully checked address is saved in browser local storage,
and **Forget address** removes it. A failed check never overwrites it. Public discovery
requests omit credentials and time out after eight seconds per request. Authentication pins
the advertised signing key per origin on first use and refuses subsequent changes. Verify
the initial key with the operator when needed; first-use pinning cannot authenticate a
compromised first connection. Clearing site data removes these pins.

Passwords are processed in a WASM worker and are never sent to the server. Session tokens
stay in client memory, while the server stores only their hashes. Reloading or switching
servers requires sign-in again; server sessions expire after 24 hours and Sign out revokes
the current session. Account/device recovery and password changes are not implemented yet.

For a different local backend, set `HEARTH_DEV_SERVER` before starting Vite. Packaged desktop
builds default to `http://localhost:8080`; set `VITE_HEARTH_SERVER_URL` at build time to change
that default, or choose an address in the app.

Useful commands:

| Command | What it does |
|---|---|
| `npm run verify` | TS typecheck + lint + SDK discovery/auth tests + client/WASM build |
| `cargo fmt --all --check && cargo clippy --all-targets -- -D warnings && cargo test` | Rust checks |
| `cargo check -p hearth-wasm --target wasm32-unknown-unknown` | WASM build of the client core |
| `npm run desktop:dev` | Run the Tauri desktop app against the Vite dev server |
| `cargo run -p hearth-server` | Run the server natively (needs `DATABASE_URL`) |
| `npm run protocol:generate` / `npm run protocol:check` | Generate Rust wire types into the SDK / reject drift |
| `node scripts/verify-auth.mjs` | Disposable PostgreSQL + real HTTP/WASM owner, session and adversarial checks |
| `npm run spike:compose -- --desktop` | Fresh disposable Compose server, restart-key check, and real desktop webview discovery/media/MLS |

## Phase 0 crypto experiments

The optional MLS experiment creates fresh in-memory groups and tests joining, messages,
tampering, replay, exporter agreement, and removal. It does not create accounts or persist
keys. See [ADR 0002](docs/adr/0002-mls-feasibility.md) for results and remaining gates.

```bash
npm run spike:tools # installs the wasm-bindgen CLI version matching Cargo.lock
npm run spike:mls:wasm
npm run spike:mls:browser # opens a loopback test server; visit the printed URL
cargo build -p hearth-desktop --features mls-spike
node scripts/verify-desktop-mls.mjs
```

Normal client and server builds do not enable this experiment. CI exercises the native
scenario, Node WebAssembly, and the headless desktop executable on its OS matrix. Browser
WebAssembly is also checked locally. Native MLS invoked through Windows and Linux webview
IPC passes, as does native macOS WKWebView IPC.

Run `npm run spike:opaque:wasm` after installing the same tools to test OPAQUE registration
and login between a WASM client and a separate native Rust process. It checks Argon2
stretching, session/export-key agreement, server-key consistency, wrong passwords, dummy
responses for unknown users, tampering, and replay. It uses a fixed test password and
in-memory state only; it does not expose a login API or save accounts. See
[ADR 0003](docs/adr/0003-opaque-feasibility.md) for the remaining product requirements.

For the media experiment, run `npm run spike:media` with Docker available, then open
`http://127.0.0.1:5174` and press **Run encrypted media check**. It starts an isolated
LiveKit fixture on loopback ports 17880–17882, creates short-lived test tokens, and sends
generated video/audio between receivers with matching, wrong, and stale encryption keys. No
camera, microphone, or screen permission is requested. In an interactive terminal, type
`stop` and press Enter to stop the fixture and remove its temporary configuration. Ctrl+C
also requests cleanup; hosts that forcibly terminate the process may require stopping the
printed test container manually. `npm run spike:media:build` verifies the separate harness
bundle. This experiment is not part of the application build. Windows in-app Chromium
passes locally; [ADR 0004](docs/adr/0004-media-feasibility.md) records the evidence and
remaining production integration gates.

To test inside Tauri's system webview, first build the separate media bundle, then run
`cargo build -p hearth-desktop --features phase0-spike` and `npm run spike:desktop:webview`.
The opt-in mode loads bundled diagnostic code in a hidden window, runs native MLS through
IPC, and returns a measured report. It does not enable diagnostic commands in the product.
Set `LIVEKIT_BINARY` to a verified local SFU executable to avoid Docker; the helper
`node scripts/install-livekit-spike.mjs` downloads and checksums the pinned official release
on Windows/Linux. CI builds the same tagged source on macOS. Runtime reports go to ignored
`target/phase0-evidence`; successful and capability-blocked reports are kept separately.

The hosted matrix also exercises actual Chrome, Firefox, and Safari through Selenium.
Windows WebView2 has passed locally and in CI, including native MLS IPC. Hosted Chrome, Firefox and Safari,
Docker Compose, Podman, and the Linux desktop build/MLS IPC pass. The tested Linux WebKitGTK
blocks encrypted media because the required APIs are absent; use a supported browser.
Native WKWebView media passes. The synthetic Windows CI profile explicitly permits
loopback candidates; native reports record the requested test policies. Real device
permissions, default networking and production media key distribution are later gates.

## Security

Please report vulnerabilities privately. See [SECURITY.md](SECURITY.md).

## License

Hearth is split-licensed (see [ADR 0001](docs/adr/0001-license-split.md)):

- The server, the clients, and `hearth-client-core` are licensed under
  [AGPL-3.0-only](LICENSE).
- `hearth-proto`, `hearth-crypto`, and `@hearth/sdk` are licensed under your choice of
  [Apache-2.0](LICENSE-APACHE) or [MIT](LICENSE-MIT), so you can build bots and
  alternative clients under any license.
