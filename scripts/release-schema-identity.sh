#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: release-schema-identity.sh <image@sha256:digest|sha256:image-id>" >&2
  exit 1
fi

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"
validate_digest() {
  node --input-type=module --eval '
    import { sha256DigestSchema } from "./release/contract-schema.mjs";
    sha256DigestSchema.parse(process.argv[1]);
  ' "$1"
}

image_reference="$1"
image_digest="${image_reference##*@}"
validate_digest "$image_digest"

identity="$(docker run --rm --entrypoint node "$image_reference" --input-type=module --eval '
  import { migrationRegistryIdentity } from "./dist/infrastructure/postgres/migrate-to-latest.js";
  import { platformMigrations } from "./dist/migrations/index.js";
  process.stdout.write(migrationRegistryIdentity(platformMigrations));
')"
validate_digest "$identity"
printf '%s\n' "$identity"
