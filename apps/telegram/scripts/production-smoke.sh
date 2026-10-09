#!/usr/bin/env bash
# Disposable real-runtime proof; no production configuration, provider calls or published writes.
# Run from any directory. The gateway trust/operation suite runs separately under Vitest.
set -euo pipefail
repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repository_root"

project="telegram-delivery-smoke-$$"
network="$project-database"
database="$project-postgres"
candidate="$project:candidate"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/telegram-runtime-smoke.XXXXXX")"
compose_file="$repository_root/apps/telegram/infra/production/compose.yaml"
source_sha="$(git rev-parse HEAD)"
image_built=false
network_created=false
database_created=false
refuse() {
  echo "$1" >&2
  exit 1
}
cleanup() {
  local smoke_exit=$? cleanup_exit=0
  trap - EXIT
  if [[ -f "$fixture/compose.env" ]]; then
    TELEGRAM_IMAGE="$candidate" docker compose --project-name "$project" \
      --env-file "$fixture/compose.env" -f "$compose_file" down --volumes --remove-orphans || cleanup_exit=1
  fi
  if [[ "$database_created" == true ]]; then
    docker container rm --force --volumes "$database" >/dev/null || cleanup_exit=1
  fi
  if [[ "$network_created" == true ]]; then
    docker network rm "$network" >/dev/null || cleanup_exit=1
  fi
  if [[ "$image_built" == true ]]; then
    docker image rm "$candidate" >/dev/null || cleanup_exit=1
  fi
  rm -r "$fixture" || cleanup_exit=1
  if [[ "$smoke_exit" -ne 0 ]]; then exit "$smoke_exit"; fi
  exit "$cleanup_exit"
}
trap cleanup EXIT

# Public legacy assets are retained; this proof consumes the verified v5 image without retagging it.
gh release download v5 --repo sachkov-inside/inside-telegram \
  --pattern release-manifest.json --dir "$fixture"
jq --exit-status '
  .schemaVersion == "inside.telegram.release-manifest.v1" and
  .version == "v5" and .source.repository == "sachkov-inside/inside-telegram" and
  .source.sha == "10dfbee3c9dd39d2dacdc39f8c7926ecd4498820" and
  .migrations.identity == "sha256:f91e56479cfcae72f9596dc508c776c5c06e156f16d747e4e91d956931ca533d" and
  .migrations.count == 31 and
  (.image | test("^ghcr\\.io/sachkov-inside/inside-telegram@sha256:[0-9a-f]{64}$"))
' "$fixture/release-manifest.json" >/dev/null
legacy_image="$(jq --raw-output .image "$fixture/release-manifest.json")"
identity="$(node apps/telegram/scripts/release-contract.mjs migrations-identity | jq --raw-output .identity)"
[[ "$identity" == "$(jq --raw-output .migrations.identity "$fixture/release-manifest.json")" ]] || refuse 'Migration identity mismatch'
docker build --file apps/telegram/infra/production/Dockerfile \
  --build-arg SOURCE_COMMIT="$source_sha" --tag "$candidate" .
image_built=true
docker pull "$legacy_image"
[[ "$(docker image inspect "$legacy_image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" == "$(jq --raw-output .source.sha "$fixture/release-manifest.json")" ]] || refuse 'Legacy image source SHA mismatch'
[[ "$(docker image inspect "$candidate" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" == "$source_sha" ]] || refuse 'Candidate image source SHA mismatch'

# The app has no live provider configuration and no workers; only loopback readiness/auth are called.
cat >"$fixture/application.env" <<'ENV'
NODE_ENV=production
DATABASE_URL=postgresql://telegram_checks:telegram_checks@postgres:5432/inside_telegram
WORKERS_ENABLED=false
TELEGRAM_BOT_IDENTITY=inside
TELEGRAM_CANONICAL_CHAT_ID=-1000000000000
TELEGRAM_WEBHOOK_SECRET=synthetic_webhook_secret_for_runtime_smoke
PLATFORM_INTEGRATION_SECRET=synthetic_linking_secret_for_runtime_smoke
TELEGRAM_WELCOME_TEXT=synthetic
TELEGRAM_LINK_RECEIPT_TEXT=synthetic
TELEGRAM_LINKED_MEMBER_TEXT=synthetic
TELEGRAM_LINKED_NON_MEMBER_TEXT=synthetic
TELEGRAM_LINKED_UNAVAILABLE_TEXT=synthetic
TELEGRAM_DELIVERY_MODE=disabled
TELEGRAM_MEMBERSHIP_MODE=disabled
PLATFORM_EVIDENCE_DELIVERY_MODE=disabled
TELEGRAM_COMMUNITY_CONTRACT_VERSION=inside.community-entitlement.v2
TELEGRAM_COMMUNITY_MODE=disabled
TELEGRAM_COMMUNITY_REMOVALS_ENABLED=false
TELEGRAM_SIGN_IN_ENABLED=false
TELEGRAM_NOTIFICATIONS_ENABLED=false
TELEGRAM_MARKETING_ENABLED=false
TELEGRAM_ACTIVATION_ENABLED=false
ENV
# Docker chooses a free loopback port; this project never claims the shared Platform stand.
cat >"$fixture/compose.env" <<ENV
TELEGRAM_CONFIG_DIR=$fixture
TELEGRAM_DATABASE_NETWORK=$network
TELEGRAM_LOOPBACK_PORT=0
ENV
docker network create "$network" >/dev/null
network_created=true
docker run --detach --name "$database" --network "$network" --network-alias postgres \
  --env POSTGRES_DB=inside_telegram --env POSTGRES_USER=telegram_checks \
  --env POSTGRES_PASSWORD=telegram_checks public.ecr.aws/docker/library/postgres:18.4-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15 >/dev/null
database_created=true
ready=false
for ((attempt=1; attempt<=40; attempt+=1)); do
  if docker exec "$database" pg_isready -U telegram_checks -d inside_telegram >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]] || refuse 'Smoke database did not become ready'

