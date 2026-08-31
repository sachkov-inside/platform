#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=production-path-contract.sh
source "$repository_root/scripts/production-path-contract.sh"

fail() {
  echo "$1" >&2
  exit 1
}

if (($# != 8)); then
  fail "Usage: $0 <install-root> <source-revision> <api-digest> <web-digest> <host> <user> <private-key> <known-hosts>"
fi

install_root="$1"
source_revision="$2"
api_workflow_digest="$3"
web_workflow_digest="$4"
deploy_host="$5"
deploy_user="$6"
private_key="$7"
known_hosts="$8"
deploy_attempt="${PLATFORM_DEPLOY_ATTEMPT:-}"

production_require_canonical_absolute_path "$install_root" "Install root"
[[ "$install_root" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "Install root contains unsafe characters"
[[ "$source_revision" =~ ^[0-9a-f]{40}$ && ! "$source_revision" =~ ^0+$ ]] || \
  fail "Source revision must be a non-placeholder full Git commit SHA"
[[ "$deploy_host" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || \
  fail "Deployment host is invalid"
[[ "$deploy_host" != *".."* ]] || fail "Deployment host is invalid"
[[ "$deploy_user" =~ ^[a-z_][a-z0-9_-]*$ ]] || fail "Deployment user is invalid"
[[ "$deploy_attempt" =~ ^[0-9]+-[0-9]+$ ]] || fail "Deployment attempt identifier is invalid"
[[ -f "$private_key" && ! -L "$private_key" ]] || fail "SSH private key file is invalid"
[[ -s "$known_hosts" && -f "$known_hosts" && ! -L "$known_hosts" ]] || \
  fail "SSH known-hosts file is invalid"

file_mode() {
  local path="$1"

  if stat -c '%a' "$path" >/dev/null 2>&1; then
    stat -c '%a' "$path"
  else
    stat -f '%Lp' "$path"
  fi
}

[[ "$(file_mode "$private_key")" == "600" ]] || fail "SSH private key must have mode 0600"
known_hosts_mode="$(file_mode "$known_hosts")"
if ((8#$known_hosts_mode & 0022)); then
  fail "SSH known-hosts file must not be group- or world-writable"
fi

temporary_root="$(mktemp -d)"
bundle_root="$temporary_root/release"
remote_staging="$install_root/releases/.incoming-$source_revision-$deploy_attempt"
remote_destination="$deploy_user@$deploy_host"
remote_created=0

ssh_options=(
  -i "$private_key"
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$known_hosts"
)

cleanup() {
  local task_status=$?
  trap - EXIT
  if ((remote_created == 1)); then
    # All interpolated remote values pass strict allowlists above.
    # shellcheck disable=SC2029
    ssh "${ssh_options[@]}" "$remote_destination" \
      "rm -rf -- '$remote_staging'" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$temporary_root"
  exit "$task_status"
}
trap cleanup EXIT

install -d -m 0750 "$bundle_root/scripts"
install -m 0640 \
  "$repository_root/Caddyfile" \
  "$repository_root/compose.production.yaml" \
  "$bundle_root/"
install -m 0750 \
  "$repository_root/scripts/deploy-production-release.sh" \
  "$repository_root/scripts/install-production-release.sh" \
  "$repository_root/scripts/production-deployment-state.sh" \
  "$repository_root/scripts/production-path-contract.sh" \
  "$repository_root/scripts/provision-production-database-roles.sh" \
  "$repository_root/scripts/rollback-production-release.sh" \
  "$repository_root/scripts/run-with-production-deploy-lock.sh" \
  "$repository_root/scripts/validate-production-host.sh" \
  "$bundle_root/scripts/"
bash "$repository_root/scripts/render-production-release-env.sh" \
  "$source_revision" \
  "$api_workflow_digest" \
  "$web_workflow_digest" > "$bundle_root/release.env"
chmod 0640 "$bundle_root/release.env"

# All interpolated remote values pass strict allowlists above.
# shellcheck disable=SC2029
ssh "${ssh_options[@]}" "$remote_destination" \
  "install -d -m 0700 '$remote_staging'"
remote_created=1
scp "${ssh_options[@]}" -r "$bundle_root/." "$remote_destination:$remote_staging/"
# shellcheck disable=SC2029
ssh "${ssh_options[@]}" "$remote_destination" \
  "bash '$remote_staging/scripts/install-production-release.sh' '$install_root' '$source_revision' '$remote_staging'"

echo "Production release $source_revision passed remote deployment"
