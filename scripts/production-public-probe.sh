#!/usr/bin/env bash
# The isolated smoke supplies runtime_config_dir and PRODUCTION_SMOKE_HTTPS_PORT.
# Each probe captures status, headers and response body from one request.

assert_public_status() {
  local method=$1
  local path=$2
  local expected=$3
  local host=${4:-inside.sachkov.dev}
  if (($# >= 4)); then shift 4; else shift 3; fi
  local actual
  local body_path="$runtime_config_dir/public-response-body"
  local headers_path="$runtime_config_dir/public-response-headers"
  actual="$(curl \
    --cacert "$runtime_config_dir/caddy-root.crt" \
    --noproxy '*' \
    --output "$body_path" \
    --dump-header "$headers_path" \
    --request "$method" \
    --resolve "${host}:${PRODUCTION_SMOKE_HTTPS_PORT}:127.0.0.1" \
    --silent \
    --write-out '%{http_code}' \
    "$@" "https://${host}:${PRODUCTION_SMOKE_HTTPS_PORT}${path}")"
  if [[ "$actual" != "$expected" ]]; then
    echo "Expected $method $path to return $expected, received $actual" >&2
    exit 1
  fi
  if [[ "$method" == "GET" && "$path" == "/mcp/learning" && "$expected" == "401" && "$host" == "inside.sachkov.dev" ]]; then
    # RFC 6750 sign-in challenges intentionally have no body; discovery remains on the old host.
    local challenge='Bearer resource_metadata="https://inside.sachkov.dev/.well-known/oauth-protected-resource/mcp/learning", scope="learning:read"'
    if [[ -s "$body_path" ]] ||
      ! tr -d '\r' <"$headers_path" | grep -Fqix "www-authenticate: $challenge"; then
      echo "Expected GET /mcp/learning to return the empty learner OAuth sign-in challenge" >&2
      exit 1
    fi
  elif [[ "$expected" == "404" ]]; then
    if [[ -s "$body_path" ]]; then
      echo "Expected $method $path to return an empty fail-closed body" >&2
      exit 1
    fi
  elif [[ ! -s "$body_path" ]]; then
    echo "Expected $method $path to return a non-empty response body" >&2
    exit 1
  fi
}

