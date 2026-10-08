#!/usr/bin/env bash
set -euo pipefail
# CI keeps its existing scheduling and does not need Python for the lock.
if [ -n "${CI:-}" ]; then
  exec "$@"
fi
exec python3 "$(dirname "$0")/heavy-check/lock.py" "$@"
