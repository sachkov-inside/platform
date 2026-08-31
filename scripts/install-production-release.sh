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

if (($# != 3)); then
  fail "Usage: $0 <install-root> <source-revision> <staging-directory>"
fi

install_root="$1"
source_revision="$2"
staging_directory="$3"
release_directory="$install_root/releases/$source_revision"

production_require_canonical_directory "$install_root" "Install root"
[[ "$source_revision" =~ ^[0-9a-f]{40}$ && ! "$source_revision" =~ ^0+$ ]] || \
  fail "Source revision must be a non-placeholder full Git commit SHA"
[[ -d "$install_root/releases" && ! -L "$install_root/releases" ]] || \
  fail "Production releases directory is invalid"

staging_prefix="$install_root/releases/.incoming-$source_revision-"
staging_attempt="${staging_directory#"$staging_prefix"}"
[[ "$staging_directory" != "$staging_attempt" && "$staging_attempt" =~ ^[0-9]+-[0-9]+$ ]] || \
  fail "Staging directory does not match the selected release"
workflow_run_number="${staging_attempt%%-*}"
[[ "$workflow_run_number" =~ ^[1-9][0-9]{0,29}$ ]] || fail "Workflow run number is invalid"
[[ -d "$staging_directory" && ! -L "$staging_directory" ]] || \
  fail "Staging directory is invalid"
[[ -d "$staging_directory/scripts" && ! -L "$staging_directory/scripts" ]] || \
  fail "Release bundle scripts directory is invalid"
expected_script_directory="$(cd "$staging_directory/scripts" && pwd -P)"
[[ "$script_directory" == "$expected_script_directory" ]] || \
  fail "Installer must run from the selected staging directory"

expected_files=(
  Caddyfile
  compose.production.yaml
  release.env
  scripts/deploy-production-release.sh
  scripts/install-production-release.sh
  scripts/production-deployment-state.sh
  scripts/production-path-contract.sh
  scripts/provision-production-database-roles.sh
  scripts/rollback-production-release.sh
  scripts/run-with-production-deploy-lock.sh
  scripts/validate-production-host.sh
)
for relative_path in "${expected_files[@]}"; do
  [[ -f "$staging_directory/$relative_path" && ! -L "$staging_directory/$relative_path" ]] || \
    fail "Release bundle is missing a required regular file"
done

file_count="$(find "$staging_directory" -type f | wc -l | tr -d '[:space:]')"
directory_count="$(find "$staging_directory" -type d | wc -l | tr -d '[:space:]')"
unsupported_count="$(
  find "$staging_directory" ! -type d ! -type f | wc -l | tr -d '[:space:]'
)"
[[ "$file_count" == "${#expected_files[@]}" && "$directory_count" == "2" && "$unsupported_count" == "0" ]] || \
  fail "Release bundle contains unsupported entries"

chmod 0750 "$staging_directory" "$staging_directory/scripts"
chmod 0640 \
  "$staging_directory/Caddyfile" \
  "$staging_directory/compose.production.yaml" \
  "$staging_directory/release.env"
chmod 0750 "$staging_directory"/scripts/*.sh

if [[ -e "$release_directory" || -L "$release_directory" ]]; then
  [[ -d "$release_directory" && ! -L "$release_directory" ]] || \
    fail "Existing release path is invalid"
  diff --brief --recursive "$staging_directory" "$release_directory" >/dev/null || \
    fail "Existing release differs from the uploaded bundle"
  rm -rf -- "$staging_directory"
else
  production_durable_install_release "$staging_directory" "$release_directory"
fi

bash "$release_directory/scripts/deploy-production-release.sh" \
  "$install_root" \
  "$source_revision" \
  "$workflow_run_number"
