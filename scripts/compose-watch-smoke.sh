#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

watch_log="$(mktemp -t inside-platform-watch.XXXXXX)"
backend_backup="$(mktemp -t inside-platform-backend.XXXXXX)"
web_backup="$(mktemp -t inside-platform-web.XXXXXX)"
manifest_backup="$(mktemp -t inside-platform-manifest.XXXXXX)"
watch_pid=""
cleanup_done=false

cp apps/backend/src/entrypoints/api.ts "$backend_backup"
cp apps/web/app/page.tsx "$web_backup"
cp apps/backend/package.json "$manifest_backup"

cleanup() {
  if [[ "$cleanup_done" == true ]]; then
    return
  fi
  cleanup_done=true
  if [[ -n "$watch_pid" ]] && kill -0 "$watch_pid" 2>/dev/null; then
    kill "$watch_pid"
    wait "$watch_pid" 2>/dev/null || true
  fi
  cp "$backend_backup" apps/backend/src/entrypoints/api.ts
  cp "$web_backup" apps/web/app/page.tsx
  cp "$manifest_backup" apps/backend/package.json
  rm -f "$watch_log" "$backend_backup" "$web_backup" "$manifest_backup"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker compose watch --no-up --quiet >"$watch_log" 2>&1 &
watch_pid="$!"

wait_for_sync() {
  local service="$1"
  local host_path="$2"
  local container_path="$3"
  local before deadline current
  before="$(docker compose exec -T "$service" stat -c %s "$container_path")"
  printf '\n' >>"$host_path"
  deadline=$((SECONDS + 30))

  while ((SECONDS < deadline)); do
    if ! kill -0 "$watch_pid" 2>/dev/null; then
      cat "$watch_log" >&2
      echo "Compose Watch exited before synchronizing $host_path" >&2
      exit 1
    fi
    current="$(docker compose exec -T "$service" stat -c %s "$container_path")"
    if [[ "$current" -gt "$before" ]]; then
      return
    fi
    sleep 0.25
  done

  cat "$watch_log" >&2
  echo "Timed out waiting for Compose Watch to synchronize $host_path" >&2
  exit 1
}

wait_for_sync api apps/backend/src/entrypoints/api.ts /workspace/apps/backend/src/entrypoints/api.ts
wait_for_sync web apps/web/app/page.tsx /workspace/apps/web/app/page.tsx

api_before="$(docker compose ps --quiet api)"
printf '\n' >>apps/backend/package.json
deadline=$((SECONDS + 180))
while ((SECONDS < deadline)); do
  api_after="$(docker compose ps --quiet api)"
  if [[ -n "$api_after" && "$api_after" != "$api_before" ]]; then
    health="$(docker inspect --format '{{.State.Health.Status}}' "$api_after")"
    if [[ "$health" == "healthy" ]]; then
      echo "Compose Watch smoke passed: backend/web sync and dependency rebuild"
      exit 0
    fi
  fi
  if ! kill -0 "$watch_pid" 2>/dev/null; then
    cat "$watch_log" >&2
    echo "Compose Watch exited during dependency rebuild" >&2
    exit 1
  fi
  sleep 0.5
done

cat "$watch_log" >&2
echo "Timed out waiting for manifest-triggered API rebuild" >&2
exit 1
