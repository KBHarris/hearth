# Build from the repository root:  docker build -f crates/hearth-server/Dockerfile .
FROM rust:1-bookworm AS build
WORKDIR /src
COPY . .
RUN cargo build --release -p hearth-server

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --home /var/lib/hearth hearth \
 && mkdir -p /var/lib/hearth && chown hearth /var/lib/hearth
COPY --from=build /src/target/release/hearth-server /usr/local/bin/hearth-server
USER hearth
WORKDIR /var/lib/hearth
ENV HEARTH_BIND=0.0.0.0:8080 \
    HEARTH_SERVER_KEY_PATH=/var/lib/hearth/server.key
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD curl -fsS http://localhost:8080/health || exit 1
ENTRYPOINT ["hearth-server"]
