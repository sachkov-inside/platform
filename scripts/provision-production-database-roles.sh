#!/bin/sh
set -eu

mode="${1:-}"
export PGPASSWORD="$POSTGRES_PASSWORD"

case "$mode" in
  migration)
    if [ "$POSTGRES_USER" = "$MIGRATION_DATABASE_USER" ]; then
      echo "Bootstrap and migration database roles must be different" >&2
      exit 1
    fi

    psql \
      --host "$POSTGRES_HOST" \
      --username "$POSTGRES_USER" \
      --dbname "$POSTGRES_DB" \
      --set ON_ERROR_STOP=1 \
      --set migration_user="$MIGRATION_DATABASE_USER" \
      --set migration_password="$MIGRATION_DATABASE_PASSWORD" <<'SQL'
select format(
  'create role %I login password %L nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls',
  :'migration_user',
  :'migration_password'
)
where not exists (
  select from pg_roles where rolname = :'migration_user'
) \gexec

select format(
  'alter role %I with login password %L nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls',
  :'migration_user',
  :'migration_password'
) \gexec

select format(
  'grant connect, create on database %I to %I',
  current_database(),
  :'migration_user'
) \gexec

select format(
  'grant usage, create on schema public to %I',
  :'migration_user'
) \gexec
SQL
    ;;
  application)
    if [ "$POSTGRES_USER" = "$APPLICATION_DATABASE_USER" ] || \
      [ "$MIGRATION_DATABASE_USER" = "$APPLICATION_DATABASE_USER" ]; then
      echo "Bootstrap, migration and application database roles must be different" >&2
      exit 1
    fi

    psql \
      --host "$POSTGRES_HOST" \
      --username "$POSTGRES_USER" \
      --dbname "$POSTGRES_DB" \
      --set ON_ERROR_STOP=1 \
      --set application_user="$APPLICATION_DATABASE_USER" \
      --set application_password="$APPLICATION_DATABASE_PASSWORD" \
      --set migration_user="$MIGRATION_DATABASE_USER" <<'SQL'
select format(
  'create role %I login password %L nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls',
  :'application_user',
  :'application_password'
)
where not exists (
  select from pg_roles where rolname = :'application_user'
) \gexec

select format(
  'alter role %I with login password %L nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls',
  :'application_user',
  :'application_password'
) \gexec

select format(
  'grant connect on database %I to %I',
  current_database(),
  :'application_user'
) \gexec

select format(
  'grant usage on schema %I to %I',
  nspname,
  :'application_user'
)
from pg_namespace
where nspname !~ '^pg_'
  and nspname not in ('information_schema', 'public') \gexec

select format(
  'grant select, insert, update, delete on all tables in schema %I to %I',
  nspname,
  :'application_user'
)
from pg_namespace
where nspname !~ '^pg_'
  and nspname not in ('information_schema', 'public') \gexec

select format(
  'grant usage, select, update on all sequences in schema %I to %I',
  nspname,
  :'application_user'
)
from pg_namespace
where nspname !~ '^pg_'
  and nspname not in ('information_schema', 'public') \gexec

select format(
  'alter default privileges for role %I in schema %I grant select, insert, update, delete on tables to %I',
  :'migration_user',
  nspname,
  :'application_user'
)
from pg_namespace
where nspname !~ '^pg_'
  and nspname not in ('information_schema', 'public') \gexec

select format(
  'alter default privileges for role %I in schema %I grant usage, select, update on sequences to %I',
  :'migration_user',
  nspname,
  :'application_user'
)
from pg_namespace
where nspname !~ '^pg_'
  and nspname not in ('information_schema', 'public') \gexec
SQL
    ;;
  *)
    echo "Usage: $0 migration|application" >&2
    exit 2
    ;;
esac
