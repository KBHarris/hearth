# Build from the repository root. No deployment secrets are build arguments.
FROM rust:1-bookworm@sha256:e12566d5abc17a0da741628782cdb504b68b8961f5bfcf677936bf3e8b32de29 AS crypto
ENV RUSTUP_TOOLCHAIN=1.99.1
WORKDIR /src
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY crates/ crates/
COPY apps/desktop/src-tauri/ apps/desktop/src-tauri/
RUN rustup target add wasm32-unknown-unknown \
 && cargo build --locked --release -p hearth-wasm --target wasm32-unknown-unknown --features auth \
 && version=$(sed -n '/^name = "wasm-bindgen"$/{n;s/^version = "\(.*\)"$/\1/p;}' Cargo.lock) \
 && test -n "$version" \
 && cargo install wasm-bindgen-cli --version "$version" --locked \
 && wasm-bindgen target/wasm32-unknown-unknown/release/hearth_wasm.wasm --target web --out-dir /wasm

FROM node:22-bookworm@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8 AS web
WORKDIR /src
COPY . .
COPY --from=crypto /wasm/ apps/client/src/crypto/generated/
RUN npm ci --ignore-scripts \
 && HEARTH_PREBUILT_WASM=1 npm run build -w @hearth/client

FROM caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f
COPY --from=web /src/apps/client/dist/ /srv/
COPY deploy/web/Caddyfile /etc/caddy/Caddyfile
ENV PORT=8080
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1:${PORT}/web-health || exit 1
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
