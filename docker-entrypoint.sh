#!/bin/sh
# Runs as root just long enough to give the "node" user the data folder; server.js then switches
# to that user (COFFER_RUN_AS) before it loads anything.
set -e

if [ "$(id -u)" = 0 ]; then
	# Bind-mounted folders arrive owned by whoever created them on the host.
	dir="${COFFER_DATA_DIR:-/data}"
	mkdir -p "$dir"
	[ "$(stat -c %u "$dir")" = 1000 ] || chown 1000:1000 "$dir"
	chmod 700 "$dir" 2>/dev/null || true
fi

exec "$@"
