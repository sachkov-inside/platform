#!/usr/bin/env bash
set -euo pipefail

backend_image=""
web_image=""

cleanup() {
  if [[ -n "$backend_image" ]]; then
    docker image rm --force "$backend_image" >/dev/null 2>&1 || true
  fi
  if [[ -n "$web_image" ]]; then
    docker image rm --force "$web_image" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

while IFS=$'\t' read -r kind dockerfile target; do
  smoke_image="inside-platform-release-${kind}-smoke:$$"
  case "$kind" in
    backend) backend_image="$smoke_image" ;;
    web) web_image="$smoke_image" ;;
    *) echo "unknown release image kind: $kind" >&2; exit 1 ;;
  esac

  docker build \
    --pull \
    --provenance=false \
    --sbom=false \
    --build-arg INSIDE_RELEASE_VERSION=v1 \
    --build-arg INSIDE_SOURCE_SHA=1111111111111111111111111111111111111111 \
    --file "$dockerfile" \
    --target "$target" \
    --tag "$smoke_image" \
    .
done < <(
  node scripts/release-contract.mjs images |
    jq --raw-output '.[] | [.kind, .dockerfile, .target] | @tsv'
)

: "${backend_image:?backend release image is missing from the contract}"
: "${web_image:?web release image is missing from the contract}"

backend_image_id="$(docker image inspect --format '{{.Id}}' "$backend_image")"
schema_identity="$(bash scripts/release-schema-identity.sh "$backend_image_id")"
[[ "$schema_identity" =~ ^sha256:[0-9a-f]{64}$ ]]

docker run --rm --entrypoint sh "$backend_image" -ec '
  test "$(id -u)" = "1000"
  for path in \
    dist/entrypoints/api.js \
    dist/entrypoints/mcp.js \
    dist/entrypoints/material-assets-worker.js \
    dist/entrypoints/profile-avatars-worker.js \
    dist/entrypoints/video-deletions-worker.js \
    dist/migrations/migrate.js \
    healthcheck/http-healthcheck.mjs \
    healthcheck/index.mjs
  do
    test -f "$path"
  done
  test ! -e /workspace
  test ! -d /app/src
  test ! -e /app/pnpm-lock.yaml
  test -z "${INSIDE_IMAGE_RELEASE_VERSION:-}"
  test -z "${INSIDE_IMAGE_SOURCE_SHA:-}"
  test "$(cat release-identity.json)" = "{\"release\":\"v1\",\"sourceSha\":\"1111111111111111111111111111111111111111\"}"
  test ! -w release-identity.json
'

docker run --rm --entrypoint sh "$web_image" -ec '
  test "$(id -u)" = "1000"
  test -f /app/apps/web/healthcheck/http-healthcheck.mjs
  test -f /app/apps/web/healthcheck/index.mjs
  test -f /app/apps/web/server.js
  test -d /app/apps/web/.next/static
  test ! -e /workspace
  test ! -d /app/src
  test ! -e /app/pnpm-lock.yaml
  test -z "${INSIDE_IMAGE_RELEASE_VERSION:-}"
  test -z "${INSIDE_IMAGE_SOURCE_SHA:-}"
  test "$(cat apps/web/release-identity.json)" = "{\"release\":\"v1\",\"sourceSha\":\"1111111111111111111111111111111111111111\"}"
  test ! -w apps/web/release-identity.json
'

# Execute the shipped command without configuration: imports must work in the final images.
for kind in backend web; do
  if [[ "$kind" == backend ]]; then
    image="$backend_image"
    command_path=healthcheck/http-healthcheck.mjs
  else
    image="$web_image"
    command_path=apps/web/healthcheck/http-healthcheck.mjs
  fi
  set +e
  diagnostic="$(docker run --rm --network none --entrypoint node "$image" "$command_path" api 2>&1)"
  probe_status=$?
  set -e
  test "$probe_status" = 1
  test "$diagnostic" = 'readiness: invalid expected release identity'
done
