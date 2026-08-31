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

if (($# < 3 || $# > 4)); then
  fail "Usage: $0 <install-root> <source-revision> <workflow-run-number|rollback> [rollback-release-env]"
fi

install_root="$1"
source_revision="$2"
deployment_origin="$3"
release_directory="$install_root/releases/$source_revision"
runtime_environment="$install_root/shared/runtime.env"
release_environment="$release_directory/release.env"

if [[ "$deployment_origin" == "rollback" ]]; then
  (($# == 4)) || fail "Rollback deployment requires its candidate release environment"
  release_environment="$4"
else
  (($# == 3)) || fail "Workflow deployment does not accept an alternate release environment"
  [[ "$deployment_origin" =~ ^[1-9][0-9]{0,29}$ ]] || fail "Workflow run number is invalid"
fi

value_of() {
  local path="$1"
  local key="$2"
  local line

  line="$(grep -E "^${key}=" "$path")"
  printf '%s' "${line#*=}"
}

[[ "$source_revision" =~ ^[0-9a-f]{40}$ && ! "$source_revision" =~ ^0+$ ]] || \
  fail "Source revision must be a non-placeholder full Git commit SHA"
production_require_canonical_directory "$install_root" "Install root"
production_require_canonical_directory "$release_directory" "Release directory"

expected_release_directory="$(cd "$script_directory/.." && pwd -P)"
[[ "$expected_release_directory" == "$release_directory" ]] || \
  fail "Deployment script must run from the selected release directory"

if [[ "$deployment_origin" == "rollback" ]]; then
  rollback_environment_name="${release_environment##*/}"
  [[ "${release_environment%/*}" == "$release_directory" && \
     "$rollback_environment_name" =~ ^release\.env\.rollback\.[A-Za-z0-9]+$ ]] || \
    fail "Rollback release environment path is invalid"
  [[ -f "$release_environment" && ! -L "$release_environment" ]] || \
    fail "Rollback release environment must be a regular file"
fi

if [[ -z "${PLATFORM_DEPLOY_LOCK_FD:-}" ]]; then
  exec bash "$release_directory/scripts/run-with-production-deploy-lock.sh" \
    "$install_root" \
    bash "$0" "$@"
fi
production_require_deploy_lock "$install_root"

if [[ "$deployment_origin" != "rollback" ]]; then
  production_accept_workflow_run_number "$install_root" "$deployment_origin"
fi

bash "$release_directory/scripts/validate-production-host.sh" \
  "$runtime_environment" \
  "$release_environment"

[[ "$(value_of "$release_environment" SOURCE_REVISION)" == "$source_revision" ]] || \
  fail "Release environment revision does not match the selected release"

production_prepare_sanitized_environment
compose=(
  "${PRODUCTION_SANITIZED_ENVIRONMENT[@]}"
  docker compose
  --env-file "$runtime_environment"
  --env-file "$release_environment"
  --file "$release_directory/compose.production.yaml"
)

"${compose[@]}" pull
"${compose[@]}" up --detach --wait postgres
"${compose[@]}" run --rm --no-deps database-roles
production_record_latest_migration "$install_root" "$release_environment"
"${compose[@]}" run --rm --no-deps migrations
"${compose[@]}" run --rm --no-deps database-access
"${compose[@]}" up --detach --wait --no-deps api
"${compose[@]}" up --detach --wait --no-deps web
"${compose[@]}" up --detach --wait --no-deps caddy

api_health="$(
  "${compose[@]}" exec -T api node -e \
    "fetch('http://127.0.0.1:3001/health').then(async r=>{process.stdout.write(await r.text());if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
)"
[[ "$api_health" == '{"process":"api","status":"ok","database":"reachable"}' ]] || \
  fail "Production API health response is invalid"

for service in api web; do
  container_id="$("${compose[@]}" ps --quiet "$service")"
  [[ -n "$container_id" ]] || fail "Production $service container is missing"
  image_revision="$(
    "${PRODUCTION_SANITIZED_ENVIRONMENT[@]}" docker inspect \
      --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
      "$container_id"
  )"
  [[ "$image_revision" == "$source_revision" ]] || \
    fail "Production $service image revision does not match the release"
done

platform_domain="$(value_of "$runtime_environment" PLATFORM_DOMAIN)"
home_response="$(
  "${PRODUCTION_SANITIZED_ENVIRONMENT[@]}" curl \
    --fail \
    --retry 10 \
    --retry-connrefused \
    --silent \
    --show-error \
    "https://$platform_domain/"
)"
[[ "$home_response" == *"Sachkov Inside"* ]] || fail "Production HTTPS smoke response is invalid"

production_read_release_state "$install_root"
current_target="$PRODUCTION_CURRENT_TARGET"
candidate_target="releases/$source_revision"
if [[ "$current_target" != "$candidate_target" ]]; then
  production_commit_release_state "$install_root" "$candidate_target" "$current_target"
fi

echo "Production release $source_revision is current"
