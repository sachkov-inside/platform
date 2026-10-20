#!/usr/bin/env bash
set -euo pipefail

# The ephemeral CI runner owns these tags. Preparation is outside the cache-only runtime proof.
cd "$(dirname "${BASH_SOURCE[0]}")/.."
owner="inside-platform-production-smoke-cache-ci-$$"
source_sha="$(git rev-parse HEAD)"
override="$(mktemp "${TMPDIR:-/tmp}/inside-production-cache.XXXXXX")"
tags=("$owner-backend:v1" "$owner-backend:v2" "$owner-web:v1" "$owner-foundation:local")
cleanup() {
  local status=$?
  trap - EXIT
  if ! rm -f "$override"; then
    echo 'Failed to remove the owned cache override' >&2
    if ((status == 0)); then status=1; fi
  fi
  if ! docker image rm "${tags[@]}" >/dev/null 2>&1; then
    echo 'Failed to remove owned cache preparation tags' >&2
    if ((status == 0)); then status=1; fi
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

# Read only the checked-in model. Linux Compose parses bind mounts even with --no-normalize,
# so use synthetic values for unrelated interpolation instead of unresolved ${NAME:?} paths.
# No application env files are resolved; only the two literal digest pins leave preparation.
echo '::group::Prepare pinned broker and edge images'
pins="$(python3 - "$owner" <<'PYTHON'
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

files = ["compose.production.yaml", "scripts/fixtures/production-runtime/compose.smoke.yaml"]
environment = os.environ.copy()
sources = [Path(filename).read_text() for filename in files]
for source in sources:
    for name in re.findall(r"\$\{([A-Z_][A-Z0-9_]*)", source):
        environment[name] = "1"
# Compose versions also validate the existence of env_file paths before rendering config.
# These empty, owned stand-ins keep both content and paths independent of any real runtime.
with tempfile.TemporaryDirectory(prefix="inside-cache-model-") as config_directory:
    environment["PLATFORM_CONFIG_DIR"] = config_directory
    release_env = Path(config_directory, "runtime.env")
    release_env.write_text("")
    environment["PLATFORM_RELEASE_ENV_FILE"] = str(release_env)
    for source in sources:
        for name in re.findall(r"\$\{PLATFORM_CONFIG_DIR[^}]*\}/([a-z0-9-]+\.env)", source):
            Path(config_directory, name).write_text("")
    command = ["docker", "compose", "--env-file", "/dev/null", "--project-name", sys.argv[1]]
    for filename in files:
        command.extend(["--file", filename])
    command.extend(["config", "--no-env-resolution", "--no-normalize", "--no-consistency", "--format", "json", "rabbitmq", "caddy-smoke"])
    model = json.loads(subprocess.check_output(command, env=environment))
services = model.get("services", {}) if isinstance(model, dict) else {}
pins = []
for name in ("rabbitmq", "caddy-smoke"):
    service = services.get(name, {}) if isinstance(services, dict) else {}
    image = service.get("image") if isinstance(service, dict) else None
    if not isinstance(image, str) or re.fullmatch(r"[^\s]+@sha256:[0-9a-f]{64}", image) is None:
        print("Cache preparation requires pinned broker and edge images", file=sys.stderr)
        sys.exit(65)
    pins.append(image)
print("\n".join(pins))
PYTHON
)"
while IFS= read -r image; do
  docker pull "$image"
done <<<"$pins"
echo '::endgroup::'

echo '::group::Prepare exact-source cached production images'
for release in v1 v2; do
  docker build --file apps/backend/Dockerfile --target backend-production \
    --build-arg "INSIDE_RELEASE_VERSION=$release" --build-arg "INSIDE_SOURCE_SHA=$source_sha" \
    --tag "$owner-backend:$release" .
done
docker build --file apps/web/Dockerfile --target web-production \
  --build-arg INSIDE_RELEASE_VERSION=v1 --build-arg "INSIDE_SOURCE_SHA=$source_sha" \
  --tag "$owner-web:v1" .
docker build --file infra/production/database/Dockerfile --tag "$owner-foundation:local" infra/production/database
foundation_id="$(docker image inspect "$owner-foundation:local" --format '{{.Id}}')"
backend_id="$(docker image inspect "$owner-backend:v1" --format '{{.Id}}')"
next_backend_id="$(docker image inspect "$owner-backend:v2" --format '{{.Id}}')"
web_id="$(docker image inspect "$owner-web:v1" --format '{{.Id}}')"
printf 'services:\n  postgres:\n    image: %s\n    pull_policy: never\n  pgbackrest:\n    image: %s\n    pull_policy: never\n  restore:\n    image: %s\n    pull_policy: never\n' \
  "$foundation_id" "$foundation_id" "$foundation_id" >"$override"
echo '::endgroup::'

echo '::group::Run production smoke entirely from admitted cache'
PRODUCTION_SMOKE_CACHE_ONLY=1 \
PRODUCTION_SMOKE_CACHE_OWNER="$owner" \
PRODUCTION_SMOKE_SOURCE_SHA="$source_sha" \
PRODUCTION_SMOKE_BACKEND_IMAGE="$backend_id" \
PRODUCTION_SMOKE_NEXT_BACKEND_IMAGE="$next_backend_id" \
PRODUCTION_SMOKE_WEB_IMAGE="$web_id" \
PRODUCTION_SMOKE_FOUNDATION_IMAGE="$foundation_id" \
PRODUCTION_SMOKE_FOUNDATION_OVERRIDE="$override" \
bash scripts/production-compose-smoke.sh
echo '::endgroup::'
