#!/usr/bin/env bash
set -euo pipefail

# Enter through the same machine queue as automated browser checks.
if [[ "${1:-}" != --owned ]]; then
  exec bash scripts/heavy-check.sh --exclusive --timeout 900 --cleanup-grace 30 bash scripts/verify-light.sh --owned "$@"
fi
shift
if ! python3 scripts/heavy-check/lock.py --owns; then
  printf '%s\n' 'Use pnpm verify:light to start an owned verification.' >&2
  exit 2
fi
options=(up)
browser_only=0
while [[ $# -gt 0 && "$1" != -- ]]; do
  case "$1" in
    --dev|--mcp) options+=("$1") ;;
    --browser-only) browser_only=1 ;;
    *) printf '%s\n' 'Usage: pnpm verify:light [--dev] [--mcp] [--browser-only] -- COMMAND [ARG...]' >&2; exit 2 ;;
  esac
  shift
done
if [[ $# -lt 2 ]]; then
  printf '%s\n' 'Usage: pnpm verify:light [--dev] [--mcp] [--browser-only] -- COMMAND [ARG...]' >&2
  exit 2
fi
shift
if [[ "$browser_only" = 1 && "${#options[@]}" -ne 1 ]]; then
  printf '%s\n' 'Use --browser-only by itself for a running instance.' >&2
  exit 2
fi
receipt=$(mktemp -d "${TMPDIR:-/tmp}/platform-verify.XXXXXX")
export INSIDE_LIGHT_VERIFICATION="$receipt"
INSIDE_LIGHT_VERIFICATION_WORKTREE="$(pwd -P)"
export INSIDE_LIGHT_VERIFICATION_WORKTREE
export AGENT_BROWSER_NAMESPACE="${AGENT_BROWSER_NAMESPACE:-kirill-agents}"
export INSIDE_LIGHT_VERIFICATION_NAMESPACE="$AGENT_BROWSER_NAMESPACE"
boot=
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
  if [[ -n "$boot" ]]; then wait "$boot" || cleanup_failed=1; fi
  rm -f "$receipt/roles" "$receipt/started" "$receipt/ready"
  rmdir "$receipt"
  if [[ "$result" -ne 0 ]]; then exit "$result"; fi
  exit "$cleanup_failed"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
if [[ "$browser_only" = 0 ]]; then
  pnpm stand:light "${options[@]}" &
  boot=$!
  while [[ ! -f "$receipt/ready" ]]; do
    if ! kill -0 "$boot" 2>/dev/null; then
      wait "$boot"
      printf '%s\n' 'The light instance ended before declaring readiness.' >&2
      exit 1
    fi
    sleep 0.25
  done
fi
"$@"
