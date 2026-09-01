#!/bin/sh
set -eu

mode="${1:-}"
export PGPASSWORD="$POSTGRES_PASSWORD"
export PGCONNECT_TIMEOUT=5

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
  'grant execute on all functions in schema %I to %I',
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

select format(
  'alter default privileges for role %I in schema %I grant execute on functions to %I',
  :'migration_user',
  nspname,
  :'application_user'
)
from pg_namespace
where nspname !~ '^pg_'
  and nspname not in ('information_schema', 'public') \gexec
SQL

    migration_url_contract="$(
      PGPASSWORD='' psql \
        --dbname "$MIGRATION_DATABASE_URL" \
        --tuples-only \
        --no-align \
        --command "select concat(current_user, ':', rolsuper, ':', rolcreatedb, ':', rolcreaterole, ':', rolinherit, ':', rolreplication, ':', rolbypassrls, ':', has_database_privilege(current_user, current_database(), 'create'), ':', has_schema_privilege(current_user, 'public', 'create')) from pg_roles where rolname = current_user;"
    )"
    expected_migration_contract="$MIGRATION_DATABASE_USER:f:f:f:f:f:f:t:t"
    if [ "$migration_url_contract" != "$expected_migration_contract" ]; then
      echo "MIGRATION_DATABASE_URL does not authenticate as the restricted migration owner" >&2
      exit 1
    fi

    application_url_contract="$(
      PGPASSWORD='' psql \
        --dbname "$DATABASE_URL" \
        --tuples-only \
        --no-align \
        --command "select concat(current_user, ':', rolsuper, ':', rolcreatedb, ':', rolcreaterole, ':', rolinherit, ':', rolreplication, ':', rolbypassrls, ':', has_database_privilege(current_user, current_database(), 'create'), ':', has_schema_privilege(current_user, 'materials', 'create'), ':', has_table_privilege(current_user, 'public.platform_migrations', 'select')) from pg_roles where rolname = current_user;"
    )"
    expected_application_contract="$APPLICATION_DATABASE_USER:f:f:f:f:f:f:f:f:f"
    if [ "$application_url_contract" != "$expected_application_contract" ]; then
      echo "DATABASE_URL does not authenticate as the restricted application role" >&2
      exit 1
    fi
    ;;
  *)
    echo "Usage: $0 migration|application" >&2
    exit 2
    ;;
esac
