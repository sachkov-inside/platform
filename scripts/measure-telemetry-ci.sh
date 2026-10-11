#!/usr/bin/env bash
set -euo pipefail

task_artifact_dir="${1:?resource evidence directory is required}"
mkdir -p "$task_artifact_dir"
git rev-parse HEAD >"$task_artifact_dir/source-sha.txt"
docker info --format '{{.Driver}}' >"$task_artifact_dir/docker-driver.txt"
# pipefail preserves a rejected resource budget even when tee successfully saves the evidence.
pnpm telemetry:measure 2>&1 | tee "$task_artifact_dir/telemetry-resource.log"
