#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

release_version=v1
source_sha=1111111111111111111111111111111111111111
project_name="inside-platform-production-smoke-$$"
foundation_project="${project_name}-database"
foundation_network="${project_name}-database"
foundation_volume="${project_name}-postgres"
runtime_config_dir="$(mktemp -d "${TMPDIR:-/tmp}/inside-platform-runtime-env.XXXXXX")"
foundation_config_dir="$(mktemp -d "${TMPDIR:-/tmp}/inside-platform-foundation-env.XXXXXX")"
artifact_dir="${PRODUCTION_SMOKE_ARTIFACT_DIR:-}"
backend_image="inside-platform-runtime-backend-smoke:$$"
next_backend_image="inside-platform-runtime-backend-next-smoke:$$"
web_image="inside-platform-runtime-web-smoke:$$"
wrong_release_container="${project_name}-wrong-release"
contender_container="${project_name}-worker-contender"
drain_lock_container="${project_name}-worker-drain-lock"
container_exit_poll_attempts=20
container_log_poll_attempts=30
worker_health_poll_attempts=20
database_lock_poll_attempts=20
pgboss_job_poll_attempts=20
production_smoke_poll_interval_seconds=1
readiness_http_retry_attempts=10
readiness_http_retry_delay_seconds=1
worker_drain_observation_seconds=1
worker_drain_lock_safety_timeout_seconds=300
worker_drain_lock_backend_pid=""
worker_stop_timeout_seconds=20

export PLATFORM_COMPOSE_PROJECT="$project_name"
export PLATFORM_CONFIG_DIR="$runtime_config_dir"
export PLATFORM_RELEASE_ENV_FILE="$runtime_config_dir/runtime.env"
export PLATFORM_API_LOOPBACK_PORT="${PRODUCTION_SMOKE_API_PORT:-33001}"
export PLATFORM_MCP_LOOPBACK_PORT="${PRODUCTION_SMOKE_MCP_PORT:-33002}"
export PLATFORM_WEB_LOOPBACK_PORT="${PRODUCTION_SMOKE_WEB_PORT:-33000}"
export PLATFORM_EDGE_NETWORK="${project_name}-edge"
export PLATFORM_APPLICATION_NETWORK="${project_name}-application"
export PLATFORM_BACKEND_IMAGE_REPOSITORY=unused.invalid/platform-backend
export PLATFORM_BACKEND_IMAGE_DIGEST=0000000000000000000000000000000000000000000000000000000000000000
export PLATFORM_WEB_IMAGE_REPOSITORY=unused.invalid/platform-web
export PLATFORM_WEB_IMAGE_DIGEST=0000000000000000000000000000000000000000000000000000000000000000
export FOUNDATION_CONFIG_DIR="$foundation_config_dir"
export FOUNDATION_DATABASE_NETWORK="$foundation_network"
export FOUNDATION_DATABASE_PROJECT="$foundation_project"
export FOUNDATION_POSTGRES_VOLUME="$foundation_volume"
export PRODUCTION_SMOKE_HTTP_PORT="${PRODUCTION_SMOKE_HTTP_PORT:-38080}"
export PRODUCTION_SMOKE_HTTPS_PORT="${PRODUCTION_SMOKE_HTTPS_PORT:-38443}"

application_compose=(
  docker compose
  --project-name "$project_name"
  --file compose.production.yaml
  --file scripts/fixtures/production-runtime/compose.smoke.yaml
)
foundation_compose=(
  docker compose
  --project-name "$foundation_project"
  --file infra/production/database/compose.yaml
)

