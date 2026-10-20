#!/usr/bin/env bash
set -euo pipefail

for variable_name in \
  LOGTO_DATABASE_PASSWORD \
  PLATFORM_DATABASE_PASSWORD; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "$variable_name is required" >&2
    exit 1
  fi
done

psql \
  --set=ON_ERROR_STOP=1 \
  --set=logto_owner_password="$LOGTO_DATABASE_PASSWORD" \
  --set=platform_password="$PLATFORM_DATABASE_PASSWORD" \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" <<'SQL'
SELECT format('CREATE ROLE platform LOGIN PASSWORD %L', :'platform_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'platform')
\gexec
SELECT format('CREATE ROLE logto_owner LOGIN CREATEROLE PASSWORD %L', :'logto_owner_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'logto_owner')
\gexec

SELECT 'CREATE DATABASE inside OWNER platform'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'inside')
\gexec
SELECT 'CREATE DATABASE logto OWNER logto_owner'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'logto')
\gexec

ALTER SYSTEM SET archive_mode = 'on';
ALTER SYSTEM SET archive_command = 'pgbackrest --stanza=production archive-push %p';
ALTER SYSTEM SET archive_timeout = '60s';
ALTER SYSTEM SET password_encryption = 'scram-sha-256';
SQL
