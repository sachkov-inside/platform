#!/usr/bin/env bash
set -euo pipefail

backend_image="inside-platform-release-backend-smoke:$$"
web_image="inside-platform-release-web-smoke:$$"

cleanup() {
  docker image rm --force "$backend_image" "$web_image" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker build --pull --file apps/backend/Dockerfile --target backend-production --tag "$backend_image" .
docker build --pull --file apps/web/Dockerfile --target web-production --tag "$web_image" .

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
