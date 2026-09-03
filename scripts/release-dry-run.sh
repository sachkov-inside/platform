#!/usr/bin/env bash
set -euo pipefail

node --test scripts/release-*.test.mjs
pnpm release:images:smoke

echo "Release dry-run passed without publishing packages or a GitHub Release."
