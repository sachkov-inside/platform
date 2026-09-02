#!/usr/bin/env bash
set -euo pipefail

if [[ "${PGDATA:-}" != "/var/lib/postgresql/18/docker" ]]; then
  echo "Refusing restore outside the pinned PostgreSQL data path" >&2
  exit 64
fi

install -d -m 700 -o postgres -g postgres "$PGDATA"
find "$PGDATA" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
exec gosu postgres pgbackrest "$@"
