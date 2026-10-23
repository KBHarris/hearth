#!/bin/sh
# Private certificate reload without Docker control or copying TLS keys to logs.
set -eu
case "${HEARTH_TURN_CERT_HOST:-}" in ''|*[!a-zA-Z0-9.-]*|.*|*..*) exit 64;; esac
directory="/var/lib/hearth-certificates/caddy/certificates/acme-v02.api.letsencrypt.org-directory/$HEARTH_TURN_CERT_HOST"
certificate="$directory/$HEARTH_TURN_CERT_HOST.crt"
key="$directory/$HEARTH_TURN_CERT_HOST.key"
child=''
stop() { if [ -n "$child" ]; then kill -TERM "$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true; fi; exit 0; }
trap stop TERM INT
while :; do
  # No TLS downgrade while certificate issuance is incomplete.
  while [ ! -s "$certificate" ] || [ ! -s "$key" ]; do sleep 5 & child=$!; wait "$child" || true; child=''; done
  stamp=$(sha256sum "$certificate" "$key" | sha256sum)
  turnserver -c /etc/hearth/turnserver.conf & child=$!
  while kill -0 "$child" 2>/dev/null; do
    sleep 30 & timer=$!; wait "$timer" || true
    current=$(sha256sum "$certificate" "$key" 2>/dev/null | sha256sum)
    if [ "$stamp" != "$current" ]; then kill -TERM "$child" 2>/dev/null || true; break; fi
  done
  wait "$child" 2>/dev/null || true; child=''
  sleep 5 & child=$!; wait "$child" || true; child=''
done
