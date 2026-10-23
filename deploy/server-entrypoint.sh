#!/bin/sh
set -eu
umask 077

# A newly mounted Railway volume is root-owned. Adjust only the dedicated data
# directory and known identity files, then drop privileges before Rust starts.
if [ "$(id -u)" = 0 ]; then
    [ ! -L /var/lib/hearth ] || { echo 'Server data directory must not be a symlink' >&2; exit 1; }
    mkdir -p /var/lib/hearth
    chmod 700 /var/lib/hearth
    chown hearth:hearth /var/lib/hearth
    for name in server.key opaque.setup setup.code; do
        file="/var/lib/hearth/$name"
        [ ! -L "$file" ] || { echo 'Server identity file must not be a symlink' >&2; exit 1; }
        if [ -f "$file" ]; then
            chown hearth:hearth "$file"
            chmod 600 "$file"
        fi
    done
    exec setpriv --reuid=hearth --regid=hearth --init-groups hearth-server "$@"
fi
exec hearth-server "$@"
