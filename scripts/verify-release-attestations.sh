#!/usr/bin/env bash
set -euo pipefail

image_reference="${1:-}"
source_sha="${2:-}"
if [[ -z "$image_reference" || -z "$source_sha" ]]; then
  echo "usage: verify-release-attestations.sh <image@sha256:digest> <source-sha>" >&2
  exit 1
fi
: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

for predicate_type in \
  https://slsa.dev/provenance/v1 \
  https://spdx.dev/Document/v2.3; do
  gh attestation verify "oci://${image_reference}" \
    --repo "$GITHUB_REPOSITORY" \
    --signer-workflow "$GITHUB_REPOSITORY/.github/workflows/build-release-images.yml" \
    --source-digest "$source_sha" \
    --source-ref refs/heads/main \
    --predicate-type "$predicate_type" \
    >/dev/null
done
