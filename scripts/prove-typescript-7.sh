#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

typescript_version="7.0.2"
tsc=(pnpm --silent dlx --package "typescript@${typescript_version}" tsc)

pnpm --filter @inside/web exec next typegen >/dev/null
"${tsc[@]}" -p apps/backend/tsconfig.json --noEmit
"${tsc[@]}" -p apps/backend/tsconfig.build.json --noEmit
"${tsc[@]}" -p apps/backend/test/tsconfig.json --noEmit
"${tsc[@]}" -p apps/web/tsconfig.json --noEmit

negative_output="$(mktemp -t inside-platform-ts7-negative.XXXXXX)"
if "${tsc[@]}" -p apps/backend/test/guardrails/fixtures/typescript/tsconfig.json --noEmit >"$negative_output" 2>&1; then
  rm -f "$negative_output"
  echo "TypeScript 7 unexpectedly accepted the negative type fixture" >&2
  exit 1
fi
if ! grep --quiet 'error TS2322' "$negative_output"; then
  cat "$negative_output" >&2
  rm -f "$negative_output"
  echo "TypeScript 7 did not preserve the expected branded-ID diagnostic" >&2
  exit 1
fi
rm -f "$negative_output"

library_output="$(mktemp -t inside-platform-ts7-libraries.XXXXXX)"
expect_library_diagnostics() {
  local label="$1"
  local tsconfig="$2"
  local expected_pattern="$3"

  if "${tsc[@]}" -p "$tsconfig" --noEmit --skipLibCheck false >"$library_output" 2>&1; then
    rm -f "$library_output"
    echo "$label library diagnostics are now clean; reassess the documented TypeScript 7 hold." >&2
    exit 1
  fi
  if ! grep --extended-regexp --quiet "$expected_pattern" "$library_output"; then
    cat "$library_output" >&2
    rm -f "$library_output"
    echo "$label TypeScript 7 library diagnostics changed unexpectedly" >&2
    exit 1
  fi
}

expect_library_diagnostics \
  Backend \
  apps/backend/tsconfig.json \
  '@tiptap\+core|prosemirror-model|@vitest\+browser'
expect_library_diagnostics \
  Web \
  apps/web/tsconfig.json \
  '@storybook\+react|@radix-ui\+react-select|ast-types'
rm -f "$library_output"

echo "TypeScript ${typescript_version} project-source proof passed; known library diagnostics and the negative fixture were reproduced."

if [[ "${1:-}" != "--with-alias-check" ]]; then
  exit 0
fi

proof_root="$(mktemp -d -t inside-platform-ts7-alias.XXXXXX)"
cleanup() {
  rm -rf "$proof_root"
}
trap cleanup EXIT

mkdir -p "$proof_root/apps/backend" "$proof_root/apps/web"
cp package.json pnpm-lock.yaml pnpm-workspace.yaml "$proof_root/"
cp apps/backend/package.json "$proof_root/apps/backend/"
cp apps/web/package.json "$proof_root/apps/web/"

PROOF_ROOT="$proof_root" node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const proofRoot = process.env.PROOF_ROOT;
for (const relativePath of ["package.json", "apps/backend/package.json", "apps/web/package.json"]) {
  const path = join(proofRoot, relativePath);
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.devDependencies.typescript = "npm:@typescript/typescript6@6.0.2";
  if (relativePath === "package.json") {
    manifest.devDependencies["@typescript/native"] = "npm:typescript@7.0.2";
  }
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}
NODE

alias_output="$proof_root/install.log"
if pnpm --dir "$proof_root" install --lockfile-only --no-frozen-lockfile >"$alias_output" 2>&1; then
  echo "The TypeScript 7 side-by-side install now succeeds; reassess the documented hold." >&2
  exit 1
fi
if ! grep --extended-regexp --quiet 'tsconfck|@valibot/to-json-schema' "$alias_output"; then
  cat "$alias_output" >&2
  echo "The side-by-side install failed for an undocumented reason" >&2
  exit 1
fi

echo "Expected strict peer blocker reproduced for the official TypeScript 7/6 side-by-side contract."