cleanup() {
  local test_status=$?
  local cleanup_status=0
  trap - EXIT

  if ((test_status != 0)) && [[ -n "$artifact_dir" ]] && mkdir -p "$artifact_dir"; then
    "${application_compose[@]}" ps --all >"$artifact_dir/compose-ps.txt" 2>&1 || true
    "${application_compose[@]}" logs --no-color --tail 500 >"$artifact_dir/compose.log" 2>&1 || true
    "${foundation_compose[@]}" logs --no-color --tail 500 >"$artifact_dir/foundation.log" 2>&1 || true
  fi

  docker container rm --force \
    "$wrong_release_container" \
    "$contender_container" \
    "$drain_lock_container" >/dev/null 2>&1 || true
  if ! "${application_compose[@]}" down --volumes --remove-orphans; then
    echo "Failed to remove production runtime smoke resources" >&2
    cleanup_status=1
  fi
  if ! "${foundation_compose[@]}" down --rmi local --volumes --remove-orphans; then
    echo "Failed to remove production foundation smoke resources" >&2
    cleanup_status=1
  fi
  docker image rm --force "$backend_image" "$next_backend_image" "$web_image" >/dev/null 2>&1 || true
  rm -r "$runtime_config_dir" "$foundation_config_dir"

  if ((test_status != 0)); then
    exit "$test_status"
  fi
  exit "$cleanup_status"
}
trap cleanup EXIT

write_runtime_configuration() {
  cat >"$runtime_config_dir/runtime.env" <<EOF
PLATFORM_RELEASE_VERSION=$release_version
PLATFORM_SOURCE_SHA=$source_sha
EOF
  cat >"$runtime_config_dir/migrations.env" <<'EOF'
NODE_ENV=production
DATABASE_URL=postgresql://platform:platform-production-smoke-password@postgres:5432/inside
EOF
  cat >"$runtime_config_dir/api.env" <<EOF
NODE_ENV=production
DATABASE_URL=postgresql://platform:platform-production-smoke-password@postgres:5432/inside
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
KINESCOPE_PROVIDER_MODE=real
KINESCOPE_API_BASE_URL=https://api.kinescope.io
KINESCOPE_UPLOADER_BASE_URL=https://uploader.kinescope.io
KINESCOPE_API_TOKEN=inside-production-smoke-kinescope-token
KINESCOPE_PUBLIC_PROJECT_ID=inside-production-smoke-public-project
KINESCOPE_MEMBERSHIP_PROJECT_ID=inside-production-smoke-membership-project
KINESCOPE_CALLBACK_USERNAME=inside-production-smoke-callback
KINESCOPE_CALLBACK_PASSWORD=inside-production-smoke-callback-password
KINESCOPE_WEBHOOK_USERNAME=inside-production-smoke-webhook
KINESCOPE_WEBHOOK_PASSWORD=inside-production-smoke-webhook-password
KINESCOPE_PLAYBACK_JWT_SECRET=inside-production-smoke-playback-signing-secret
KINESCOPE_PLAYBACK_JWT_TTL_SECONDS=60
EOF
  cat >"$runtime_config_dir/mcp.env" <<EOF
$(sed '/^API_HOST=/d; /^API_PORT=/d; /^TELEGRAM_/d' "$runtime_config_dir/api.env")
MCP_HOST=0.0.0.0
MCP_PORT=3002
MCP_SERVER_URL=https://inside.sachkov.dev/mcp
EOF
  cat >"$runtime_config_dir/material-assets-worker.env" <<'EOF'
NODE_ENV=production
DATABASE_URL=postgresql://platform:platform-production-smoke-password@postgres:5432/inside
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
  cp "$runtime_config_dir/material-assets-worker.env" "$runtime_config_dir/profile-avatars-worker.env"
  cat >"$runtime_config_dir/video-deletions-worker.env" <<'EOF'
NODE_ENV=production
DATABASE_URL=postgresql://platform:platform-production-smoke-password@postgres:5432/inside
KINESCOPE_PROVIDER_MODE=real
KINESCOPE_API_BASE_URL=https://api.kinescope.io
KINESCOPE_UPLOADER_BASE_URL=https://uploader.kinescope.io
KINESCOPE_API_TOKEN=inside-production-smoke-kinescope-token
KINESCOPE_PUBLIC_PROJECT_ID=inside-production-smoke-public-project
KINESCOPE_MEMBERSHIP_PROJECT_ID=inside-production-smoke-membership-project
KINESCOPE_CALLBACK_USERNAME=inside-production-smoke-callback
KINESCOPE_CALLBACK_PASSWORD=inside-production-smoke-callback-password
KINESCOPE_WEBHOOK_USERNAME=inside-production-smoke-webhook
KINESCOPE_WEBHOOK_PASSWORD=inside-production-smoke-webhook-password
KINESCOPE_PLAYBACK_JWT_SECRET=inside-production-smoke-playback-signing-secret
KINESCOPE_PLAYBACK_JWT_TTL_SECONDS=60
EOF
  cat >"$runtime_config_dir/web.env" <<EOF
NODE_ENV=production
BACKEND_BASE_URL=http://api:3001
LOGTO_ENDPOINT=https://identity.production-smoke.invalid
LOGTO_AUDIENCE=https://api.production-smoke.invalid
LOGTO_APP_ID=inside-production-smoke
LOGTO_APP_SECRET=inside-production-smoke-app-secret
LOGTO_COOKIE_SECRET=inside-production-smoke-cookie-secret-key
WEB_BASE_URL=https://inside.sachkov.dev
EOF
}

