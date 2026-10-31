#!/usr/bin/env bash
# Capture infrastructure observations before the caller removes its Compose project.
set -euo pipefail

artifact_dir="${1:?artifact directory is required}"
shift
mkdir -p "$artifact_dir"
container_ids="$("$@" ps --all --quiet)" || exit 1
for container_id in $container_ids; do
  lifecycle="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}:{{.State.Status}}:{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container_id")" || continue
  case "$lifecycle" in
    object-storage:*)
      if ! node "$(dirname "$0")/minio-failure-diagnostics.mjs" "$container_id" "$artifact_dir/$container_id-minio.json" 2>/dev/null; then
        status="${lifecycle#*:}"
        status="${status%%:*}"
        health="${lifecycle##*:}"
        case "$status" in
          created|running|paused|restarting|removing|exited|dead) ;;
          *) status="unknown" ;;
        esac
        case "$health" in
          healthy|unhealthy|starting) ;;
          *) health="none" ;;
        esac
        printf '{"collector":"unavailable","state":{"status":"%s","health":"%s"},"resources":null}\n' "$status" "$health" >"$artifact_dir/$container_id-minio.json"
        printf 'Compose MinIO collector unavailable; retained lifecycle only.\n' >&2
      fi
      continue
      ;;
  esac
  lifecycle="${lifecycle#*:}"
  case "$lifecycle" in
    exited:*|dead:*|*:unhealthy)
      state_file="$artifact_dir/$container_id-state.json"
      log_file="$artifact_dir/$container_id.log"
      docker inspect --format '{{json .State}}' "$container_id" >"$state_file" 2>&1 || true
      docker logs --tail 100 "$container_id" >"$log_file" 2>&1 || true
      printf 'Compose failure diagnostics: %s (%s)\n' "$container_id" "$lifecycle" >&2
      cat "$state_file" >&2
      tail -n 30 "$log_file" >&2
      ;;
  esac
done
