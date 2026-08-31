#!/usr/bin/env bash

production_state_fail() {
  echo "$1" >&2
  return 1
}

production_prepare_sanitized_environment() {
  local variable
  local value

  PRODUCTION_SANITIZED_ENVIRONMENT=(
    env -i
    "PATH=${PATH:-/usr/local/bin:/usr/bin:/bin}"
    "HOME=${HOME:-/}"
    "COMPOSE_DISABLE_ENV_FILE=1"
  )
  for variable in \
    DOCKER_CERT_PATH \
    DOCKER_CONFIG \
    DOCKER_CONTEXT \
    DOCKER_HOST \
    DOCKER_TLS_VERIFY \
    SSL_CERT_DIR \
    SSL_CERT_FILE \
    XDG_RUNTIME_DIR; do
    value="${!variable:-}"
    if [[ -n "$value" ]]; then
      PRODUCTION_SANITIZED_ENVIRONMENT+=("$variable=$value")
    fi
  done
}

production_durable_replace_file() {
  local source_path="$1"
  local destination_path="$2"

  python3 - "$source_path" "$destination_path" <<'PY'
import os
import stat
import sys

source_path, destination_path = sys.argv[1:]
source_stat = os.lstat(source_path)
if not stat.S_ISREG(source_stat.st_mode):
    raise SystemExit("Atomic state source must be a regular file")
flags = os.O_RDONLY
if hasattr(os, "O_NOFOLLOW"):
    flags |= os.O_NOFOLLOW
source_fd = os.open(source_path, flags)
try:
    os.fsync(source_fd)
finally:
    os.close(source_fd)
os.replace(source_path, destination_path)
parent_fd = os.open(os.path.dirname(destination_path), os.O_RDONLY | os.O_DIRECTORY)
try:
    os.fsync(parent_fd)
finally:
    os.close(parent_fd)
PY
}

production_durable_install_release() {
  local source_directory="$1"
  local destination_directory="$2"

  python3 - "$source_directory" "$destination_directory" <<'PY'
import os
import stat
import sys

source_directory, destination_directory = sys.argv[1:]
for directory, child_directories, files in os.walk(
    source_directory, topdown=False, followlinks=False
):
    for name in files:
        path = os.path.join(directory, name)
        file_stat = os.lstat(path)
        if not stat.S_ISREG(file_stat.st_mode):
            raise SystemExit("Release bundle contains a non-regular file")
        flags = os.O_RDONLY
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        file_fd = os.open(path, flags)
        try:
            os.fsync(file_fd)
        finally:
            os.close(file_fd)
    for name in child_directories:
        path = os.path.join(directory, name)
        if stat.S_ISLNK(os.lstat(path).st_mode):
            raise SystemExit("Release bundle contains a symbolic-link directory")
    directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
os.replace(source_directory, destination_directory)
parent_fd = os.open(os.path.dirname(destination_directory), os.O_RDONLY | os.O_DIRECTORY)
try:
    os.fsync(parent_fd)
finally:
    os.close(parent_fd)
PY
}

production_durable_replace_release_state() {
  local state_directory="$1"
  local states_root="$2"
  local temporary_link="$3"
  local state_link="$4"
  local install_root="$5"

  python3 - "$state_directory" "$states_root" "$temporary_link" "$state_link" "$install_root" <<'PY'
import os
import sys

state_directory, states_root, temporary_link, state_link, install_root = sys.argv[1:]

def fsync_directory(path):
    directory_fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)

fsync_directory(state_directory)
fsync_directory(states_root)
fsync_directory(os.path.dirname(states_root))
fsync_directory(install_root)
os.replace(temporary_link, state_link)
fsync_directory(install_root)
PY
}

production_require_deploy_lock() {
  local install_root="$1"
  local lock_fd="${PLATFORM_DEPLOY_LOCK_FD:-}"
  local lock_path="$install_root/shared/deploy.lock"

  [[ "$lock_fd" =~ ^[0-9]+$ ]] || production_state_fail \
    "Production operation must run through the deployment lock wrapper" || return 1
  python3 - "$lock_path" "$lock_fd" <<'PY'
import fcntl
import os
import stat
import sys

lock_path = sys.argv[1]
lock_fd = int(sys.argv[2])
try:
    descriptor_stat = os.fstat(lock_fd)
    path_stat = os.stat(lock_path, follow_symlinks=False)
except OSError as error:
    raise SystemExit(f"Production deployment lock descriptor is invalid: {error}") from error
if not stat.S_ISREG(path_stat.st_mode):
    raise SystemExit("Production deployment lock must be a regular file")
if (descriptor_stat.st_dev, descriptor_stat.st_ino) != (path_stat.st_dev, path_stat.st_ino):
    raise SystemExit("Production deployment lock descriptor targets the wrong file")
try:
    fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError as error:
    raise SystemExit("Production deployment lock descriptor is not held by this operation") from error
PY
}

