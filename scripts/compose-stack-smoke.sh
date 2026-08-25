#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

api_health="$(curl --fail --silent --show-error http://127.0.0.1:3001/health)"
if [[ "$api_health" != '{"process":"api","status":"ok","database":"reachable"}' ]]; then
  echo "Unexpected API health response: $api_health" >&2
  exit 1
fi

curl --fail --silent --show-error --output /dev/null http://127.0.0.1:3000
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
    --command "select (select count(*) from materials where slug = 'inside-platform-overview') || ':' || (select count(*) from material_revisions r join materials m on m.id = r.material_id where m.slug = 'inside-platform-overview');"
)"
if [[ "$seed_snapshot" != "1:1" ]]; then
  echo "Expected one stable seeded Material and revision, received $seed_snapshot" >&2
  exit 1
fi

echo "Compose stack smoke passed: web -> API -> PostgreSQL, MCP ready, seed $seed_snapshot"
