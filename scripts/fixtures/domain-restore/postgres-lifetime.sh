#!/bin/sh
# Docker daemon owns this process. Host SIGKILL closes the private TCP lease or leaves the
# bootstrap handshake unclaimed; either path terminates this --rm container independently.
set -eu
bootstrap_failure_seconds=10
cause=lease_closed
pg_pid=
watchdog_pid=
listener_pid=
cleanup() {
  trap - EXIT INT TERM USR1
  for pid in "$pg_pid" "$watchdog_pid" "$listener_pid"; do
    if [ -n "$pid" ]; then kill -TERM "$pid" 2>/dev/null || true; fi
  done
  printf '{"name":"%s","cause":"%s","exitCode":%s}\n' "$RESTORE_LEASE_NAME" "$cause" "$1" > /evidence/daemon-lifetime.json.tmp
  mv /evidence/daemon-lifetime.json.tmp /evidence/daemon-lifetime.json
  exit "$1"
}
trap 'cause=interrupted; cleanup 143' INT TERM
trap 'cause=bootstrap_expired; cleanup 70' USR1
trap 'cleanup $?' EXIT
mkfifo /tmp/restore-lifetime-connected
cat > /tmp/accept-restore-lifetime <<'ACCEPT'
#!/bin/sh
printf 'LEASE_READY\n'
printf 'connected\n' > /tmp/restore-lifetime-connected
cat >/dev/null
ACCEPT
chmod 700 /tmp/accept-restore-lifetime
docker-entrypoint.sh postgres &
pg_pid=$!
(timeout "$bootstrap_failure_seconds" cat /tmp/restore-lifetime-connected >/dev/null || kill -USR1 "$$") &
watchdog_pid=$!
nc -l -p 55432 -e /tmp/accept-restore-lifetime &
listener_pid=$!
wait "$listener_pid"