write_foundation_configuration() {
  # Keep the deliberately unreachable backup provider synchronous: an async
  # pgBackRest helper becomes an untracked PostgreSQL child when postgres is PID 1.
  cat >"$foundation_config_dir/database.env" <<'EOF'
POSTGRES_DB=postgres
POSTGRES_USER=postgres
PGBACKREST_REPO1_TYPE=s3
PGBACKREST_REPO1_S3_BUCKET=inside-production-smoke-backup
PGBACKREST_REPO1_S3_ENDPOINT=storage.production-smoke.invalid
PGBACKREST_REPO1_S3_REGION=ru-central1
PGBACKREST_REPO1_S3_URI_STYLE=host
PGBACKREST_REPO1_STORAGE_VERIFY_TLS=y
PGBACKREST_ARCHIVE_ASYNC=n
EOF
  cat >"$foundation_config_dir/postgres.env" <<'EOF'
POSTGRES_PASSWORD=postgres-production-smoke-password
PLATFORM_DATABASE_PASSWORD=platform-production-smoke-password
EOF
  cat >"$foundation_config_dir/logto-database.env" <<'EOF'
LOGTO_DATABASE_PASSWORD=logto-production-smoke-password
EOF
  cat >"$foundation_config_dir/pgbackrest.env" <<'EOF'
PGBACKREST_REPO1_CIPHER_PASS=inside-production-smoke-repository-passphrase
PGBACKREST_REPO1_S3_KEY=inside-production-smoke-backup-key
PGBACKREST_REPO1_S3_KEY_SECRET=inside-production-smoke-backup-secret
EOF
}

wait_for_container_exit() {
  local container_name=$1
  local attempt
  for ((attempt = 1; attempt <= container_exit_poll_attempts; attempt += 1)); do
    if [[ "$(docker container inspect "$container_name" --format '{{.State.Status}}')" == "exited" ]]; then
      return
    fi
    sleep "$production_smoke_poll_interval_seconds"
  done
  echo "$container_name did not exit in time" >&2
  docker container logs "$container_name" >&2
  exit 1
}

wait_for_container_log() {
  local container_name=$1
  local expected=$2
  local attempt
  for ((attempt = 1; attempt <= container_log_poll_attempts; attempt += 1)); do
    if [[ "$(docker container logs "$container_name" 2>&1)" == *"$expected"* ]]; then
      return
    fi
    sleep "$production_smoke_poll_interval_seconds"
  done
  echo "$container_name did not log $expected" >&2
  docker container logs "$container_name" >&2
  exit 1
}

application_data_digest() {
  "${foundation_compose[@]}" exec -T postgres pg_dump \
    --username platform \
    --dbname inside \
    --data-only \
    --schema accounts \
    --schema assets \
    --schema materials \
    --schema member_profiles \
    --schema membership_entitlements \
    --schema telegram_membership \
    --schema videos \
    --schema workshop \
    | sed '/^\\restrict /d; /^\\unrestrict /d' \
    | shasum -a 256 \
    | cut -d ' ' -f 1
}

