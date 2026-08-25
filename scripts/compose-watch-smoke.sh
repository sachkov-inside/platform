#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

api_base_url="${API_BASE_URL:-http://127.0.0.1:3001}"
web_base_url="${WEB_BASE_URL:-http://127.0.0.1:3000}"
watch_log="$(mktemp -t inside-platform-watch.XXXXXX)"
backend_source="apps/backend/src/infrastructure/operational-readiness.ts"
web_source="apps/web/app/page.tsx"
backend_backup="$(mktemp -t inside-platform-backend.XXXXXX)"
web_backup="$(mktemp -t inside-platform-web.XXXXXX)"
manifest_backup="$(mktemp -t inside-platform-manifest.XXXXXX)"
watch_pid=""
cleanup_done=false

cp "$backend_source" "$backend_backup"
cp "$web_source" "$web_backup"
cp apps/backend/package.json "$manifest_backup"

cleanup() {
  if [[ "$cleanup_done" == true ]]; then
    return
  fi
  cleanup_done=true
  cp "$backend_backup" "$backend_source"
  cp "$web_backup" "$web_source"
  cp "$manifest_backup" apps/backend/package.json
  if [[ -n "$watch_pid" ]] && kill -0 "$watch_pid" 2>/dev/null; then
    kill "$watch_pid"
    wait "$watch_pid" 2>/dev/null || true
  fi
  rm -f "$watch_log" "$backend_backup" "$web_backup" "$manifest_backup"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker compose watch --no-up --quiet >"$watch_log" 2>&1 &
watch_pid="$!"

watch_is_running() {
  if kill -0 "$watch_pid" 2>/dev/null; then
    return
  fi
  cat "$watch_log" >&2
  echo "Compose Watch exited before the expected update" >&2
  exit 1
}

deadline=$((SECONDS + 15))
while ((SECONDS < deadline)); do
  watch_is_running
  if grep --quiet "Watch enabled" "$watch_log"; then
    break
  fi
  sleep 0.1
done
if ! grep --quiet "Watch enabled" "$watch_log"; then
  cat "$watch_log" >&2
  echo "Timed out waiting for Compose Watch readiness" >&2
  exit 1
fi

wait_for_body() {
  local url="$1"
  local expected="$2"
  local description="$3"
  local deadline body
  deadline=$((SECONDS + 60))

  while ((SECONDS < deadline)); do
    watch_is_running
    body="$(curl --silent --show-error "$url" 2>/dev/null || true)"
    if [[ "$body" == *"$expected"* ]]; then
      return
    fi
    sleep 0.25
  done

  cat "$watch_log" >&2
  echo "Timed out waiting for $description at $url" >&2
  exit 1
}

# Change an API response so the proof observes tsx watch restarting the process,
# not only the file synchronization performed by Compose Watch.
perl -0pi -e 's/status: "ok"/status: "compose-watch-ok"/g' "$backend_source"
wait_for_body "$api_base_url/health" '"status":"compose-watch-ok"' "backend live reload"
cp "$backend_backup" "$backend_source"
wait_for_body "$api_base_url/health" '"status":"ok"' "backend source restoration"

# Replace the route transiently and require the marker in rendered HTML so the
# proof observes a Next.js rebuild and response, rather than a copied byte count.
printf '%s\n' \
  'import { HomePage } from "@/_pages/home";' \
  '' \
  'export default function ComposeWatchProof() {' \
  '  return (' \
  '    <>' \
  '      <span data-compose-watch="live">compose-watch-web-live</span>' \
  '      <HomePage />' \
  '    </>' \
  '  );' \
  '}' >"$web_source"
wait_for_body "$web_base_url" compose-watch-web-live "frontend live reload"
cp "$web_backup" "$web_source"

deadline=$((SECONDS + 60))
while ((SECONDS < deadline)); do
  watch_is_running
  if ! curl --silent --show-error "$web_base_url" 2>/dev/null | grep --quiet compose-watch-web-live; then
    break
  fi
  sleep 0.25
done
if curl --silent --show-error "$web_base_url" 2>/dev/null | grep --quiet compose-watch-web-live; then
  cat "$watch_log" >&2
  echo "Timed out waiting for frontend source restoration" >&2
  exit 1
fi

api_before="$(docker compose ps --quiet api)"
printf '\n' >>apps/backend/package.json
deadline=$((SECONDS + 180))
while ((SECONDS < deadline)); do
  api_after="$(docker compose ps --quiet api)"
  if [[ -n "$api_after" && "$api_after" != "$api_before" ]]; then
    health="$(docker inspect --format '{{.State.Health.Status}}' "$api_after")"
    if [[ "$health" == "healthy" ]]; then
      echo "Compose Watch smoke passed: backend/frontend live responses and dependency rebuild"
      exit 0
    fi
  fi
  watch_is_running
  sleep 0.5
done

cat "$watch_log" >&2
echo "Timed out waiting for manifest-triggered API rebuild" >&2
exit 1
