#!/usr/bin/env bash
# Read-only provider lookup. Whole-tree equality conservatively binds all significant inputs.
set -euo pipefail
: "${GITHUB_REPOSITORY:?}"
: "${SOURCE_SHA:?}"
: "${RELEASE_APPLICATION:?}"
: "${GH_TOKEN:?}"
evidence_dir="$(mktemp -d)"
trap 'rm -rf "$evidence_dir"' EXIT
required="$(node scripts/release-source-evidence.mjs requirements)"
source_tree="$(git rev-parse "${SOURCE_SHA}^{tree}")"
echo '[]' >"$evidence_dir/candidates.json"
# Bounded lookup: older or expired evidence becomes explicit missing coverage.
if gh api "repos/$GITHUB_REPOSITORY/actions/workflows/ci.yml/runs?status=success&per_page=30" >"$evidence_dir/runs.json"; then
  jq -c '.workflow_runs[] | select(.event == "merge_group" or (.event == "push" and .head_branch == "main"))' "$evidence_dir/runs.json" >"$evidence_dir/runs.jsonl"
  while IFS= read -r run; do
    run_id="$(jq -r .id <<<"$run")"
    run_sha="$(jq -r .head_sha <<<"$run")"
    run_attempt="$(jq -r .run_attempt <<<"$run")"
    if ! gh api "repos/$GITHUB_REPOSITORY/git/commits/$run_sha" >"$evidence_dir/commit.json"; then continue; fi
    run_tree="$(jq -r .tree.sha "$evidence_dir/commit.json")"
    [[ "$run_tree" == "$source_tree" ]] || continue
    if ! gh api --paginate --slurp "repos/$GITHUB_REPOSITORY/actions/runs/$run_id/attempts/$run_attempt/jobs?per_page=100" >"$evidence_dir/jobs.json"; then continue; fi
    if ! jq '[.[] | .jobs[]]' "$evidence_dir/jobs.json" >"$evidence_dir/provider-jobs.json"; then continue; fi
    if ! gh api "repos/$GITHUB_REPOSITORY/actions/runs/$run_id/artifacts" >"$evidence_dir/artifacts.json"; then continue; fi
    artifact_name="ci-source-evidence-${run_attempt}"
    artifact_id="$(jq -r --arg name "$artifact_name" '[.artifacts[] | select(.name == $name and .expired == false)] | if length == 1 then .[0].id else empty end' "$evidence_dir/artifacts.json")"
    [[ -n "$artifact_id" ]] || continue
    if ! gh api "repos/$GITHUB_REPOSITORY/actions/artifacts/$artifact_id/zip" >"$evidence_dir/evidence.zip"; then continue; fi
    if ! unzip -p "$evidence_dir/evidence.zip" source-evidence.json >"$evidence_dir/evidence.json"; then continue; fi
    if ! jq --argjson provider "$run" --arg tree "$run_tree" --arg artifact "$artifact_name" --slurpfile jobs "$evidence_dir/provider-jobs.json" --slurpfile evidence "$evidence_dir/evidence.json" '. + [{provider: $provider, providerArtifactName: $artifact, providerJobs: $jobs[0], providerTreeSha: $tree, evidence: $evidence[0]}]' "$evidence_dir/candidates.json" >"$evidence_dir/next.json"; then continue; fi
    mv "$evidence_dir/next.json" "$evidence_dir/candidates.json"
  done <"$evidence_dir/runs.jsonl"
fi
jq -n --arg repository "$GITHUB_REPOSITORY" --arg source "$SOURCE_SHA" --arg tree "$source_tree" --argjson required "$required" --slurpfile candidates "$evidence_dir/candidates.json" '{repository: $repository, sourceSha: $source, treeSha: $tree, requiredCoverage: $required, candidates: $candidates[0]}' >"$evidence_dir/input.json"
node scripts/release-source-evidence.mjs "$evidence_dir/input.json"