read_schema_marker() {
  node -e '
    const value = JSON.parse(process.argv[1]);
    if (
      typeof value.schema?.identity !== "string" ||
      !/^sha256:[0-9a-f]{64}$/u.test(value.schema.identity) ||
      !Number.isInteger(value.schema.migrationCount) ||
      value.schema.migrationCount < 1
    ) {
      process.exit(1);
    }
    process.stdout.write(`${value.schema.identity}:${value.schema.migrationCount}`);
  ' "$1"
}

assert_public_status() {
  local method=$1
  local path=$2
  local expected=$3
  local actual
  local body_path="$runtime_config_dir/public-response-body"
  actual="$(curl \
    --cacert "$runtime_config_dir/caddy-root.crt" \
    --noproxy '*' \
    --output "$body_path" \
    --request "$method" \
    --resolve "inside.sachkov.dev:${PRODUCTION_SMOKE_HTTPS_PORT}:127.0.0.1" \
    --silent \
    --write-out '%{http_code}' \
    "https://inside.sachkov.dev:${PRODUCTION_SMOKE_HTTPS_PORT}${path}")"
  if [[ "$actual" != "$expected" ]]; then
    echo "Expected $method $path to return $expected, received $actual" >&2
    exit 1
  fi
  if [[ "$expected" == "404" ]]; then
    if [[ -s "$body_path" ]]; then
      echo "Expected $method $path to return an empty fail-closed body" >&2
      exit 1
    fi
  elif [[ ! -s "$body_path" ]]; then
    echo "Expected $method $path to return a non-empty response body" >&2
    exit 1
  fi
}

wait_for_worker_health() {
  local expected=$1
  local worker
  local attempt
  for ((attempt = 1; attempt <= worker_health_poll_attempts; attempt += 1)); do
    local all_match=true
    for worker in material-assets-worker profile-avatars-worker video-deletions-worker; do
      if [[ "$(docker container inspect "$("${application_compose[@]}" ps --quiet "$worker")" --format '{{.State.Health.Status}}')" != "$expected" ]]; then
        all_match=false
      fi
    done
    if [[ "$all_match" == true ]]; then
      return
    fi
    sleep "$production_smoke_poll_interval_seconds"
  done
  echo "Workers did not reach health state $expected" >&2
  "${application_compose[@]}" ps >&2
  exit 1
}

wait_for_material_asset_table_lock() {
  local attempt
  local lock_backend_pid
  for ((attempt = 1; attempt <= database_lock_poll_attempts; attempt += 1)); do
    lock_backend_pid="$("${foundation_compose[@]}" exec -T postgres psql \
      --username postgres \
      --dbname inside \
      --tuples-only \
      --no-align \
      --command "select pid from pg_locks where relation = 'assets.material_assets'::regclass and mode = 'AccessExclusiveLock' and granted;")"
    if [[ "$lock_backend_pid" =~ ^[1-9][0-9]*$ ]]; then
      worker_drain_lock_backend_pid="$lock_backend_pid"
      return
    fi
    sleep "$production_smoke_poll_interval_seconds"
  done
  echo "Controlled worker drain lock was not acquired" >&2
  docker container logs "$drain_lock_container" >&2
  exit 1
}

wait_for_pgboss_job_state() {
  local job_id=$1
  local expected_state=$2
  local attempt
  local matching_jobs
  for ((attempt = 1; attempt <= pgboss_job_poll_attempts; attempt += 1)); do
    matching_jobs="$("${foundation_compose[@]}" exec -T postgres psql \
      --username postgres \
      --dbname inside \
      --tuples-only \
      --no-align \
      --command "select count(*) from pgboss.job where id = '$job_id'::uuid and state = '$expected_state';")"
    if [[ "$matching_jobs" == "1" ]]; then
      return
    fi
    sleep "$production_smoke_poll_interval_seconds"
  done
  echo "PgBoss job $job_id did not reach state $expected_state" >&2
  exit 1
}

write_runtime_configuration
write_foundation_configuration

docker build \
  --file apps/backend/Dockerfile \
  --target backend-production \
  --build-arg "INSIDE_RELEASE_VERSION=$release_version" \
  --build-arg "INSIDE_SOURCE_SHA=$source_sha" \
  --tag "$backend_image" \
  .
