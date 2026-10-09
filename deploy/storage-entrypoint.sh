#!/bin/sh
set -eu
# Keep the host configuration private/read-only; the image drops to seaweed.
mkdir -p /run/hearth
chmod 755 /run/hearth
cp /etc/hearth/s3.json /run/hearth/s3.json
chown seaweed:seaweed /run/hearth/s3.json
chmod 600 /run/hearth/s3.json
exec /entrypoint.sh "$@"
