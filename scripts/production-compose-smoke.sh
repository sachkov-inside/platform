#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

http_port="${PRODUCTION_SMOKE_HTTP_PORT:-38080}"
https_port="${PRODUCTION_SMOKE_HTTPS_PORT:-38443}"
source_revision="$(git rev-parse HEAD)"
smoke_suffix="${source_revision:0:12}-$$"
project_name="inside-platform-production-smoke-${smoke_suffix}"

export PLATFORM_COMPOSE_PROJECT="$project_name"
export PLATFORM_DOMAIN=localhost
export PLATFORM_HTTP_PORT="$http_port"
export PLATFORM_HTTPS_PORT="$https_port"
export PLATFORM_API_IMAGE_REPOSITORY=local.invalid/inside-platform-api
export PLATFORM_API_IMAGE_DIGEST=0000000000000000000000000000000000000000000000000000000000000000
export PLATFORM_MIGRATION_IMAGE_REPOSITORY=local.invalid/inside-platform-api
export PLATFORM_MIGRATION_IMAGE_DIGEST=0000000000000000000000000000000000000000000000000000000000000000
export PLATFORM_WEB_IMAGE_REPOSITORY=local.invalid/inside-platform-web
export PLATFORM_WEB_IMAGE_DIGEST=0000000000000000000000000000000000000000000000000000000000000000
export PLATFORM_API_BUILD_IMAGE="inside-platform-api:production-smoke-${smoke_suffix}"
export PLATFORM_WEB_BUILD_IMAGE="inside-platform-web:production-smoke-${smoke_suffix}"
export SOURCE_REVISION="$source_revision"
export POSTGRES_DB=inside
export POSTGRES_USER=inside_admin
export POSTGRES_PASSWORD=inside-production-smoke-bootstrap-password
export MIGRATION_DATABASE_USER=inside_migrator
export MIGRATION_DATABASE_PASSWORD=inside-production-smoke-migration-password
export APPLICATION_DATABASE_USER=inside_app
export APPLICATION_DATABASE_PASSWORD=inside-production-smoke-application-password
export MIGRATION_DATABASE_URL=postgresql://inside_migrator:inside-production-smoke-migration-password@postgres:5432/inside
export DATABASE_URL=postgresql://inside_app:inside-production-smoke-application-password@postgres:5432/inside
export LOGTO_ISSUER=https://identity.production-smoke.invalid/oidc
export LOGTO_ENDPOINT=https://identity.production-smoke.invalid
export LOGTO_AUDIENCE=https://api.production-smoke.invalid
export LOGTO_JWKS_URL=https://identity.production-smoke.invalid/oidc/jwks
export LOGTO_APP_ID=inside-production-smoke
export LOGTO_APP_SECRET=inside-production-smoke-app-secret
export LOGTO_COOKIE_SECRET=inside-production-smoke-cookie-secret-key
export IDENTITY_EMAIL_FINGERPRINT_KEY=inside-production-smoke-email-fingerprint-key
export MEMBERSHIP_ACQUISITION_URL=https://membership.production-smoke.invalid
export TELEGRAM_BOT_START_URL=https://t.me/inside_production_smoke_bot
export TELEGRAM_LINKING_ENDPOINT=https://telegram.production-smoke.invalid/integrations/platform/v1/identity-links
export TELEGRAM_LINKING_SECRET=inside-production-smoke-linking-secret
export TELEGRAM_EVIDENCE_INGRESS_SECRET=inside-production-smoke-evidence-secret
export TELEGRAM_LINK_LIFETIME_SECONDS=300
export OBJECT_STORAGE_ENDPOINT=https://storage.production-smoke.invalid
export OBJECT_STORAGE_REGION=ru-central1
export OBJECT_STORAGE_ACCESS_KEY_ID=inside-production-smoke-storage-access-key
export OBJECT_STORAGE_SECRET_ACCESS_KEY=inside-production-smoke-storage-secret-key
export OBJECT_STORAGE_PUBLIC_BUCKET=inside-production-smoke-public
export OBJECT_STORAGE_PROTECTED_BUCKET=inside-production-smoke-protected
export OBJECT_STORAGE_QUARANTINE_BUCKET=inside-production-smoke-quarantine
export OBJECT_STORAGE_SIGNED_GET_TTL_SECONDS=60
export MATERIAL_ASSET_ORPHAN_GRACE_SECONDS=86400
export WEB_BASE_URL="https://localhost:${https_port}"

compose=(
  docker compose
  --project-name "$project_name"
  --file compose.production.yaml
  --file compose.production.build.yaml
)

cleanup() {
  local test_status=$?
  local cleanup_status=0
  trap - EXIT

  if ! "${compose[@]}" down --volumes --remove-orphans; then
    echo "Failed to remove production smoke containers or persistent data" >&2
    cleanup_status=1
  fi
  if ! docker image rm "$PLATFORM_API_BUILD_IMAGE" "$PLATFORM_WEB_BUILD_IMAGE"; then
    echo "Failed to remove production smoke image tags" >&2
    cleanup_status=1
  fi

  if ((test_status != 0)); then
    exit "$test_status"
  fi
  exit "$cleanup_status"
}
trap cleanup EXIT

"${compose[@]}" config --quiet
"${compose[@]}" build api web
"${compose[@]}" up --detach --wait

