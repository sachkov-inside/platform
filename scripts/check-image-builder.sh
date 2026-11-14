#!/usr/bin/env bash
set -euo pipefail
: "${EXPECTED_BUILDX_VERSION:?Expected Buildx version is required}"
actual="$(docker buildx version)"
if [[ "$actual" != "github.com/docker/buildx $EXPECTED_BUILDX_VERSION "* ]]; then
  echo 'Active Buildx differs from the selected toolchain' >&2
  exit 1
fi
: "${EXPECTED_BUILDKIT_VERSION:?Expected BuildKit version is required}"
versions="$(docker buildx inspect --bootstrap | awk '$1 == "BuildKit" && $2 == "version:" {print $3}')"
if [[ "$versions" != "$EXPECTED_BUILDKIT_VERSION" ]]; then
  echo 'Active BuildKit differs from the selected toolchain' >&2
  exit 1
fi
printf 'Active Buildx: %s\nActive BuildKit: %s\n' "$actual" "$versions"