compose() {
  TELEGRAM_IMAGE="$active_image" docker compose --project-name "$project" \
    --env-file "$fixture/compose.env" -f "$compose_file" "$@"
}
query() {
  docker exec "$database" psql -X --tuples-only --no-align \
    -U telegram_checks -d inside_telegram --command "$1"
}
assert_ready() {
  local binding port
  binding="$(compose port app 3002)"
  [[ "${binding%:*}" == 127.0.0.1 ]] || refuse 'Smoke app binding is not loopback'
  port="${binding##*:}"
  curl --fail --silent --show-error "http://127.0.0.1:$port/ready" >"$fixture/readiness.json"
  jq --exit-status '. == {status: "ready"}' "$fixture/readiness.json" >/dev/null
  local auth_status
  auth_status="$(curl --silent --show-error --output "$fixture/auth.json" --write-out '%{http_code}' --request POST \
    "http://127.0.0.1:$port/integrations/platform/v1/identity-links")"
  [[ "$auth_status" == 401 ]] || refuse 'Smoke app authentication status mismatch'
  jq --exit-status '.statusCode == 401 and .message == "Unauthorized"' "$fixture/auth.json" >/dev/null
  local container actual_id expected_id
  container="$(compose ps --quiet app)"
  actual_id="$(docker inspect "$container" --format '{{.Image}}')"
  expected_id="$(docker image inspect "$active_image" --format '{{.Id}}')"
  [[ "$actual_id" == "$expected_id" ]] || refuse 'Running image ID mismatch'
}

active_image="$legacy_image"
compose --profile operations run --rm --interactive=false migrate
compose up --detach --no-build --wait app
assert_ready
[[ "$(query 'select count(*) from kysely_migration')" == 31 ]] || refuse 'Legacy migration count mismatch'
query 'create table delivery_smoke_sentinel (value text primary key); insert into delivery_smoke_sentinel values ($$preserved$$)' >/dev/null
ledger_before="$(query 'select name from kysely_migration order by name')"

started="$(date +%s)"
compose stop app
active_image="$candidate"
compose --profile operations run --rm --interactive=false migrate
compose up --detach --no-build --wait app
assert_ready
[[ "$(query 'select name from kysely_migration order by name')" == "$ledger_before" ]] || refuse 'Candidate migration ledger changed'
[[ "$(query 'select value from delivery_smoke_sentinel')" == preserved ]] || refuse 'Candidate sentinel changed'
echo "Candidate restart/readiness: $(( $(date +%s) - started )) seconds"
# Repeated start and rollback never execute the migration command.
compose up --detach --no-build --wait app
assert_ready
started="$(date +%s)"
compose stop app
active_image="$legacy_image"
compose up --detach --no-build --wait app
assert_ready
[[ "$(query 'select name from kysely_migration order by name')" == "$ledger_before" ]] || refuse 'Rollback migration ledger changed'
[[ "$(query 'select value from delivery_smoke_sentinel')" == preserved ]] || refuse 'Rollback sentinel changed'
echo "Legacy rollback/readiness: $(( $(date +%s) - started )) seconds"
echo "Telegram runtime transition and rollback passed: 31 migrations, sentinel preserved, exact image IDs and loopback readiness/auth verified."