docker build \
  --file apps/backend/Dockerfile \
  --target backend-production \
  --build-arg "INSIDE_RELEASE_VERSION=v2" \
  --build-arg "INSIDE_SOURCE_SHA=$source_sha" \
  --tag "$next_backend_image" \
  .
docker build \
  --file apps/web/Dockerfile \
  --target web-production \
  --build-arg "INSIDE_RELEASE_VERSION=$release_version" \
  --build-arg "INSIDE_SOURCE_SHA=$source_sha" \
  --tag "$web_image" \
  .
PRODUCTION_SMOKE_BACKEND_IMAGE="$(docker image inspect "$backend_image" --format '{{.Id}}')"
PRODUCTION_SMOKE_WEB_IMAGE="$(docker image inspect "$web_image" --format '{{.Id}}')"
export PRODUCTION_SMOKE_BACKEND_IMAGE PRODUCTION_SMOKE_WEB_IMAGE

"${foundation_compose[@]}" config --quiet
"${foundation_compose[@]}" up --detach --build --wait postgres

"${foundation_compose[@]}" exec -T postgres createdb \
  --username postgres \
  --owner platform \
  inside_fresh
docker run --rm \
  --network "$foundation_network" \
  --env-file "$runtime_config_dir/runtime.env" \
  --env-file "$runtime_config_dir/migrations.env" \
  --env DATABASE_URL=postgresql://platform:platform-production-smoke-password@postgres:5432/inside_fresh \
  --entrypoint node \
  "$PRODUCTION_SMOKE_BACKEND_IMAGE" \
  dist/migrations/migrate.js \
  --verify-schema-compatible >/dev/null
docker run --rm \
  --network "$foundation_network" \
  --env-file "$runtime_config_dir/runtime.env" \
  --env-file "$runtime_config_dir/migrations.env" \
  --env DATABASE_URL=postgresql://platform:platform-production-smoke-password@postgres:5432/inside_fresh \
  --entrypoint node \
  "$PRODUCTION_SMOKE_BACKEND_IMAGE" \
  --input-type=module \
  --eval "import { migrateRuntimeDatabase } from './dist/migrations/migrate.js'; await migrateRuntimeDatabase(process.env.DATABASE_URL);"
"${foundation_compose[@]}" exec -T postgres dropdb \
  --username postgres \
  inside_fresh

docker run --rm \
  --network "$foundation_network" \
  --env-file "$runtime_config_dir/runtime.env" \
  --env-file "$runtime_config_dir/migrations.env" \
  --env DATABASE_URL=postgresql://platform:platform-production-smoke-password@postgres:5432/inside \
  --entrypoint node \
  "$PRODUCTION_SMOKE_BACKEND_IMAGE" \
  --input-type=module \
  --eval "import { runMigrationsToLatest } from './dist/infrastructure/postgres/migrate-to-latest.js'; import { platformMigrations } from './dist/migrations/index.js'; await runMigrationsToLatest(process.env.DATABASE_URL, platformMigrations.slice(0, -1));"
docker run --rm \
  --network "$foundation_network" \
  --env-file "$runtime_config_dir/runtime.env" \
  --env-file "$runtime_config_dir/migrations.env" \
  --entrypoint node \
  "$PRODUCTION_SMOKE_BACKEND_IMAGE" \
  dist/migrations/migrate.js \
  --verify-schema-compatible >/dev/null

"${application_compose[@]}" config --quiet
if "${application_compose[@]}" config --images | grep -Eq ':(latest|v[0-9]+)$'; then
  echo "Production runtime resolved a moving image tag" >&2
  exit 1
fi
"${application_compose[@]}" up --detach --wait

docker run --rm \
  --network "$foundation_network" \
  --env DATABASE_URL=postgresql://platform:platform-production-smoke-password@postgres:5432/inside \
  --entrypoint node \
  "$PRODUCTION_SMOKE_BACKEND_IMAGE" \
  --input-type=module \
  --eval "$(<scripts/fixtures/production-runtime/n-minus-one-compatibility.mjs)"

