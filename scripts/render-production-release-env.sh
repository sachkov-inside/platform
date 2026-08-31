#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--" ]]; then
  shift
fi
if (($# != 3)); then
  echo "Usage: $0 <source-revision> <api-workflow-digest> <web-workflow-digest>" >&2
  exit 1
fi

source_revision="$1"
api_workflow_digest="$2"
web_workflow_digest="$3"

if [[ ! "$source_revision" =~ ^[0-9a-f]{40}$ || "$source_revision" =~ ^0+$ ]]; then
  echo "Source revision must be a non-placeholder full Git commit SHA" >&2
  exit 1
fi

workflow_digest_value() {
  local workflow_digest="$1"

  if [[ ! "$workflow_digest" =~ ^sha256:[0-9a-f]{64}$ || "$workflow_digest" =~ ^sha256:0+$ ]]; then
    echo "Workflow digest must have the form sha256:<64 lowercase hex characters>" >&2
    exit 1
  fi
  printf '%s' "${workflow_digest#sha256:}"
}

api_digest="$(workflow_digest_value "$api_workflow_digest")"
web_digest="$(workflow_digest_value "$web_workflow_digest")"

printf '%s\n' \
  "SOURCE_REVISION=$source_revision" \
  "PLATFORM_API_IMAGE_REPOSITORY=ghcr.io/sachkov-inside/platform-api" \
  "PLATFORM_API_IMAGE_DIGEST=$api_digest" \
  "PLATFORM_MIGRATION_IMAGE_REPOSITORY=ghcr.io/sachkov-inside/platform-api" \
  "PLATFORM_MIGRATION_IMAGE_DIGEST=$api_digest" \
  "PLATFORM_WEB_IMAGE_REPOSITORY=ghcr.io/sachkov-inside/platform-web" \
  "PLATFORM_WEB_IMAGE_DIGEST=$web_digest"
