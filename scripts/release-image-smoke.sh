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

docker run --rm --entrypoint sh "$backend_image" -ec '
  test "$(id -u)" = "1000"
  for path in \
    dist/entrypoints/api.js \
    dist/entrypoints/mcp.js \
    dist/entrypoints/material-assets-worker.js \
    dist/entrypoints/profile-avatars-worker.js \
    dist/entrypoints/video-deletions-worker.js \
    dist/migrations/migrate.js
  do
    test -f "$path"
  done
  test ! -e /workspace
  test ! -d /app/src
  test ! -e /app/pnpm-lock.yaml
'

docker run --rm --entrypoint sh "$web_image" -ec '
  test "$(id -u)" = "1000"
  test -f /app/apps/web/server.js
  test -d /app/apps/web/.next/static
  test ! -e /workspace
  test ! -d /app/src
  test ! -e /app/pnpm-lock.yaml
'
