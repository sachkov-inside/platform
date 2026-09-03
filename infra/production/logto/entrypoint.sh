#!/bin/sh
set -eu

: "${LOGTO_DATABASE_PASSWORD:?LOGTO_DATABASE_PASSWORD is required}"
encoded_password="$(node -e 'process.stdout.write(encodeURIComponent(process.env.LOGTO_DATABASE_PASSWORD))')"
export DB_URL="postgres://logto_owner:${encoded_password}@postgres:5432/logto"
unset LOGTO_DATABASE_PASSWORD encoded_password
exec "$@"
