#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
install_root="${PLATFORM_INSTALL_ROOT:-/opt/sachkov-inside/platform}"

exec python3 "$repository_root/scripts/bootstrap-production-host.py" \
  "$install_root" \
  "$repository_root/.env.production.example"
