#!/usr/bin/env bash
set -euo pipefail

# Enter through the same machine queue as automated browser checks.
if [[ "${1:-}" != --owned ]]; then
  exec bash scripts/heavy-check.sh --exclusive --timeout 900 bash scripts/verify-light.sh --owned "$@"
fi
shift
if ! python3 scripts/heavy-check/lock.py --owns; then
  printf '%s\n' 'Use pnpm verify:light to start an owned verification.' >&2
  exit 2
fi
options=(up)
while [[ $# -gt 0 && "$1" != -- ]]; do
  case "$1" in
    --dev|--mcp) options+=("$1") ;;
    *) printf '%s\n' 'Usage: pnpm verify:light [--dev] [--mcp] -- COMMAND [ARG...]' >&2; exit 2 ;;
  esac
  shift
done
if [[ $# -lt 2 ]]; then
  printf '%s\n' 'Usage: pnpm verify:light [--dev] [--mcp] -- COMMAND [ARG...]' >&2
  exit 2
fi
shift
receipt=$(mktemp -d "${TMPDIR:-/tmp}/platform-verify.XXXXXX")
export INSIDE_LIGHT_VERIFICATION="$receipt"
export INSIDE_LIGHT_VERIFICATION_WORKTREE="$(pwd -P)"
cleanup() {
  local result=$? cleanup_failed=0
  trap - EXIT
  set +e
  if [[ -f "$receipt/roles" ]]; then
    while IFS= read -r role; do
      node scripts/verify-platform.mjs browser --role "$role" -- close || cleanup_failed=1
    done < <(sort -u "$receipt/roles")
  fi
  if [[ -f "$receipt/started" ]]; then
    pnpm stand:light down || cleanup_failed=1
  fi
  wait "$boot" || cleanup_failed=1
  rm -f "$receipt/roles" "$receipt/started" "$receipt/ready"
  rmdir "$receipt"
  if [[ "$result" -ne 0 ]]; then exit "$result"; fi
  exit "$cleanup_failed"
}
pnpm stand:light "${options[@]}" &
boot=$!
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
while [[ ! -f "$receipt/ready" ]]; do
  if ! kill -0 "$boot" 2>/dev/null; then
    wait "$boot"
    printf '%s\n' 'The light instance ended before declaring readiness.' >&2
    exit 1
  fi
  sleep 0.25
done
"$@"
