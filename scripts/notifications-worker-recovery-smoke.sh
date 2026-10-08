#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

# All resources belong to this invocation, including image tags. No singleton ports or data.
scratch="$(mktemp -d "${TMPDIR:-/tmp}/platform-worker-recovery.XXXXXX")"
project="platform-worker-recovery-$(basename "$scratch" | tr '[:upper:]' '[:lower:]' | tr '.' '-')"
compose_file="$scratch/compose.json"
images_file="$scratch/images"

compose() {
  docker compose --project-name "$project" --file "$compose_file" "$@"
}

cleanup() {
  result=$?
  trap - EXIT INT TERM
  set +e
  if [[ -f "$compose_file" ]]; then
    # Log collection must never prevent resource cleanup.
    if [[ "$result" -ne 0 ]]; then
      compose logs --no-color --tail 80 notifications-worker rabbitmq >&2
    fi
    compose down --volumes --remove-orphans --timeout 15
    cleanup_result=$?
    if [[ "$result" -eq 0 && "$cleanup_result" -ne 0 ]]; then result=$cleanup_result; fi
  fi
  if [[ -f "$images_file" ]]; then
    while IFS= read -r image; do
      if docker image inspect "$image" >/dev/null 2>&1; then
        docker image rm "$image" >/dev/null
        cleanup_result=$?
        if [[ "$result" -eq 0 && "$cleanup_result" -ne 0 ]]; then result=$cleanup_result; fi
      fi
    done < "$images_file"
  fi
  if [[ -n "$(docker ps -aq --filter "label=com.docker.compose.project=$project")$(docker volume ls -q --filter "label=com.docker.compose.project=$project")$(docker network ls -q --filter "label=com.docker.compose.project=$project")" ]]; then
    echo "Recovery smoke left resources for $project" >&2
    if [[ "$result" -eq 0 ]]; then result=1; fi
  fi
  rm -rf "$scratch"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Resolve checked-in Compose once, then keep only the real worker and its dependencies.
# Explicit volume/network names in resolved Compose must also be replaced for isolation.
docker compose --file compose.yaml config --format json > "$scratch/source.json"
python3 - "$scratch/source.json" "$compose_file" "$images_file" "$project" <<'PY'
import json
import sys

source, target, images_file, project = sys.argv[1:]
with open(source) as stream:
    config = json.load(stream)
services = ("postgres", "object-storage", "rabbitmq", "migrations", "seed", "notifications-worker")
config["name"] = project
config["services"] = {name: config["services"][name] for name in services}
volumes = set()
images = []
for name, service in config["services"].items():
    service.pop("ports", None)
    if "build" in service:
        service["image"] = f"{project}-{name}:local"
        images.append(service["image"])
    for mount in service.get("volumes", []):
        if mount["type"] != "volume":
            raise ValueError(f"Unexpected non-volume mount in {name}")
        volumes.add(mount["source"])
config["volumes"] = {name: {"name": f"{project}_{name}"} for name in volumes}
config["networks"] = {"default": {"name": f"{project}_default"}}
with open(target, "w") as stream:
    json.dump(config, stream)
with open(images_file, "w") as stream:
    stream.write("\n".join(images) + "\n")
PY

echo "Recovery smoke isolated project: $project"
compose up --detach --build --wait --wait-timeout 180 notifications-worker
worker_id="$(compose ps --quiet notifications-worker)"
initial_restarts="$(docker inspect --format '{{.RestartCount}}' "$worker_id")"
marker_probe="const fs=require('node:fs'); const m=JSON.parse(fs.readFileSync('/tmp/inside-platform-worker-ready.json','utf8')); if(m.process!=='notifications-worker'||m.status!=='ready'||m.database!=='reachable')process.exit(1); console.log(JSON.stringify(m))"
compose exec -T notifications-worker node -e "$marker_probe"

compose exec -T rabbitmq rabbitmqctl stop_app
# Poll the failure from this outage, rather than waiting a fixed duration for shutdown.
failed=0
for ((attempt=0; attempt<60; attempt++)); do
  logs="$(compose logs --no-color notifications-worker)"
  if [[ "$logs" == *'"event":"process_failed"'* && "$logs" == *'notification_broker_disconnected'* ]]; then
    failed=1
    break
  fi
  sleep 1
done
if [[ "$failed" -ne 1 ]]; then
  echo "Worker did not report notification_broker_disconnected" >&2
  exit 1
fi
# An exited/restarting container cannot serve readiness. A live one must have removed its marker.
if compose exec -T notifications-worker node -e "$marker_probe" >/dev/null 2>&1; then
  echo "Worker still reports readiness after broker failure" >&2
  exit 1
fi

compose exec -T rabbitmq rabbitmqctl start_app
compose exec -T rabbitmq rabbitmq-diagnostics -q check_running
# No restart/up command is allowed here: Docker must recover the application itself.
recovered=0
for ((attempt=0; attempt<60; attempt++)); do
  state="$(docker inspect --format '{{.State.Health.Status}} {{.RestartCount}}' "$worker_id")"
  if [[ "$state" == healthy\ * ]] && compose exec -T notifications-worker node -e "$marker_probe" >/dev/null 2>&1; then
    recovered=1
    break
  fi
  sleep 1
done
if [[ "$recovered" -ne 1 ]]; then
  echo "Worker did not recover readiness/healthy without manual restart: $state" >&2
  exit 1
fi
final_restarts="$(docker inspect --format '{{.RestartCount}}' "$worker_id")"
if [[ "$final_restarts" -le "$initial_restarts" ]]; then
  echo "Worker recovered without the expected container restart" >&2
  exit 1
fi
compose exec -T notifications-worker node -e "$marker_probe"
echo "Recovery smoke passed: broker stop/start, readiness removed, healthy restored; container restarts $initial_restarts -> $final_restarts"
