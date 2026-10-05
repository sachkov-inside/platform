#!/usr/bin/env bash
# Plans Telegram ordinals from frozen legacy v1..v5 and platform telegram-v6 onward.
# Run from the repository root.
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${REQUESTED_VERSION:?REQUESTED_VERSION is required}"
: "${SOURCE_SHA:?SOURCE_SHA is required}"

[[ "$GITHUB_REPOSITORY" == sachkov-inside/platform ]]
bash scripts/check-release-immutability.sh
unset RELEASE_SETTINGS_READ_TOKEN

legacy_repository=sachkov-inside/inside-telegram
legacy_tags="$(gh api --paginate --slurp "repos/$legacy_repository/tags?per_page=100" | jq '[.[][] | .name]')"
legacy_releases="$(gh api --paginate --slurp "repos/$legacy_repository/releases?per_page=100" | jq '[.[][] | select(.draft == false and .prerelease == false) | {version: .tag_name, immutable, targetCommitish: .target_commitish, assets: [.assets[].name]}]')"

current_main_sha="$(
  gh api "repos/${GITHUB_REPOSITORY}/git/ref/heads/main" --jq .object.sha
)"
existing_tags="$(
  gh api --paginate --slurp "repos/${GITHUB_REPOSITORY}/tags?per_page=100" |
    jq '[.[][] | .name]'
)"
existing_releases="$(
  gh api --paginate --slurp "repos/${GITHUB_REPOSITORY}/releases?per_page=100" |
    jq '[.[][] | select(.draft == false and .prerelease == false) | {
      version: .tag_name,
      immutable,
      targetCommitish: .target_commitish,
      assets: [.assets[].name]
    }]'
)"

jq --null-input \
  --arg requestedVersion "$REQUESTED_VERSION" \
  --arg sourceSha "$SOURCE_SHA" \
  --arg currentMainSha "$current_main_sha" \
  --argjson legacyTags "$legacy_tags" \
  --argjson legacyReleases "$legacy_releases" \
  --argjson existingTags "$existing_tags" \
  --argjson existingReleases "$existing_releases" \
  '{
    requestedVersion: $requestedVersion,
    sourceSha: $sourceSha,
    currentMainSha: $currentMainSha,
    legacyTags: $legacyTags,
    legacyReleases: $legacyReleases,
    existingTags: $existingTags,
    existingReleases: $existingReleases
  }' |
  node apps/telegram/scripts/release-contract.mjs plan
