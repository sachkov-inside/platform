#!/usr/bin/env bash
set -euo pipefail

# The ephemeral CI runner owns these tags. Preparation is outside the cache-only runtime proof.
cd "$(dirname "${BASH_SOURCE[0]}")/.."
owner="inside-platform-production-smoke-cache-ci-$$"
source_sha="$(git rev-parse HEAD)"
override="$(mktemp "${TMPDIR:-/tmp}/inside-production-cache.XXXXXX")"
tags=("$owner-backend:v1" "$owner-backend:v2" "$owner-web:v1" "$owner-foundation:local")
cleanup() {
  local status=$?
  trap - EXIT
  if ! rm -f "$override"; then
    echo 'Failed to remove the owned cache override' >&2
    if ((status == 0)); then status=1; fi
  fi
  if ! docker image rm "${tags[@]}" >/dev/null 2>&1; then
    echo 'Failed to remove owned cache preparation tags' >&2
    if ((status == 0)); then status=1; fi
  fi
  exit "$status"
}
trap cleanup EXIT

echo '::group::Prepare exact-source cached production images'
for release in v1 v2; do
  docker build --file apps/backend/Dockerfile --target backend-production \
    --build-arg "INSIDE_RELEASE_VERSION=$release" --build-arg "INSIDE_SOURCE_SHA=$source_sha" \
    --tag "$owner-backend:$release" .
done
docker build --file apps/web/Dockerfile --target web-production \
  --build-arg INSIDE_RELEASE_VERSION=v1 --build-arg "INSIDE_SOURCE_SHA=$source_sha" \
  --tag "$owner-web:v1" .
docker build --file infra/production/database/Dockerfile --tag "$owner-foundation:local" infra/production/database
foundation_id="$(docker image inspect "$owner-foundation:local" --format '{{.Id}}')"
backend_id="$(docker image inspect "$owner-backend:v1" --format '{{.Id}}')"
next_backend_id="$(docker image inspect "$owner-backend:v2" --format '{{.Id}}')"
web_id="$(docker image inspect "$owner-web:v1" --format '{{.Id}}')"
printf 'services:\n  postgres:\n    image: %s\n    pull_policy: never\n  pgbackrest:\n    image: %s\n    pull_policy: never\n  restore:\n    image: %s\n    pull_policy: never\n' \
  "$foundation_id" "$foundation_id" "$foundation_id" >"$override"
echo '::endgroup::'

echo '::group::Run production smoke entirely from admitted cache'
PRODUCTION_SMOKE_CACHE_ONLY=1 \
PRODUCTION_SMOKE_CACHE_OWNER="$owner" \
PRODUCTION_SMOKE_SOURCE_SHA="$source_sha" \
PRODUCTION_SMOKE_BACKEND_IMAGE="$backend_id" \
PRODUCTION_SMOKE_NEXT_BACKEND_IMAGE="$next_backend_id" \
PRODUCTION_SMOKE_WEB_IMAGE="$web_id" \
PRODUCTION_SMOKE_FOUNDATION_IMAGE="$foundation_id" \
PRODUCTION_SMOKE_FOUNDATION_OVERRIDE="$override" \
bash scripts/production-compose-smoke.sh
echo '::endgroup::'
