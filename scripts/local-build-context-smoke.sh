#!/usr/bin/env bash
set -euo pipefail

# A bounded real BuildKit COPY proof: no application build, registry fetch or owner credentials.
# Run under scripts/heavy-check.sh, after acquiring the coordinator's permitted build slot.
repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
proof_directory="$(mktemp -d "${TMPDIR:-/tmp}/platform-context-proof.XXXXXX")"
trap 'rm -rf "$proof_directory"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p "$proof_directory/context/.reports" "$proof_directory/context/.identity-proof" "$proof_directory/context/docs/evidence"
mkdir -p "$proof_directory/context/apps/backend/src/infrastructure/prisma/generated"
cp "$repository_root/.dockerignore" "$proof_directory/context/.dockerignore"
cp "$repository_root/package.json" "$proof_directory/context/package.json"
printf 'preserved tracked evidence\n' > "$proof_directory/context/docs/evidence/proof.txt"
printf 'local diagnostic report\n' > "$proof_directory/context/.reports/proof.txt"
printf 'synthetic credential fixture\n' > "$proof_directory/context/.identity-proof/proof.txt"
printf 'stale host-generated client\n' > "$proof_directory/context/apps/backend/src/infrastructure/prisma/generated/client.ts"
printf 'FROM scratch\nCOPY . /\n' > "$proof_directory/context/Dockerfile"
python3 "$repository_root/scripts/local-build-context-smoke.py" \
  "$proof_directory/context" "$proof_directory/output"
test -f "$proof_directory/output/package.json"
test -f "$proof_directory/output/docs/evidence/proof.txt"
test ! -e "$proof_directory/output/.reports"
test ! -e "$proof_directory/output/.identity-proof"
test ! -e "$proof_directory/output/apps/backend/src/infrastructure/prisma/generated"
printf 'BuildKit context proof: source and evidence preserved; reports and identity excluded.\n'
