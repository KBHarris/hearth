#!/usr/bin/env bash
# Run under dbus-run-session; never use the user's normal Secret Service or HOME.
set -euo pipefail
test -n "${DBUS_SESSION_BUS_ADDRESS:-}"
fixture_root="$(mktemp -d "$PWD/target/hearth-secret-service.XXXXXXXX")"
case "$fixture_root" in "$PWD"/target/hearth-secret-service.*) ;; *) exit 2 ;; esac
export XDG_DATA_HOME="$fixture_root/data"
export XDG_CONFIG_HOME="$fixture_root/config"
export XDG_RUNTIME_DIR="$fixture_root/runtime"
mkdir -m 700 "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_RUNTIME_DIR"
daemon_pid=''
cleanup() {
  if test -n "$daemon_pid"; then kill "$daemon_pid" 2>/dev/null || true; wait "$daemon_pid" 2>/dev/null || true; fi
  rm -rf -- "$fixture_root"
}
trap cleanup EXIT
printf 'disposable-phase1-keyring-only\n' | gnome-keyring-daemon --foreground --unlock --components=secrets > "$fixture_root/keyring.log" 2>&1 &
daemon_pid=$!
# Wait for the private service owner rather than racing D-Bus autoactivation.
for attempt in $(seq 1 100); do
  if dbus-send --session --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus.NameHasOwner string:org.freedesktop.secrets | tail -n 1 | rg -q true; then break; fi
  kill -0 "$daemon_pid"
  sleep 0.1
done
node scripts/verify-local-vault.mjs
node scripts/verify-message-store.mjs
node scripts/verify-auth.mjs --desktop --native-postgres
