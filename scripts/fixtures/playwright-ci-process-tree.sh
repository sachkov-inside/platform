#!/usr/bin/env bash
set -euo pipefail

installer=$1
fixture=$(mktemp -d)
export INSTALL_TEST_PIDS="$fixture/pids"
cleanup() {
  if [[ -f "$INSTALL_TEST_PIDS" ]]; then
    while read -r pid; do kill -KILL "$pid" 2>/dev/null || true; done < "$INSTALL_TEST_PIDS"
  fi
  rm -rf "$fixture"
}
trap cleanup EXIT

cat > "$fixture/sudo" <<'SH'
#!/usr/bin/env bash
set -eu
case "$1" in
  tee) cat >/dev/null ;;
  timeout)
    shift
    signal_option=$1
    shift 2
    # Scale only the deadline; execute the installer's real signal option.
    exec /usr/bin/timeout "$signal_option" 1s "$@"
    ;;
esac
SH
cat > "$fixture/node" <<'SH'
#!/usr/bin/env bash
# Model a CLI parent that exits on SIGTERM, with a child that ignores SIGTERM.
trap 'exit 0' TERM
bash -c 'trap "" TERM; echo "$$" >> "$INSTALL_TEST_PIDS"; exec sleep 600' &
wait
SH
cat > "$fixture/pnpm" <<'SH'
#!/usr/bin/env bash
echo 'Browser downloads must not start after two deadlines.' >&2
exit 99
SH
chmod +x "$fixture/sudo" "$fixture/node" "$fixture/pnpm"

set +e
PATH="$fixture:$PATH" bash "$installer" chromium > "$fixture/output" 2>&1
status=$?
set -e
cat "$fixture/output"
test "$(wc -l < "$INSTALL_TEST_PIDS")" -eq 2
while read -r pid; do
  if [[ -f "/proc/$pid/status" ]] && ! grep -q '^State:.*Z' "/proc/$pid/status"; then
    echo "Child $pid survived the deadline." >&2
    exit 1
  fi
done < "$INSTALL_TEST_PIDS"
test "$status" -eq 137
echo 'Both deadline attempts terminated their SIGTERM-resistant children.'
