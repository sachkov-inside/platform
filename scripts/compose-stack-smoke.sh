#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

api_base_url="${API_BASE_URL:-http://127.0.0.1:3001}"
web_base_url="${WEB_BASE_URL:-http://127.0.0.1:3000}"
mcp_server_url="${MCP_SERVER_URL:-http://127.0.0.1:${MCP_HOST_PORT:-3002}/mcp}"
bank_double_url="http://127.0.0.1:${BANK_DOUBLE_HOST_PORT:-8090}"
mail_capture_url="http://127.0.0.1:${MAIL_CAPTURE_HOST_PORT:-8025}"

api_health="$(curl --fail --silent --show-error "$api_base_url/health/ready")"
if [[ "$api_health" != *'"process":"api"'* || "$api_health" != *'"status":"ready"'* || "$api_health" != *'"database":"reachable"'* || "$api_health" != *'"identity":"sha256:'* || "$api_health" != *'"migrationCount":'* ]]; then
  echo "Unexpected API health response: $api_health" >&2
  exit 1
fi

curl --fail --silent --show-error --output /dev/null "$api_base_url/openapi"

catalog_response="$(curl --fail --silent --show-error "$api_base_url/library/materials")"
if [[ "$catalog_response" != *'"slug":"developer-pipeline-bez-poteri-konteksta"'* || "$catalog_response" != *'"slug":"kak-ustroen-inside-platform"'* ]]; then
  echo "Published catalog is missing the representative free or closed Material" >&2
  exit 1
fi
if [[ "$catalog_response" == *"Закрытое содержимое для участников"* ]]; then
  echo "Published catalog leaked closed Material body content" >&2
  exit 1
fi

# Публичная витрина отдаёт только включённое в продажу, поэтому один ответ доказывает и то, что
# каталог засеян, и то, что продажа включена. Лишние предложения владельца проверке не мешают.
offers_response="$(curl --fail --silent --show-error "$api_base_url/billing/offers")"
for seeded_offer in '"name":"Материалы"' '"name":"Материалы + сопровождение"' '"name":"Руководство «Создание Platform Inside»"' '"mode":"one_time"'; do
  if [[ "$offers_response" != *"$seeded_offer"* ]]; then
    echo "Seeded offer catalog is missing $seeded_offer on the public storefront" >&2
    exit 1
  fi
done

curl --fail --silent --show-error --output /dev/null "$web_base_url"
curl --fail --silent --show-error --output /dev/null "$web_base_url/library"
docker compose exec -T web pnpm --filter @inside/web smoke:backend

mcp_origin="${mcp_server_url%/mcp}"
mcp_metadata="$(curl --fail --silent --show-error "$mcp_origin/.well-known/oauth-protected-resource/mcp")"
if [[ "$mcp_metadata" != *'"resource":"'"$mcp_server_url"'"'* || "$mcp_metadata" != *'"bearer_methods_supported":["header"]'* ]]; then
  echo "Unexpected MCP protected-resource metadata: $mcp_metadata" >&2
  exit 1
fi
unauthenticated_status="$(
  curl --silent --show-error \
    --output /dev/null \
    --write-out '%{http_code}' \
    --request POST \
    --header 'accept: application/json, text/event-stream' \
    --header 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
    "$mcp_server_url"
)"
if [[ "$unauthenticated_status" != "401" ]]; then
  echo "Expected unauthenticated MCP request to fail closed with 401, received $unauthenticated_status" >&2
  exit 1
fi

mcp_logs="$(docker compose logs --no-color mcp)"
if [[ "$mcp_logs" != *'"process":"mcp","status":"ready","database":"reachable"'* ]]; then
  echo "MCP did not report database-backed readiness" >&2
  printf '%s\n' "$mcp_logs" >&2
  exit 1
fi

seed_snapshot="$(
  docker compose exec -T postgres psql \
    --username "${POSTGRES_USER:-inside}" \
    --dbname "${POSTGRES_DB:-inside}" \
    --tuples-only \
    --no-align \
    --command "select count(*) || ':' || max(content_version)::text || ':' || max(publication_state) from materials.materials where slug = 'kak-ustroen-inside-platform';"
)"
if [[ "$seed_snapshot" != "1:2:published" ]]; then
  echo "Expected one stable published Material at contentVersion 2, received $seed_snapshot" >&2
  exit 1
fi

# Продажу на стенде можно пройти только когда двойник банка и перехватчик писем отвечают сами,
# а приложение видит именно их контур: иначе покупка молча упрётся в «способ оплаты недоступен».
bank_double_health="$(curl --fail --silent --show-error "$bank_double_url/health")"
if [[ "$bank_double_health" != *'"process":"bank-double"'* || "$bank_double_health" != *'"status":"ready"'* ]]; then
  echo "Unexpected bank double health response: $bank_double_health" >&2
  exit 1
fi

curl --fail --silent --show-error --output /dev/null "$mail_capture_url/api/v1/messages"

for service in api billing-worker; do
  service_contour="$(docker compose exec -T "$service" printenv TBANK_PROVIDER_MODE)"
  if [[ "$service_contour" != "test" ]]; then
    echo "Expected $service on the local bank double contour, received '$service_contour'" >&2
    exit 1
  fi
done

echo "Compose stack smoke passed: Library/Reader web -> API -> PostgreSQL, MCP metadata/auth boundary ready, seed $seed_snapshot, seeded offers on sale, bank double and mail capture ready"
