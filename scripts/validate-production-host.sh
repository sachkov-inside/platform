#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${1:-}" == "--" ]]; then
  shift
fi
if (($# != 2)); then
  echo "Usage: $0 <runtime-env> <release-env>" >&2
  exit 1
fi

runtime_environment="$1"
release_environment="$2"
runtime_keys=(
  PLATFORM_COMPOSE_PROJECT
  PLATFORM_DOMAIN
  POSTGRES_DB
  POSTGRES_USER
  POSTGRES_PASSWORD
  MIGRATION_DATABASE_USER
  MIGRATION_DATABASE_PASSWORD
  APPLICATION_DATABASE_USER
  APPLICATION_DATABASE_PASSWORD
  MIGRATION_DATABASE_URL
  DATABASE_URL
  LOGTO_ISSUER
  LOGTO_ENDPOINT
  LOGTO_AUDIENCE
  LOGTO_JWKS_URL
  LOGTO_APP_ID
  LOGTO_APP_SECRET
  LOGTO_COOKIE_SECRET
  IDENTITY_EMAIL_FINGERPRINT_KEY
  MEMBERSHIP_ACQUISITION_URL
  TELEGRAM_BOT_START_URL
  TELEGRAM_LINKING_ENDPOINT
  TELEGRAM_LINKING_SECRET
  TELEGRAM_EVIDENCE_INGRESS_SECRET
  TELEGRAM_LINK_LIFETIME_SECONDS
  WEB_BASE_URL
)
release_keys=(
  SOURCE_REVISION
  PLATFORM_API_IMAGE_REPOSITORY
  PLATFORM_API_IMAGE_DIGEST
  PLATFORM_MIGRATION_IMAGE_REPOSITORY
  PLATFORM_MIGRATION_IMAGE_DIGEST
  PLATFORM_WEB_IMAGE_REPOSITORY
  PLATFORM_WEB_IMAGE_DIGEST
)

validate_regular_file() {
  local path="$1"
  local label="$2"
  local component
  local current_path=""
  local -a path_components

  if [[ "$path" != /* ]]; then
    echo "$label path must be absolute" >&2
    exit 1
  fi
  IFS='/' read -r -a path_components <<< "${path#/}"
  for component in "${path_components[@]}"; do
    if [[ -z "$component" || "$component" == "." || "$component" == ".." ]]; then
      echo "$label path must be canonical" >&2
      exit 1
    fi
    current_path="$current_path/$component"
    if [[ -L "$current_path" ]]; then
      echo "$label path must not contain a symbolic link" >&2
      exit 1
    fi
  done

  if [[ -L "$path" || ! -f "$path" ]]; then
    echo "$label must be a regular non-symbolic-link file" >&2
    exit 1
  fi
}

file_mode() {
  local path="$1"

  if stat -c '%a' "$path" >/dev/null 2>&1; then
    stat -c '%a' "$path"
  else
    stat -f '%Lp' "$path"
  fi
}

value_of() {
  local path="$1"
  local key="$2"
  local line

  line="$(grep -E "^${key}=" "$path")"
  printf '%s' "${line#*=}"
}

validate_keys() {
  local path="$1"
  shift
  local key
  local count
  local value

  for key in "$@"; do
    count="$(grep -c -E "^${key}=" "$path" || true)"
    if [[ "$count" != "1" ]]; then
      echo "Configuration key $key is missing or duplicated" >&2
      exit 1
    fi
    value="$(value_of "$path" "$key")"
    if [[ -z "$value" ]]; then
      echo "Configuration key $key is empty" >&2
      exit 1
    fi
  done
}

validate_allowed_keys() {
  local path="$1"
  local label="$2"
  shift 2
  local line
  local key
  local expected_key
  local supported

  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ -z "$line" || "$line" == \#* ]]; then
      continue
    fi
    if [[ "$line" != *=* ]]; then
      echo "$label contains an invalid line" >&2
      exit 1
    fi
    key="${line%%=*}"
    supported=0
    for expected_key in "$@"; do
      if [[ "$key" == "$expected_key" ]]; then
        supported=1
        break
      fi
    done
    if ((supported == 0)); then
      echo "$label contains an unsupported key" >&2
      exit 1
    fi
  done < "$path"
}

validate_regular_file "$runtime_environment" "Runtime environment"
validate_regular_file "$release_environment" "Release environment"

runtime_mode="$(file_mode "$runtime_environment")"
if [[ "$runtime_mode" != "600" ]]; then
  echo "Runtime environment must have mode 0600" >&2
  exit 1
fi

release_mode="$(file_mode "$release_environment")"
if ((8#$release_mode & 0022)); then
  echo "Release environment must not be group- or world-writable" >&2
  exit 1
fi

validate_allowed_keys "$runtime_environment" "Runtime environment" "${runtime_keys[@]}"
validate_allowed_keys "$release_environment" "Release environment" "${release_keys[@]}"
validate_keys "$runtime_environment" "${runtime_keys[@]}"
validate_keys "$release_environment" "${release_keys[@]}"

if grep -Eq 'replace-with|replace_with|example\.com' "$runtime_environment"; then
  echo "Runtime environment still contains a tracked placeholder" >&2
  exit 1
fi

source_revision="$(value_of "$release_environment" SOURCE_REVISION)"
if [[ ! "$source_revision" =~ ^[0-9a-f]{40}$ || "$source_revision" =~ ^0+$ ]]; then
  echo "SOURCE_REVISION must be a non-placeholder full Git commit SHA" >&2
  exit 1
fi

for key in \
  PLATFORM_API_IMAGE_REPOSITORY \
  PLATFORM_MIGRATION_IMAGE_REPOSITORY \
  PLATFORM_WEB_IMAGE_REPOSITORY; do
  case "$key" in
    PLATFORM_API_IMAGE_REPOSITORY | PLATFORM_MIGRATION_IMAGE_REPOSITORY)
      expected_repository=ghcr.io/sachkov-inside/platform-api
      ;;
    PLATFORM_WEB_IMAGE_REPOSITORY)
      expected_repository=ghcr.io/sachkov-inside/platform-web
      ;;
  esac
  if [[ "$(value_of "$release_environment" "$key")" != "$expected_repository" ]]; then
    echo "$key must use the canonical GHCR repository" >&2
    exit 1
  fi
done

for key in \
  PLATFORM_API_IMAGE_DIGEST \
  PLATFORM_MIGRATION_IMAGE_DIGEST \
  PLATFORM_WEB_IMAGE_DIGEST; do
  digest="$(value_of "$release_environment" "$key")"
  if [[ ! "$digest" =~ ^[0-9a-f]{64}$ || "$digest" =~ ^0+$ ]]; then
    echo "$key must be a non-placeholder SHA-256 digest" >&2
    exit 1
  fi
done

for key in "${runtime_keys[@]}" "${release_keys[@]}"; do
  unset "$key"
done

compose_path="${PATH:-/usr/local/bin:/usr/bin:/bin}"
compose_home="${HOME:-/}"
if ! env -i PATH="$compose_path" HOME="$compose_home" docker compose \
  --env-file "$runtime_environment" \
  --env-file "$release_environment" \
  --file "$repository_root/compose.production.yaml" \
  config --quiet >/dev/null 2>&1; then
  echo "Production Compose configuration is invalid" >&2
  exit 1
fi

echo "Production host contract is valid"