for worker in material-assets-worker profile-avatars-worker video-deletions-worker; do
  worker_state="$(docker container inspect "$("${application_compose[@]}" ps --quiet "$worker")" --format '{{.State.Status}}:{{.State.Health.Status}}:{{.RestartCount}}')"
  if [[ "$worker_state" != "running:healthy:0" ]]; then
    echo "$worker did not become healthy without restarts: $worker_state" >&2
    exit 1
  fi
  worker_logs="$("${application_compose[@]}" logs --no-color "$worker")"
  if [[ "$worker_logs" != *"\"process\":\"$worker\",\"status\":\"ready\""* ]]; then
    echo "$worker did not report release/schema readiness" >&2
    printf '%s\n' "$worker_logs" >&2
    exit 1
  fi
done

api_health="$(curl --fail --silent "http://127.0.0.1:${PLATFORM_API_LOOPBACK_PORT}/health/ready")"
if ! api_schema_marker="$(read_schema_marker "$api_health")" || [[ "$api_health" != *'"release":"v1"'* || "$api_health" != *'"status":"ready"'* ]]; then
  echo "API readiness did not report the expected release and schema: $api_health" >&2
  exit 1
fi
mcp_health="$(curl --fail --silent --header 'Host: inside.sachkov.dev' "http://127.0.0.1:${PLATFORM_MCP_LOOPBACK_PORT}/_health/ready")"
if ! mcp_schema_marker="$(read_schema_marker "$mcp_health")" || [[ "$mcp_health" != *'"release":"v1"'* || "$mcp_health" != *'"status":"ready"'* || "$mcp_schema_marker" != "$api_schema_marker" ]]; then
  echo "MCP readiness did not report the expected release and schema: $mcp_health" >&2
  exit 1
fi
web_health="$(curl --fail --silent "http://127.0.0.1:${PLATFORM_WEB_LOOPBACK_PORT}/_health/ready")"
if ! web_schema_marker="$(read_schema_marker "$web_health")" || [[ "$web_health" != *'"release":"v1"'* || "$web_health" != *'"api":"ready"'* || "$web_schema_marker" != "$api_schema_marker" ]]; then
  echo "Web readiness did not report the expected release and API: $web_health" >&2
  exit 1
fi

caddy_container_id="$("${application_compose[@]}" ps --quiet caddy-smoke)"
docker cp "$caddy_container_id:/data/caddy/pki/authorities/local/root.crt" "$runtime_config_dir/caddy-root.crt"
if curl \
  --cacert "$runtime_config_dir/caddy-root.crt" \
  --fail \
  --noproxy '*' \
  --silent \
  "https://127.0.0.1:${PRODUCTION_SMOKE_HTTPS_PORT}/" >/dev/null 2>&1; then
  echo "TLS unexpectedly accepted the wrong hostname" >&2
  exit 1
fi

data_before="$(application_data_digest)"
home_response="$(curl --cacert "$runtime_config_dir/caddy-root.crt" --fail --noproxy '*' --resolve "inside.sachkov.dev:${PRODUCTION_SMOKE_HTTPS_PORT}:127.0.0.1" --silent "https://inside.sachkov.dev:${PRODUCTION_SMOKE_HTTPS_PORT}/")"
if [[ "$home_response" != *"Sachkov Inside"* ]]; then
  echo "Caddy did not serve the Platform home" >&2
  exit 1
fi
library_response="$(curl --cacert "$runtime_config_dir/caddy-root.crt" --fail --noproxy '*' --resolve "inside.sachkov.dev:${PRODUCTION_SMOKE_HTTPS_PORT}:127.0.0.1" --silent "https://inside.sachkov.dev:${PRODUCTION_SMOKE_HTTPS_PORT}/library")"
if [[ "$library_response" != *"База знаний"* ]]; then
  echo "Caddy did not serve the Knowledge Base" >&2
  exit 1
fi
assert_public_status POST /integrations/telegram/v1/membership-evidence 401
assert_public_status POST /integrations/kinescope/v1/webhook 401
assert_public_status POST /integrations/kinescope/v1/authorize 401
assert_public_status GET /mcp 401
assert_public_status GET /.well-known/oauth-protected-resource/mcp 200
assert_public_status GET /integrations/kinescope/v1/unknown 404
assert_public_status GET /health/ready 404
data_after="$(application_data_digest)"
if [[ "$data_before" != "$data_after" ]]; then
  echo "Basic production smoke changed application/provider data" >&2
  exit 1
