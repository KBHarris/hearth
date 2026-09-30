# ADR 0001: Split licensing between the application and its interface libraries

- Status: accepted
- Date: 2026-09-30

## Context

Hearth is AGPLv3 so that nobody can take the application closed-source or run a modified
server without sharing their changes. But bots and alternative clients have to link the
protocol types and the cryptography to take part at all. If those libraries were AGPL, every
bot and third-party client would be AGPL too, which discourages exactly the ecosystem the
public interfaces exist for.

## Decision

| Component | License |
|---|---|
| `hearth-proto`, `hearth-crypto`, `@hearth/sdk` (`packages/sdk`), and the future Rust bot SDK | Apache-2.0 OR MIT |
| `hearth-server`, `hearth-client-core`, `hearth-wasm`, `apps/client`, `apps/desktop`, and everything else | AGPL-3.0-only |

`hearth-crypto` is permissive out of necessity rather than preference: a bot must decrypt the
MLS traffic of the channels it is granted, so a permissive SDK built on an AGPL crypto crate
would not actually be permissive.

**Dependency rule:** a permissive crate or package must never depend on an AGPL one. The
Rust bot SDK (Phase 6) will be a new crate built on `hearth-proto` + `hearth-crypto`, not a
re-export of `hearth-client-core`.

## Consequences

- Third parties can build bots and clients under any license. The server and the reference
  client stay protected.
- Relicensing is cheap now, while all the code has a single author. Once outside
  contributions arrive, each one is licensed under the license of the component it touches.
  Moving code *out* of the permissive set is always possible. Moving code *into* it needs
  every contributor's agreement.
- Keeping reusable logic in `hearth-crypto` makes it permissive. Logic that should stay
  protected belongs in `hearth-client-core`.
- A CI check (cargo-deny, or a small check over `cargo metadata`) should enforce the
  dependency rule before Phase 6.
