#!/usr/bin/env bash
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${REQUESTED_VERSION:?REQUESTED_VERSION is required}"
: "${SOURCE_SHA:?SOURCE_SHA is required}"

immutable_enabled="$(
  gh api \
    --header "X-GitHub-Api-Version: 2026-03-10" \
    "repos/${GITHUB_REPOSITORY}/immutable-releases" \
    --jq .enabled
)"
if [[ "$immutable_enabled" != "true" ]]; then
  echo "Repository release immutability must be enabled before publication." >&2
  exit 1
fi

current_main_sha="$(
  gh api "repos/${GITHUB_REPOSITORY}/git/ref/heads/main" --jq .object.sha
)"
existing_tags="$(
  gh api --paginate --slurp \
    --header "X-GitHub-Api-Version: 2026-03-10" \
    "repos/${GITHUB_REPOSITORY}/tags?per_page=100" |
    jq '[.[][] | .name]'
)"
existing_releases="$(
  gh api --paginate --slurp \
    --header "X-GitHub-Api-Version: 2026-03-10" \
    "repos/${GITHUB_REPOSITORY}/releases?per_page=100" |
    jq '[.[][] | select(.draft == false) | {
      version: .tag_name,
      immutable,
      assets: [.assets[].name]
    }]'
)"

jq --null-input \
  --arg requestedVersion "$REQUESTED_VERSION" \
  --arg sourceSha "$SOURCE_SHA" \
  --arg currentMainSha "$current_main_sha" \
  --argjson existingTags "$existing_tags" \
  --argjson existingReleases "$existing_releases" \
  '{requestedVersion, sourceSha, currentMainSha, existingTags, existingReleases}' |
  node scripts/release-contract.mjs plan --input -
