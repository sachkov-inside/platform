#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${INSIDE_POSTGRES_DATA_PATH:-}" || "${PGDATA:-}" != "$INSIDE_POSTGRES_DATA_PATH" ]]; then
  echo "Refusing restore outside the pinned PostgreSQL data path" >&2
  exit 64
fi

case "${INSIDE_RESTORE_VOLUME:-}" in
  inside-production-postgres-data-recovery-*) ;;
  *)
    echo "Refusing restore into a volume that is not an explicit recovery replacement" >&2
    exit 64
    ;;
esac

install -d -m 700 -o postgres -g postgres "$PGDATA"
find "$PGDATA" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
exec gosu postgres pgbackrest "$@"
