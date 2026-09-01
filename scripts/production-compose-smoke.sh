#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

http_port="${PRODUCTION_SMOKE_HTTP_PORT:-38080}"
https_port="${PRODUCTION_SMOKE_HTTPS_PORT:-38443}"
project_name="inside-platform-production-smoke-$$"
runtime_config_dir="$(mktemp -d "${TMPDIR:-/tmp}/inside-platform-production-smoke-env.XXXXXX")"
postgres_db=inside
postgres_user=inside

export PLATFORM_COMPOSE_PROJECT="$project_name"
export PLATFORM_HTTP_PORT="$http_port"
export PLATFORM_HTTPS_PORT="$https_port"
export PLATFORM_CONFIG_DIR="$runtime_config_dir"

cat >"$runtime_config_dir/postgres.env" <<EOF
POSTGRES_DB=$postgres_db
POSTGRES_USER=$postgres_user
POSTGRES_PASSWORD=inside-production-smoke-password
EOF

cat >"$runtime_config_dir/migrations.env" <<EOF
NODE_ENV=production
DATABASE_URL=postgresql://inside:inside-production-smoke-password@postgres:5432/inside
EOF

cat >"$runtime_config_dir/api.env" <<EOF
NODE_ENV=production
DATABASE_URL=postgresql://inside:inside-production-smoke-password@postgres:5432/inside
API_HOST=0.0.0.0
API_PORT=3001
LOGTO_ISSUER=https://identity.production-smoke.invalid/oidc
LOGTO_AUDIENCE=https://api.production-smoke.invalid
LOGTO_JWKS_URL=https://identity.production-smoke.invalid/oidc/jwks
IDENTITY_EMAIL_FINGERPRINT_KEY=inside-production-smoke-email-fingerprint-key
MEMBERSHIP_ACQUISITION_URL=https://membership.production-smoke.invalid
TELEGRAM_BOT_START_URL=https://t.me/inside_production_smoke_bot
TELEGRAM_LINKING_ENDPOINT=https://telegram.production-smoke.invalid/integrations/platform/v1/identity-links
TELEGRAM_LINKING_SECRET=inside-production-smoke-linking-secret
TELEGRAM_EVIDENCE_INGRESS_SECRET=inside-production-smoke-evidence-secret
TELEGRAM_LINK_LIFETIME_SECONDS=300
OBJECT_STORAGE_ENDPOINT=https://storage.production-smoke.invalid
OBJECT_STORAGE_REGION=ru-central1
OBJECT_STORAGE_ACCESS_KEY_ID=inside-production-smoke-storage-access-key
OBJECT_STORAGE_SECRET_ACCESS_KEY=inside-production-smoke-storage-secret-key
OBJECT_STORAGE_PUBLIC_BUCKET=inside-production-smoke-public
OBJECT_STORAGE_PROTECTED_BUCKET=inside-production-smoke-protected
OBJECT_STORAGE_QUARANTINE_BUCKET=inside-production-smoke-quarantine
OBJECT_STORAGE_SIGNED_GET_TTL_SECONDS=60
MATERIAL_ASSET_ORPHAN_GRACE_SECONDS=86400
PROFILE_AVATAR_ORPHAN_GRACE_SECONDS=86400
EOF

cp "$runtime_config_dir/api.env" "$runtime_config_dir/profile-avatars-worker.env"

cat >"$runtime_config_dir/web.env" <<EOF
NODE_ENV=production
BACKEND_BASE_URL=http://api:3001
LOGTO_ENDPOINT=https://identity.production-smoke.invalid
LOGTO_AUDIENCE=https://api.production-smoke.invalid
LOGTO_APP_ID=inside-production-smoke
LOGTO_APP_SECRET=inside-production-smoke-app-secret
LOGTO_COOKIE_SECRET=inside-production-smoke-cookie-secret-key
WEB_BASE_URL=https://localhost:${https_port}
EOF

cat >"$runtime_config_dir/caddy.env" <<EOF
PLATFORM_DOMAIN=localhost
EOF

compose=(
  docker compose
  --project-name "$project_name"
  --file compose.production.yaml
)

cleanup() {
  local test_status=$?
  local cleanup_status=0
  trap - EXIT

  if ! "${compose[@]}" down --rmi local --volumes --remove-orphans; then
    echo "Failed to remove production smoke containers, local images or persistent data" >&2
    cleanup_status=1
  fi
  rm -r "$runtime_config_dir"

  if ((test_status != 0)); then
    exit "$test_status"
  fi
  exit "$cleanup_status"
}
trap cleanup EXIT

"${compose[@]}" config --quiet
"${compose[@]}" up --detach --build --wait

avatar_worker_container_id="$("${compose[@]}" ps --quiet profile-avatars-worker)"
avatar_worker_state="$(docker container inspect "$avatar_worker_container_id" --format '{{.State.Status}}:{{.RestartCount}}')"
if [[ "$avatar_worker_state" != "running:0" ]]; then
  echo "Profile Avatar worker did not stay running without restarts: $avatar_worker_state" >&2
  "${compose[@]}" logs profile-avatars-worker >&2
  exit 1
fi
avatar_worker_logs="$("${compose[@]}" logs profile-avatars-worker)"
if [[ "$avatar_worker_logs" != *'"process":"profile-avatars-worker","status":"ready"'* ]]; then
  echo "Profile Avatar worker did not report readiness" >&2
  printf '%s\n' "$avatar_worker_logs" >&2
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
    --retry-all-errors \
    --retry-connrefused \
    --retry-delay 1 \
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
    --retry-all-errors \
    --retry-connrefused \
    --retry-delay 1 \
    --silent \
    --show-error \
    "https://localhost:${https_port}/library"
)"
if [[ "$library_response" != *"База знаний"* ]]; then
  echo "Caddy did not serve the expected Platform Knowledge Base response" >&2
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
    --username "$postgres_user" \
    --dbname "$postgres_db" \
    --tuples-only \
    --no-align \
    --command "select count(*) from public.platform_migrations;"
)"
if [[ "$migration_count" != "$expected_migration_count" ]]; then
  echo "Expected $expected_migration_count applied migrations, received $migration_count" >&2
  exit 1
fi

echo "Production Compose smoke passed: migrations -> Profile Avatar worker -> API -> web -> Caddy"
