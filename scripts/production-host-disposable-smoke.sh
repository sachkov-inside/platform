#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
suffix="$$"
image="inside-production-host-fixture:$suffix"
container="inside-production-host-fixture-$suffix"

docker_architecture="$(docker info --format '{{.Architecture}}')"
if [[ "$docker_architecture" != "x86_64" && "$docker_architecture" != "amd64" ]]; then
  echo "Disposable x86_64 host smoke is CI-owned; skipped on $docker_architecture"
  exit 0
fi

cleanup() {
  local test_status=$?
  trap - EXIT
  docker container rm --force "$container" >/dev/null 2>&1 || true
  docker image rm --force "$image" >/dev/null 2>&1 || true
  exit "$test_status"
}
trap cleanup EXIT

docker build \
  --platform linux/amd64 \
  --file "$repository_root/infra/production/host/DisposableHost.Dockerfile" \
  --tag "$image" \
  "$repository_root/infra/production/host"
docker run \
  --detach \
  --platform linux/amd64 \
  --privileged \
  --cgroupns=host \
  --name "$container" \
  --tmpfs /run \
  --tmpfs /run/lock \
  --volume /sys/fs/cgroup:/sys/fs/cgroup:rw \
  "$image" >/dev/null

for _ in {1..30}; do
  state="$(docker exec "$container" systemctl is-system-running 2>/dev/null || true)"
  if [[ "$state" == "running" || "$state" == "degraded" ]]; then
    break
  fi
  sleep 1
done
if [[ "$state" != "running" && "$state" != "degraded" ]]; then
  echo "Disposable Ubuntu systemd did not become ready" >&2
  exit 1
fi

docker exec "$container" mkdir -p \
  /foundation/infra/identity \
  /foundation/infra/production \
  /foundation/scripts
docker cp "$repository_root/infra/identity/logto" \
  "$container:/foundation/infra/identity/logto"
docker cp "$repository_root/infra/production/." \
  "$container:/foundation/infra/production/"
docker cp "$repository_root/scripts/production-secrets.mjs" \
  "$container:/foundation/scripts/production-secrets.mjs"
docker cp "$repository_root/scripts/production-secrets-smoke.sh" \
  "$container:/foundation/scripts/production-secrets-smoke.sh"

bootstrap=(
  docker exec "$container"
  python3 /foundation/infra/production/host/host-foundation.py bootstrap
  --facts /foundation/infra/production/host/disposable-host-facts.json
)
"${bootstrap[@]}"

snapshot() {
  docker exec "$container" bash -c '
    find \
      /etc/caddy/Caddyfile \
      /etc/ssh/sshd_config.d/inside-deploy.conf \
      /etc/sudoers.d/inside-deploy \
      /opt/inside/foundation \
      /usr/local/libexec/inside \
      /var/lib/inside/.inside-foundation \
      -type f -printf "%m %u:%g %p " -exec sha256sum {} \; \
      | sort
    readlink /opt/inside/foundation/current
  '
}

first_snapshot="$(snapshot)"
"${bootstrap[@]}"
second_snapshot="$(snapshot)"
if [[ "$first_snapshot" != "$second_snapshot" ]]; then
  echo "Disposable host bootstrap drifted on the second convergence" >&2
  exit 1
fi

for service in caddy docker ssh; do
  docker exec "$container" systemctl is-active --quiet "$service"
done
docker exec "$container" ufw status | grep -q '^Status: active$'
deploy_groups="$(docker exec "$container" id --name --groups inside-deploy)"
if [[ "$deploy_groups" != "inside-deploy" ]]; then
  echo "Deploy identity received an unrelated group" >&2
  exit 1
fi
docker exec "$container" test "$(docker exec "$container" stat -c %a /run/inside/secrets)" = 700
docker exec "$container" /usr/local/libexec/inside/host-foundation.py deploy \
  --original-command 'foundation preflight'
docker exec --env PRODUCTION_SECRETS_HOST_MODE=1 "$container" \
  bash /foundation/scripts/production-secrets-smoke.sh

if docker exec --user inside-deploy "$container" sudo -n \
  /usr/local/libexec/inside/host-foundation.py deploy-fixture \
  --root /tmp/unrelated \
  --original-command 'release prepare v1' >/dev/null 2>&1; then
  echo "Deploy identity unexpectedly reached fixture-only path access" >&2
  exit 1
fi
docker exec "$container" test ! -e /tmp/unrelated

echo "Disposable Ubuntu host bootstrap and permissions passed"