fi

original_checksum="$("${foundation_compose[@]}" exec -T postgres psql --username postgres --dbname inside --tuples-only --no-align --command 'select checksum from public.platform_migrations where position = 1;')"
if [[ ! "$original_checksum" =~ ^[0-9a-f]{64}$ ]]; then
  echo "Could not capture the original migration checksum" >&2
  exit 1
fi
"${foundation_compose[@]}" exec -T postgres psql --username postgres --dbname inside --set ON_ERROR_STOP=1 --command "update public.platform_migrations set checksum = repeat('0', 64) where position = 1;" >/dev/null
wrong_schema_body="$runtime_config_dir/wrong-schema-body.json"
wrong_schema_status="$(curl --output "$wrong_schema_body" --silent --write-out '%{http_code}' "http://127.0.0.1:${PLATFORM_API_LOOPBACK_PORT}/health/ready")"
if [[ "$wrong_schema_status" != "503" ]]; then
  echo "API did not fail closed for a wrong schema identity" >&2
  exit 1
fi
if [[ "$(node -e 'const fs=require("node:fs");const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(value.code??"")' "$wrong_schema_body")" != "dependency_unavailable" ]]; then
  echo "API wrong-schema response did not return dependency_unavailable" >&2
  exit 1
fi
wait_for_worker_health unhealthy
"${foundation_compose[@]}" exec -T postgres psql --username postgres --dbname inside --set ON_ERROR_STOP=1 --command "update public.platform_migrations set checksum = '$original_checksum' where position = 1;" >/dev/null
restored_readiness="$(curl \
  --fail \
  --retry "$readiness_http_retry_attempts" \
  --retry-all-errors \
  --retry-delay "$readiness_http_retry_delay_seconds" \
  --silent \
  "http://127.0.0.1:${PLATFORM_API_LOOPBACK_PORT}/health/ready")"
if ! restored_schema_marker="$(read_schema_marker "$restored_readiness")" || [[ "$restored_readiness" != *'"release":"v1"'* || "$restored_schema_marker" != "$api_schema_marker" ]]; then
  echo "API readiness did not recover with the expected body: $restored_readiness" >&2
  exit 1
fi
wait_for_worker_health healthy

docker create \
  --name "$wrong_release_container" \
  --network "$foundation_network" \
  --env-file "$runtime_config_dir/runtime.env" \
  --env-file "$runtime_config_dir/api.env" \
  --env PLATFORM_RELEASE_VERSION=v2 \
  --entrypoint node \
  "$PRODUCTION_SMOKE_BACKEND_IMAGE" \
  dist/entrypoints/api.js >/dev/null
docker start "$wrong_release_container" >/dev/null
wait_for_container_exit "$wrong_release_container"
if [[ "$(docker container inspect "$wrong_release_container" --format '{{.State.ExitCode}}')" == "0" ]] || [[ "$(docker container logs "$wrong_release_container" 2>&1)" != *"Runtime release identity does not match"* ]]; then
  echo "A wrong release identity did not fail closed" >&2
  docker container logs "$wrong_release_container" >&2
  exit 1
fi

docker create \
  --name "$contender_container" \
  --network "$foundation_network" \
  --tmpfs /tmp \
  --env-file "$runtime_config_dir/runtime.env" \
  --env-file "$runtime_config_dir/material-assets-worker.env" \
  --env PLATFORM_RELEASE_VERSION=v2 \
  --entrypoint node \
  "$next_backend_image" \
  dist/entrypoints/material-assets-worker.js >/dev/null
docker start "$contender_container" >/dev/null
wait_for_container_exit "$contender_container"
if [[ "$(docker container logs "$contender_container" 2>&1)" != *"Another material-assets-worker generation is still active"* ]]; then
  echo "Concurrent worker generation was not rejected" >&2
  docker container logs "$contender_container" >&2
  exit 1
fi
docker container rm "$contender_container" >/dev/null