production_accept_workflow_run_number() {
  local install_root="$1"
  local workflow_run_number="$2"
  local state_path="$install_root/shared/latest-workflow-run-number"
  local previous_run_number=""
  local temporary

  [[ "$workflow_run_number" =~ ^[1-9][0-9]{0,29}$ ]] || production_state_fail \
    "Workflow run number is invalid" || return 1
  if [[ -e "$state_path" || -L "$state_path" ]]; then
    [[ -f "$state_path" && ! -L "$state_path" ]] || production_state_fail \
      "Latest workflow run state is invalid" || return 1
    IFS= read -r previous_run_number < "$state_path"
    [[ "$previous_run_number" =~ ^[1-9][0-9]{0,29}$ ]] || production_state_fail \
      "Latest workflow run state is malformed" || return 1
    if ((${#workflow_run_number} < ${#previous_run_number})) || \
       { ((${#workflow_run_number} == ${#previous_run_number})) && \
         [[ "$workflow_run_number" < "$previous_run_number" ]]; }; then
      production_state_fail \
        "Rejected stale workflow run number $workflow_run_number after $previous_run_number"
      return 1
    fi
  fi

  temporary="$(mktemp "$install_root/shared/.latest-workflow-run-number.XXXXXX")"
  printf '%s\n' "$workflow_run_number" > "$temporary"
  chmod 0600 "$temporary"
  if ! production_durable_replace_file "$temporary" "$state_path"; then
    rm -f -- "$temporary"
    return 1
  fi
}

production_record_latest_migration() {
  local install_root="$1"
  local release_environment="$2"
  local repository
  local digest
  local state_path="$install_root/shared/latest-migration.env"
  local temporary

  repository="$(grep -E '^PLATFORM_MIGRATION_IMAGE_REPOSITORY=' "$release_environment")"
  repository="${repository#*=}"
  digest="$(grep -E '^PLATFORM_MIGRATION_IMAGE_DIGEST=' "$release_environment")"
  digest="${digest#*=}"
  [[ "$repository" == "ghcr.io/sachkov-inside/platform-api" ]] || production_state_fail \
    "Migration repository is invalid" || return 1
  [[ "$digest" =~ ^[0-9a-f]{64}$ && ! "$digest" =~ ^0+$ ]] || production_state_fail \
    "Migration digest is invalid" || return 1
  if [[ -e "$state_path" || -L "$state_path" ]]; then
    [[ -f "$state_path" && ! -L "$state_path" ]] || production_state_fail \
      "Latest migration state is invalid" || return 1
  fi

  temporary="$(mktemp "$install_root/shared/.latest-migration.env.XXXXXX")"
  printf '%s\n' \
    "PLATFORM_MIGRATION_IMAGE_REPOSITORY=$repository" \
    "PLATFORM_MIGRATION_IMAGE_DIGEST=$digest" > "$temporary"
  chmod 0600 "$temporary"
  if ! production_durable_replace_file "$temporary" "$state_path"; then
    rm -f -- "$temporary"
    return 1
  fi
}

production_read_latest_migration() {
  local install_root="$1"
  local state_path="$install_root/shared/latest-migration.env"
  local line_count

  [[ -f "$state_path" && ! -L "$state_path" ]] || production_state_fail \
    "Latest migration state is missing or invalid" || return 1
  line_count="$(wc -l < "$state_path" | tr -d '[:space:]')"
  [[ "$line_count" == "2" ]] || production_state_fail \
    "Latest migration state is malformed" || return 1
  PRODUCTION_MIGRATION_REPOSITORY="$(grep -E '^PLATFORM_MIGRATION_IMAGE_REPOSITORY=' "$state_path")"
  PRODUCTION_MIGRATION_REPOSITORY="${PRODUCTION_MIGRATION_REPOSITORY#*=}"
  PRODUCTION_MIGRATION_DIGEST="$(grep -E '^PLATFORM_MIGRATION_IMAGE_DIGEST=' "$state_path")"
  PRODUCTION_MIGRATION_DIGEST="${PRODUCTION_MIGRATION_DIGEST#*=}"
  [[ "$PRODUCTION_MIGRATION_REPOSITORY" == "ghcr.io/sachkov-inside/platform-api" ]] || \
    production_state_fail "Latest migration repository is invalid" || return 1
  [[ "$PRODUCTION_MIGRATION_DIGEST" =~ ^[0-9a-f]{64}$ && \
     ! "$PRODUCTION_MIGRATION_DIGEST" =~ ^0+$ ]] || production_state_fail \
    "Latest migration digest is invalid" || return 1
}

production_read_release_state() {
  local install_root="$1"
  local state_link="$install_root/release-state"
  local state_target
  local state_directory
  local pointer
  local pointer_target

  PRODUCTION_CURRENT_TARGET=""
  PRODUCTION_PREVIOUS_TARGET=""
  if [[ ! -e "$state_link" && ! -L "$state_link" ]]; then
    for pointer in current previous; do
      if [[ -e "$install_root/$pointer" || -L "$install_root/$pointer" ]]; then
        [[ -L "$install_root/$pointer" && \
           "$(readlink "$install_root/$pointer")" == "release-state/$pointer" ]] || \
          production_state_fail "Release pointer anchor exists without valid release state" || \
          return 1
      fi
    done
    return 0
  fi

  [[ -L "$state_link" ]] || production_state_fail "Release state pointer is invalid" || return 1
  [[ -L "$install_root/current" && "$(readlink "$install_root/current")" == "release-state/current" ]] || \
    production_state_fail "Current release pointer anchor is invalid" || return 1
  [[ -L "$install_root/previous" && "$(readlink "$install_root/previous")" == "release-state/previous" ]] || \
    production_state_fail "Previous release pointer anchor is invalid" || return 1

  state_target="$(readlink "$state_link")"
  [[ "$state_target" =~ ^shared/release-states/\.state\.[A-Za-z0-9]+$ ]] || \
    production_state_fail "Release state target is invalid" || return 1
  state_directory="$install_root/$state_target"
  production_require_canonical_directory "$state_directory" "Release state directory"

  for pointer in current previous; do
    if [[ ! -e "$state_directory/$pointer" && ! -L "$state_directory/$pointer" ]]; then
      [[ "$pointer" == "previous" ]] || production_state_fail \
        "Current release state is missing" || return 1
      continue
    fi
    [[ -L "$state_directory/$pointer" ]] || production_state_fail \
      "Release state entry is invalid" || return 1
    pointer_target="$(readlink "$state_directory/$pointer")"
    [[ "$pointer_target" =~ ^\.\./\.\./\.\./releases/[0-9a-f]{40}$ ]] || \
      production_state_fail "Release state entry target is invalid" || return 1
    pointer_target="${pointer_target#../../../}"
    [[ -d "$install_root/$pointer_target" && ! -L "$install_root/$pointer_target" ]] || \
      production_state_fail "Release state entry does not identify a release directory" || return 1
    if [[ "$pointer" == "current" ]]; then
      # shellcheck disable=SC2034  # Output consumed by scripts that source this Module.
      PRODUCTION_CURRENT_TARGET="$pointer_target"
    else
      # shellcheck disable=SC2034  # Output consumed by scripts that source this Module.
      PRODUCTION_PREVIOUS_TARGET="$pointer_target"
    fi
  done
}

production_commit_release_state() {
  local install_root="$1"
  local current_target="$2"
  local previous_target="${3:-}"
  local states_root="$install_root/shared/release-states"
  local state_directory
  local state_name
  local temporary_link="$install_root/.release-state.$$"
  local anchor
  local anchor_target

  [[ "$current_target" =~ ^releases/[0-9a-f]{40}$ ]] || production_state_fail \
    "Current release target is invalid" || return 1
  if [[ -n "$previous_target" ]]; then
    [[ "$previous_target" =~ ^releases/[0-9a-f]{40}$ ]] || production_state_fail \
      "Previous release target is invalid" || return 1
  fi
  production_read_release_state "$install_root"

  [[ ! -L "$states_root" ]] || production_state_fail "Release states directory is invalid" || return 1
  install -d -m 0700 "$states_root"
  state_directory="$(mktemp -d "$states_root/.state.XXXXXX")"
  chmod 0700 "$state_directory"
  ln -s "../../../$current_target" "$state_directory/current"
  if [[ -n "$previous_target" ]]; then
    ln -s "../../../$previous_target" "$state_directory/previous"
  fi
  state_name="${state_directory##*/}"

  for anchor in current previous; do
    anchor_target="release-state/$anchor"
    if [[ ! -e "$install_root/$anchor" && ! -L "$install_root/$anchor" ]]; then
      ln -s "$anchor_target" "$install_root/$anchor"
    else
      [[ -L "$install_root/$anchor" && "$(readlink "$install_root/$anchor")" == "$anchor_target" ]] || \
        production_state_fail "Release pointer anchor is invalid" || return 1
    fi
  done

  [[ ! -e "$temporary_link" && ! -L "$temporary_link" ]] || production_state_fail \
    "Temporary release state pointer already exists" || return 1
  ln -s "shared/release-states/$state_name" "$temporary_link"
  if ! production_durable_replace_release_state \
    "$state_directory" \
    "$states_root" \
    "$temporary_link" \
    "$install_root/release-state" \
    "$install_root"; then
    rm -f -- "$temporary_link"
    return 1
  fi
}
