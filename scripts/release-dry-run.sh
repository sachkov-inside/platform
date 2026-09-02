#!/usr/bin/env bash
set -euo pipefail

pnpm release:schema:check
node --test scripts/release-*.test.mjs
pnpm release:images:smoke

echo "Release dry-run passed without publishing packages, attestations or a GitHub Release."
