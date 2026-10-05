#!/usr/bin/env bash
# Shared prepublication setting check; no credential reaches history, build or publish.
set -euo pipefail
: "${RELEASE_SETTINGS_READ_TOKEN:?RELEASE_SETTINGS_READ_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

# GitHub requires Administration: read here; GITHUB_TOKEN cannot request that permission.
# Do not inherit the settings credential into the remaining release commands.
settings_token="$RELEASE_SETTINGS_READ_TOKEN"
unset RELEASE_SETTINGS_READ_TOKEN
immutable_enabled="$(
  GH_TOKEN="$settings_token" gh api \
    --header "X-GitHub-Api-Version: 2026-03-10" \
    "repos/${GITHUB_REPOSITORY}/immutable-releases" \
    --jq .enabled
)"
unset settings_token
if [[ "$immutable_enabled" != "true" ]]; then
  echo "Repository release immutability must be enabled before publication." >&2
  exit 1
fi

