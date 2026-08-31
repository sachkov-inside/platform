#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=production-path-contract.sh
source "$script_directory/production-path-contract.sh"

fail() {
  echo "$1" >&2
  exit 1
}

if (($# < 3)); then
  fail "Usage: $0 <install-root> <command> [argument ...]"
fi

install_root="$1"
shift
production_require_canonical_directory "$install_root" "Install root"
[[ -d "$install_root/shared" && ! -L "$install_root/shared" ]] || \
  fail "Shared production directory is invalid"

lock_path="$install_root/shared/deploy.lock"
exec python3 - "$lock_path" "$@" <<'PY'
import fcntl
import os
import stat
import sys

lock_path = sys.argv[1]
command = sys.argv[2:]
flags = os.O_CREAT | os.O_WRONLY
if hasattr(os, "O_NOFOLLOW"):
    flags |= os.O_NOFOLLOW

try:
    lock_fd = os.open(lock_path, flags, 0o600)
except OSError as error:
    raise SystemExit(f"Cannot open the production deployment lock: {error}") from error

lock_stat = os.fstat(lock_fd)
if not stat.S_ISREG(lock_stat.st_mode):
    raise SystemExit("Production deployment lock must be a regular file")
os.fchmod(lock_fd, 0o600)
fcntl.flock(lock_fd, fcntl.LOCK_EX)
os.set_inheritable(lock_fd, True)
environment = os.environ.copy()
environment["PLATFORM_DEPLOY_LOCK_FD"] = str(lock_fd)
os.execvpe(command[0], command, environment)
PY
