#!/usr/bin/env bash
# GitHub binds workflow_dispatch to main at command acceptance, independently of later main.
set -euo pipefail
: "${GH_TOKEN:?}"
: "${GITHUB_REPOSITORY:?}"
: "${GITHUB_RUN_ID:?}"
: "${SOURCE_SHA:?}"
gh api "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" |
  jq --exit-status --raw-output --arg repository "$GITHUB_REPOSITORY" --arg sha "$SOURCE_SHA" '
    select(.repository.full_name == $repository and .event == "workflow_dispatch" and
      .head_branch == "main" and .head_sha == $sha and
      (.path == ".github/workflows/release.yml" or .path == ".github/workflows/telegram-release.yml")) |
    .head_sha'
