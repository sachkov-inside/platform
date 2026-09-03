#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 2 ]]; then
  echo "usage: package-native-artifact.sh <target> <dist-directory>" >&2
  exit 2
fi

target="$1"
dist_directory="$(cd "$2" && pwd)"
script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$target" in
  windows-amd64)
    members=(workshop-evaluator.exe workshop-evaluator.exe.sha256 run-workshop-evaluator.ps1)
    ;;
  darwin-arm64 | linux-amd64)
    members=(workshop-evaluator workshop-evaluator.sha256 run-workshop-evaluator.sh)
    ;;
  *)
    echo "unsupported native target: $target" >&2
    exit 2
    ;;
esac

for member in "${members[@]}"; do
  if [[ ! -f "$dist_directory/$member" ]]; then
    echo "missing package member: $member" >&2
    exit 1
  fi
done

archive="$dist_directory/workshop-evaluator-$target.tar.gz"
tar -C "$dist_directory" -czf "$archive" "${members[@]}"
go -C "$script_directory" run ./cmd/workshop-evaluator-checksum \
  --file "$archive" \
  --output "${archive}.sha256"
go -C "$script_directory" run ./cmd/workshop-evaluator-checksum \
  --file "$archive" \
  --verify "${archive}.sha256"

actual_members="$(tar -tzf "$archive" | LC_ALL=C sort)"
expected_members="$(printf '%s\n' "${members[@]}" | LC_ALL=C sort)"
if [[ "$actual_members" != "$expected_members" ]]; then
  echo "native package contains unexpected members" >&2
  exit 1
fi

verification_directory="$(mktemp -d "${TMPDIR:-/tmp}/inside-workshop-package.XXXXXX")"
trap 'rm -rf "$verification_directory"' EXIT
tar -xzf "$archive" -C "$verification_directory"
if [[ "$target" == "windows-amd64" ]]; then
  pwsh -File "$verification_directory/run-workshop-evaluator.ps1" --version
else
  test -x "$verification_directory/workshop-evaluator"
  test -x "$verification_directory/run-workshop-evaluator.sh"
  "$verification_directory/run-workshop-evaluator.sh" --version
fi
