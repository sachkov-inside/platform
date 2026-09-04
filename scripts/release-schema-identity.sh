#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]] ||
  [[ ! "$1" =~ @sha256:[0-9a-f]{64}$ && ! "$1" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "usage: release-schema-identity.sh <image@sha256:digest|sha256:image-id>" >&2
  exit 1
fi

identity="$(docker run --rm --entrypoint node "$1" --input-type=module --eval '
  import { migrationRegistryIdentity } from "./dist/infrastructure/postgres/migrate-to-latest.js";
  import { platformMigrations } from "./dist/migrations/index.js";
  process.stdout.write(migrationRegistryIdentity(platformMigrations));
')"
if [[ ! "$identity" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "Backend image returned an invalid schema identity" >&2
  exit 1
fi
printf '%s\n' "$identity"