foundation_postgres_container="$("${foundation_compose[@]}" ps --quiet postgres)"
foundation_postgres_image="$(docker container inspect "$foundation_postgres_container" --format '{{.Config.Image}}')"
docker create \
  --name "$drain_lock_container" \
  --network "$foundation_network" \
  --env PGPASSWORD=platform-production-smoke-password \
  --entrypoint psql \
  "$foundation_postgres_image" \
  --host postgres \
  --username platform \
  --dbname inside \
  --set ON_ERROR_STOP=1 \
  --command "begin; lock table assets.material_assets in access exclusive mode; select pg_sleep(${worker_drain_lock_safety_timeout_seconds}); commit;" >/dev/null
docker start "$drain_lock_container" >/dev/null
wait_for_material_asset_table_lock

drain_job_id="$(docker run \
  --rm \
  --network "$foundation_network" \
  --env-file "$runtime_config_dir/material-assets-worker.env" \
  --entrypoint node \
  "$backend_image" \
  --input-type=module \
  --eval '
    import { PgBoss } from "pg-boss";
    const jobs = new PgBoss({
      connectionString: process.env.DATABASE_URL,
      createSchema: false,
      migrate: false,
      schema: "pgboss",
    });
    await jobs.start();
    const jobId = await jobs.send("material-assets.cleanup", {});
    await jobs.stop();
    if (jobId === null) throw new Error("Could not enqueue worker drain probe");
    process.stdout.write(jobId);
  ')"
if [[ ! "$drain_job_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  echo "Worker drain probe returned an invalid PgBoss job id: $drain_job_id" >&2
  exit 1
fi
wait_for_pgboss_job_state "$drain_job_id" active

old_worker_container="$("${application_compose[@]}" ps --quiet material-assets-worker)"
docker kill --signal TERM "$old_worker_container" >/dev/null
sleep "$worker_drain_observation_seconds"
if [[ "$(docker container inspect "$old_worker_container" --format '{{.State.Status}}')" != "running" ]]; then
  echo "Old worker exited before its in-flight PgBoss job could drain" >&2
  exit 1
fi
wait_for_pgboss_job_state "$drain_job_id" active

lock_terminated="$("${foundation_compose[@]}" exec -T postgres psql \
  --username postgres \
  --dbname inside \
  --tuples-only \
  --no-align \
  --command "select pg_terminate_backend(${worker_drain_lock_backend_pid});")"
if [[ "$lock_terminated" != "t" ]]; then
  echo "Could not terminate controlled worker drain lock session" >&2
  exit 1
fi
wait_for_container_exit "$drain_lock_container"
wait_for_container_exit "$old_worker_container"
wait_for_pgboss_job_state "$drain_job_id" completed
old_worker_logs="$("${application_compose[@]}" logs --no-color material-assets-worker)"
if [[ "$old_worker_logs" != *'"status":"draining"'* || "$old_worker_logs" != *'"status":"stopped"'* ]]; then
  echo "Old worker generation did not drain before stopping" >&2
  printf '%s\n' "$old_worker_logs" >&2
  exit 1
fi

docker create \
  --name "$contender_container" \
  --network "$foundation_network" \
  --tmpfs /tmp \
  --env-file "$runtime_config_dir/runtime.env" \
  --env-file "$runtime_config_dir/material-assets-worker.env" \
  --env PLATFORM_RELEASE_VERSION=v2 \
  --entrypoint node \
  "$next_backend_image" \
  dist/entrypoints/material-assets-worker.js >/dev/null
docker start "$contender_container" >/dev/null
wait_for_container_log "$contender_container" '"process":"material-assets-worker","status":"ready"'
docker stop --time "$worker_stop_timeout_seconds" "$contender_container" >/dev/null
new_worker_logs="$(docker container logs "$contender_container" 2>&1)"
if [[ "$new_worker_logs" != *'"status":"draining"'* || "$new_worker_logs" != *'"status":"stopped"'* ]]; then
  echo "New worker generation did not drain cleanly" >&2
  printf '%s\n' "$new_worker_logs" >&2
  exit 1
fi

echo "Production runtime smoke passed: immutable images -> migration matrix -> readiness -> routes -> worker handoff"
