#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

failures=0

check() {
  local name="$1"
  shift
  if output="$("$@" 2>&1)"; then
    printf '[PASS] %s: %s\n' "$name" "${output%%$'\n'*}"
  else
    printf '[FAIL] %s: %s\n' "$name" "${output%%$'\n'*}" >&2
    failures=$((failures + 1))
  fi
}

check "Docker CLI" docker --version
check "Docker Compose" docker compose version
check "Docker daemon" docker info --format '{{.ServerVersion}}'
check "Compose contract" docker compose --profile storybook config --quiet

if ((failures > 0)); then
  printf 'Platform requires only a working Docker daemon with Compose v2 for the primary startup path.\n' >&2
  exit 1
fi

printf 'Docker-only Platform prerequisites are ready; host Node.js, pnpm and .env are optional.\n'
