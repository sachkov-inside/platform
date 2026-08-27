#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

api_base_url="${API_BASE_URL:-http://127.0.0.1:3001}"
web_base_url="${WEB_BASE_URL:-http://127.0.0.1:3000}"

api_health="$(curl --fail --silent --show-error "$api_base_url/health")"
if [[ "$api_health" != '{"process":"api","status":"ok","database":"reachable"}' ]]; then
  echo "Unexpected API health response: $api_health" >&2
  exit 1
fi

curl --fail --silent --show-error --output /dev/null "$api_base_url/openapi"

catalog_response="$(curl --fail --silent --show-error "$api_base_url/library/materials")"
if [[ "$catalog_response" != *'"slug":"membership-delivery-guide"'* || "$catalog_response" != *'"slug":"inside-platform-overview"'* ]]; then
  echo "Published catalog is missing the representative free or closed Material" >&2
  exit 1
fi
if [[ "$catalog_response" == *"Закрытое содержимое для участников"* ]]; then
  echo "Published catalog leaked closed Material body content" >&2
  exit 1
fi

curl --fail --silent --show-error --output /dev/null "$web_base_url"
curl --fail --silent --show-error --output /dev/null "$web_base_url/library"
docker compose exec -T web pnpm --filter @inside/web smoke:backend

if ! docker compose logs --no-color mcp | grep --quiet '"process":"mcp","status":"ok","database":"reachable"'; then
  echo "MCP did not report database-backed readiness" >&2
  docker compose logs --no-color mcp >&2
  exit 1
fi

seed_snapshot="$(
  docker compose exec -T postgres psql \
    --username "${POSTGRES_USER:-inside}" \
    --dbname "${POSTGRES_DB:-inside}" \
    --tuples-only \
    --no-align \
    --command "select count(*) || ':' || max(content_version)::text || ':' || max(publication_state) from materials.materials where slug = 'inside-platform-overview';"
)"
if [[ "$seed_snapshot" != "1:2:published" ]]; then
  echo "Expected one stable published Material at contentVersion 2, received $seed_snapshot" >&2
  exit 1
fi

echo "Compose stack smoke passed: Library/Reader web -> API -> PostgreSQL, MCP ready, seed $seed_snapshot"
