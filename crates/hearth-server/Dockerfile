# Build from the repository root:  docker build -f crates/hearth-server/Dockerfile .
FROM rust:1-bookworm@sha256:e12566d5abc17a0da741628782cdb504b68b8961f5bfcf677936bf3e8b32de29 AS build
ENV RUSTUP_TOOLCHAIN=1.99.1
WORKDIR /src
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY crates/ crates/
COPY apps/desktop/src-tauri/ apps/desktop/src-tauri/
RUN cargo build --locked --release -p hearth-server

FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl util-linux \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --home /var/lib/hearth hearth \
 && mkdir -p /var/lib/hearth && chown hearth /var/lib/hearth
COPY --from=build /src/target/release/hearth-server /usr/local/bin/hearth-server
COPY deploy/server-entrypoint.sh /usr/local/bin/hearth-entrypoint
RUN chmod 755 /usr/local/bin/hearth-entrypoint
WORKDIR /var/lib/hearth
ENV HEARTH_BIND=0.0.0.0:8080 \
    HEARTH_SERVER_KEY_PATH=/var/lib/hearth/server.key
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD curl -fsS http://localhost:8080/health || exit 1
ENTRYPOINT ["/usr/local/bin/hearth-entrypoint"]
