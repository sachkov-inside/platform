#!/usr/bin/env bash
set -euo pipefail

for variable_name in \
  LOGTO_DATABASE_OWNER_PASSWORD \
  PLATFORM_DATABASE_OWNER_PASSWORD \
  PLATFORM_DATABASE_RUNTIME_PASSWORD; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "$variable_name is required" >&2
    exit 1
  fi
done

psql \
  --set=ON_ERROR_STOP=1 \
  --set=logto_owner_password="$LOGTO_DATABASE_OWNER_PASSWORD" \
  --set=platform_owner_password="$PLATFORM_DATABASE_OWNER_PASSWORD" \
  --set=platform_runtime_password="$PLATFORM_DATABASE_RUNTIME_PASSWORD" \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" <<'SQL'
SELECT format('CREATE ROLE platform_owner LOGIN PASSWORD %L', :'platform_owner_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'platform_owner')
\gexec
SELECT format('CREATE ROLE platform_runtime LOGIN PASSWORD %L', :'platform_runtime_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'platform_runtime')
\gexec
SELECT format('CREATE ROLE logto_owner LOGIN CREATEROLE PASSWORD %L', :'logto_owner_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'logto_owner')
\gexec

SELECT 'CREATE DATABASE inside OWNER platform_owner'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'inside')
\gexec
SELECT 'CREATE DATABASE logto OWNER logto_owner'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'logto')
\gexec

GRANT CONNECT ON DATABASE inside TO platform_runtime;

ALTER SYSTEM SET archive_mode = 'on';
ALTER SYSTEM SET archive_command = 'pgbackrest --stanza=production archive-push %p';
ALTER SYSTEM SET archive_timeout = '60s';
ALTER SYSTEM SET password_encryption = 'scram-sha-256';
SQL