worker_container_id="$("${compose[@]}" ps --quiet material-assets-worker)"
worker_state="$(docker container inspect "$worker_container_id" --format '{{.State.Status}}:{{.RestartCount}}')"
if [[ "$worker_state" != "running:0" ]]; then
  echo "Material Asset worker did not stay running without restarts: $worker_state" >&2
  "${compose[@]}" logs material-assets-worker >&2
  exit 1
fi
if ! "${compose[@]}" logs material-assets-worker | rg --quiet '"process":"material-assets-worker","status":"ready"'; then
  echo "Material Asset worker did not report readiness" >&2
  "${compose[@]}" logs material-assets-worker >&2
  exit 1
fi

api_health="$(
  "${compose[@]}" exec -T api node -e \
    "fetch('http://127.0.0.1:3001/health').then(async r=>{process.stdout.write(await r.text());if(!r.ok)process.exit(1)}).catch(error=>{console.error(error);process.exit(1)})"
)"
if [[ "$api_health" != '{"process":"api","status":"ok","database":"reachable"}' ]]; then
  echo "Unexpected API health response: $api_health" >&2
  exit 1
fi

home_response="$(
  curl \
    --fail \
    --insecure \
    --retry 10 \
    --retry-connrefused \
    --silent \
    --show-error \
    "https://localhost:${https_port}/"
)"
if [[ "$home_response" != *"Sachkov Inside"* ]]; then
  echo "Caddy did not serve the expected Platform home response" >&2
  exit 1
fi

library_response="$(
  curl \
    --fail \
    --insecure \
    --retry 10 \
    --retry-connrefused \
    --silent \
    --show-error \
    "https://localhost:${https_port}/library"
)"
if [[ "$library_response" != *"Библиотека"* ]]; then
  echo "Caddy did not serve the expected Platform Library response" >&2
  exit 1
fi

expected_migration_count="$(
  find apps/backend/src/modules \
    -type f \
    -path '*/infrastructure/postgres/migrations/*.ts' \
    | wc -l \
    | tr -d '[:space:]'
)"
migration_count="$(
  "${compose[@]}" exec -T postgres psql \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --tuples-only \
    --no-align \
    --command "select count(*) from public.platform_migrations;"
)"
if [[ "$migration_count" != "$expected_migration_count" ]]; then
  echo "Expected $expected_migration_count applied migrations, received $migration_count" >&2
  exit 1
fi

migration_role_contract="$(
  "${compose[@]}" exec -T postgres psql \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --tuples-only \
    --no-align \
    --command "select concat(rolsuper, ':', rolcreatedb, ':', rolcreaterole, ':', rolreplication, ':', rolbypassrls) from pg_roles where rolname = '$MIGRATION_DATABASE_USER';"
)"
if [[ "$migration_role_contract" != "f:f:f:f:f" ]]; then
  echo "Migration database role exceeds its schema-owner contract: $migration_role_contract" >&2
  exit 1
fi

runtime_role_contract="$(
  "${compose[@]}" exec -T postgres psql \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --tuples-only \
    --no-align \
    --command "select concat(rolsuper, ':', rolcreatedb, ':', rolcreaterole, ':', rolreplication, ':', rolbypassrls, ':', has_schema_privilege(rolname, 'materials', 'create'), ':', has_table_privilege(rolname, 'public.platform_migrations', 'select')) from pg_roles where rolname = '$APPLICATION_DATABASE_USER';"
)"
if [[ "$runtime_role_contract" != "f:f:f:f:f:f:f" ]]; then
  echo "Application database role exceeds its runtime contract: $runtime_role_contract" >&2
  exit 1
fi

runtime_material_count="$(
  "${compose[@]}" exec -T \
    --env "PGPASSWORD=$APPLICATION_DATABASE_PASSWORD" \
    postgres psql \
      --host postgres \
      --username "$APPLICATION_DATABASE_USER" \
      --dbname "$POSTGRES_DB" \
      --tuples-only \
      --no-align \
      --command "select count(*) from materials.materials;"
)"
if [[ "$runtime_material_count" != "0" ]]; then
  echo "Application database role could not read the migrated schema" >&2
  exit 1
fi

for image in "$PLATFORM_API_BUILD_IMAGE" "$PLATFORM_WEB_BUILD_IMAGE"; do
  image_user="$(docker image inspect "$image" --format '{{.Config.User}}')"
  image_revision="$(
    docker image inspect "$image" \
      --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
  )"
  if [[ "$image_user" != "node" ]]; then
    echo "Expected $image to run as node, received $image_user" >&2
    exit 1
  fi
  if [[ "$image_revision" != "$source_revision" ]]; then
    echo "Expected $image revision $source_revision, received $image_revision" >&2
    exit 1
  fi
done

if ! docker run --rm --entrypoint sh "$PLATFORM_API_BUILD_IMAGE" -c \
  "test ! -e /app/dist/development && test ! -e /app/dist/entrypoints/mcp.js && test -e /app/dist/entrypoints/material-assets-worker.js"; then
  echo "API image contains an unrelated entrypoint or misses the Material Asset worker" >&2
  exit 1
fi

echo "Production Compose smoke passed: immutable app images -> migrations -> API -> web -> Caddy"
