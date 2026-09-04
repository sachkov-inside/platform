#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || -z "$1" ]]; then
  echo "usage: build-production-runtime-bundle.sh <output.tar.gz>" >&2
  exit 1
fi

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_path="$1"
staging_dir="$(mktemp -d "${TMPDIR:-/tmp}/inside-production-runtime-bundle.XXXXXX")"
trap 'rm -r "$staging_dir"' EXIT

install -d "$staging_dir/bin" "$staging_dir/caddy"
install -m 755 \
  "$repository_root/infra/production/deploy/deploy-release" \
  "$staging_dir/bin/deploy-release"
install -m 644 \
  "$repository_root/compose.production.yaml" \
  "$staging_dir/compose.production.yaml"
install -m 644 \
  "$repository_root/infra/production/deploy/maintenance.caddy" \
  "$staging_dir/caddy/maintenance.caddy"
install -m 644 \
  "$repository_root/infra/production/runtime/platform.caddy" \
  "$staging_dir/caddy/platform.caddy"

mkdir -p "$(dirname "$output_path")"
COPYFILE_DISABLE=1 tar -C "$staging_dir" -czf "$output_path" \
  bin/deploy-release \
  caddy/maintenance.caddy \
  caddy/platform.caddy \
  compose.production.yaml
