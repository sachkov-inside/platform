#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=production-path-contract.sh
source "$script_directory/production-path-contract.sh"
# shellcheck source=production-deployment-state.sh
source "$script_directory/production-deployment-state.sh"

fail() {
  echo "$1" >&2
  exit 1
}

if (($# != 2)) || [[ "$2" != "--acknowledge-forward-schema-compatible" ]]; then
  fail "Usage: $0 <install-root> --acknowledge-forward-schema-compatible"
fi

install_root="$1"

production_require_canonical_directory "$install_root" "Install root"
[[ -d "$install_root/shared" && ! -L "$install_root/shared" ]] || \
  fail "Shared production directory is invalid"

if [[ -z "${PLATFORM_DEPLOY_LOCK_FD:-}" ]]; then
  exec bash "$script_directory/run-with-production-deploy-lock.sh" \
    "$install_root" \
    bash "$0" "$@"
fi
production_require_deploy_lock "$install_root"

value_of() {
  local path="$1"
  local key="$2"
  local line

  line="$(grep -E "^${key}=" "$path")"
  printf '%s' "${line#*=}"
}

production_read_release_state "$install_root"
current_target="$PRODUCTION_CURRENT_TARGET"
rollback_target="$PRODUCTION_PREVIOUS_TARGET"
[[ -n "$current_target" ]] || fail "Current release pointer is missing"
[[ -n "$rollback_target" ]] || fail "Previous release pointer is missing"
rollback_release="$install_root/$rollback_target"
rollback_revision="${rollback_target#releases/}"
rollback_environment="$rollback_release/release.env"

[[ -f "$rollback_environment" && ! -L "$rollback_environment" ]] || \
  fail "Previous release metadata is invalid"
[[ -x "$rollback_release/scripts/deploy-production-release.sh" ]] || \
  fail "Previous release does not contain the deployment contract"

production_read_latest_migration "$install_root"
migration_repository="$PRODUCTION_MIGRATION_REPOSITORY"
migration_digest="$PRODUCTION_MIGRATION_DIGEST"
candidate_environment="$(mktemp "$rollback_release/release.env.rollback.XXXXXX")"
cleanup() {
  if [[ -e "$candidate_environment" ]]; then
    rm -f "$candidate_environment"
  fi
}
trap cleanup EXIT

awk \
  -v migration_repository="$migration_repository" \
  -v migration_digest="$migration_digest" \
  '
    /^PLATFORM_MIGRATION_IMAGE_REPOSITORY=/ {
      print "PLATFORM_MIGRATION_IMAGE_REPOSITORY=" migration_repository
      next
    }
    /^PLATFORM_MIGRATION_IMAGE_DIGEST=/ {
      print "PLATFORM_MIGRATION_IMAGE_DIGEST=" migration_digest
      next
    }
    { print }
  ' \
  "$rollback_environment" > "$candidate_environment"
chmod 0640 "$candidate_environment"

bash "$rollback_release/scripts/deploy-production-release.sh" \
  "$install_root" \
  "$rollback_revision" \
  rollback \
  "$candidate_environment"

echo "Production rollback to $rollback_revision completed"
