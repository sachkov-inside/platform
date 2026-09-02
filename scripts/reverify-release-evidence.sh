#!/usr/bin/env bash
set -euo pipefail

kind="${1:-}"
asset_directory="${2:-}"
if [[ "$kind" != "backend" && "$kind" != "web" ]]; then
  echo "usage: reverify-release-evidence.sh <backend|web> <asset-directory>" >&2
  exit 1
fi
if [[ -z "$asset_directory" ]]; then
  echo "release asset directory is required" >&2
  exit 1
fi
: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

evidence_path="${asset_directory}/${kind}.evidence.json"
provenance_bundle_path="${asset_directory}/${kind}.provenance.bundle.json"
sbom_bundle_path="${asset_directory}/${kind}.sbom.bundle.json"
sbom_path="${asset_directory}/${kind}.sbom.spdx.json"
vulnerability_path="${asset_directory}/${kind}.vulnerabilities.json"

jq --null-input \
  --arg evidencePath "$evidence_path" \
  --arg provenanceBundlePath "$provenance_bundle_path" \
  --arg sbomBundlePath "$sbom_bundle_path" \
  --arg sbomPath "$sbom_path" \
  --arg vulnerabilityPath "$vulnerability_path" \
  '{evidencePath, provenanceBundlePath, sbomBundlePath, sbomPath, vulnerabilityPath}' |
  node scripts/release-contract.mjs assets --input - >/dev/null

image_name="$(jq --raw-output .image.name "$evidence_path")"
image_digest="$(jq --raw-output .image.digest "$evidence_path")"
source_sha="$(jq --raw-output .sourceSha "$evidence_path")"
temporary_directory="$(mktemp -d "${RUNNER_TEMP:-/tmp}/release-evidence.XXXXXX")"
cleanup() {
  rm -rf "$temporary_directory"
}
trap cleanup EXIT

gh attestation verify "oci://${image_name}@${image_digest}" \
  --bundle "$provenance_bundle_path" \
  --repo "$GITHUB_REPOSITORY" \
  --signer-workflow "$GITHUB_REPOSITORY/.github/workflows/build-release-images.yml" \
  --source-digest "$source_sha" \
  --source-ref refs/heads/main \
  --format json \
  >"$temporary_directory/provenance.verification.json"
gh attestation verify "oci://${image_name}@${image_digest}" \
  --bundle "$sbom_bundle_path" \
  --repo "$GITHUB_REPOSITORY" \
  --signer-workflow "$GITHUB_REPOSITORY/.github/workflows/build-release-images.yml" \
  --source-digest "$source_sha" \
  --source-ref refs/heads/main \
  --predicate-type https://spdx.dev/Document/v2.3 \
  --format json \
  >"$temporary_directory/sbom.verification.json"

jq \
  --arg sbomPath "$sbom_path" \
  --arg vulnerabilityPath "$vulnerability_path" \
  --arg provenanceBundlePath "$provenance_bundle_path" \
  --arg provenanceVerificationPath "$temporary_directory/provenance.verification.json" \
  --arg sbomBundlePath "$sbom_bundle_path" \
  --arg sbomVerificationPath "$temporary_directory/sbom.verification.json" \
  '{
    image,
    sourceSha,
    $sbomPath,
    $vulnerabilityPath,
    $provenanceBundlePath,
    $provenanceVerificationPath,
    provenanceAttestation: .provenance.attestation,
    $sbomBundlePath,
    $sbomVerificationPath,
    sbomAttestation: .sbom.attestation,
    waiver: .vulnerabilities.waiver
  }' "$evidence_path" |
  node scripts/release-contract.mjs evidence --input - \
    >"$temporary_directory/reverified.evidence.json"

jq --sort-keys . "$evidence_path" >"$temporary_directory/expected.json"
jq --sort-keys . "$temporary_directory/reverified.evidence.json" \
  >"$temporary_directory/actual.json"
if ! cmp -s \
  "$temporary_directory/expected.json" \
  "$temporary_directory/actual.json"; then
  echo "Downloaded ${kind} evidence changed after initial verification." >&2
  diff --unified \
    "$temporary_directory/expected.json" \
    "$temporary_directory/actual.json" >&2 || true
  exit 1
fi
