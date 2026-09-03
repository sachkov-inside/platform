#!/usr/bin/env bash
set -euo pipefail

wrapper_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
binary="$wrapper_directory/workshop-evaluator"
checksum="$binary.sha256"

if [[ ! -x "$binary" || ! -f "$checksum" ]]; then
  echo "Pinned workshop-evaluator binary or checksum is missing." >&2
  exit 1
fi

if [[ "$(uname -s)" == "Darwin" ]]; then
  (cd "$wrapper_directory" && shasum -a 256 --check "$(basename "$checksum")")
else
  (cd "$wrapper_directory" && sha256sum --check "$(basename "$checksum")")
fi

exec "$binary" "$@"
