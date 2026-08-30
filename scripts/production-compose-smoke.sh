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
export PLATFORM_API_IMAGE="inside-platform-api:production-smoke-${smoke_suffix}"
export PLATFORM_WEB_IMAGE="inside-platform-web:production-smoke-${smoke_suffix}"
export SOURCE_REVISION="$source_revision"
export POSTGRES_DB=inside
export POSTGRES_USER=inside
export POSTGRES_PASSWORD=inside-production-smoke-database-password
export DATABASE_URL=postgresql://inside:inside-production-smoke-database-password@postgres:5432/inside
export LOGTO_ISSUER=https://identity.production-smoke.invalid/oidc
export LOGTO_ENDPOINT=https://identity.production-smoke.invalid
export LOGTO_AUDIENCE=https://api.production-smoke.invalid
export LOGTO_JWKS_URL=https://identity.production-smoke.invalid/oidc/jwks
export LOGTO_APP_ID=inside-production-smoke
export LOGTO_APP_SECRET=inside-production-smoke-app-secret
export LOGTO_COOKIE_SECRET=inside-production-smoke-cookie-secret-key
export IDENTITY_EMAIL_FINGERPRINT_KEY=inside-production-smoke-email-fingerprint-key
export MEMBERSHIP_ACQUISITION_URL=https://membership.production-smoke.invalid
export WEB_BASE_URL="https://localhost:${https_port}"

compose=(
  docker compose
  --project-name "$project_name"
  --file compose.production.yaml
  --file compose.production.build.yaml
)

cleanup() {
  "${compose[@]}" down --volumes --remove-orphans
}
trap cleanup EXIT

"${compose[@]}" config --quiet
"${compose[@]}" build api web
"${compose[@]}" up --detach --wait

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

migration_count="$(
  "${compose[@]}" exec -T postgres psql \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --tuples-only \
    --no-align \
    --command "select count(*) from public.platform_migrations;"
)"
if [[ "$migration_count" != "7" ]]; then
  echo "Expected 7 applied migrations, received $migration_count" >&2
  exit 1
fi

for image in "$PLATFORM_API_IMAGE" "$PLATFORM_WEB_IMAGE"; do
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

if ! docker run --rm --entrypoint sh "$PLATFORM_API_IMAGE" -c \
  "test ! -e /app/dist/development && test ! -e /app/dist/entrypoints/mcp.js"; then
  echo "API image contains a development or unrelated process entrypoint" >&2
  exit 1
fi

echo "Production Compose smoke passed: immutable app images -> migrations -> API -> web -> Caddy"
