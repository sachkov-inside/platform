#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != Linux || $# -ne 1 || "$1" != /* ]]; then
  echo 'Usage on Linux: install-docker-compose.sh <absolute plugin directory>' >&2
  exit 64
fi

version=5.7.1
case "$(uname -m)" in
  x86_64)
    platform=x86_64
    checksum=af426722a8af5de812fcee30cc1c39f0639f5f723cbadefb25e5d4db054064cf
    ;;
  aarch64 | arm64)
    platform=aarch64
    checksum=f2f49f903240895fa764c0dca3a14548b754ad9426f6b609ccaf55ec5a3aa2a5
    ;;
  *) echo 'Unsupported Docker Compose architecture' >&2; exit 64 ;;
esac

destination="${1%/}"
if [[ -z "$destination" || "$(readlink -m "$destination")" != "$destination" || -L "$destination/docker-compose" ]]; then
  echo 'Plugin directory and file must not traverse symlinks' >&2
  exit 64
fi
target="$destination/docker-compose"
if [[ -f "$target" ]] && printf '%s  %s\n' "$checksum" "$target" | sha256sum --check --status; then
  actual="$("$target" version --short)"
  [[ "${actual#v}" == "$version" ]]
  exit 0
fi
if [[ -e "$target" && ! -f "$target" ]]; then
  echo 'Refusing to replace a non-file Docker Compose plugin' >&2
  exit 64
fi

umask 022
mkdir -p "$destination"
staged="$(mktemp "$destination/.docker-compose.next.XXXXXX")"
trap '[[ -z "$staged" ]] || rm -f -- "$staged"' EXIT
url="https://github.com/docker/compose/releases/download/v$version/docker-compose-linux-$platform"
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
  --connect-timeout 10 --max-time 120 "$url" --output "$staged"
if ! printf '%s  %s\n' "$checksum" "$staged" | sha256sum --check --status; then
  echo 'Docker Compose checksum mismatch; existing plugin preserved' >&2
  exit 1
fi
chmod 755 "$staged"
actual="$("$staged" version --short)"
[[ "${actual#v}" == "$version" ]]
mv -f -- "$staged" "$target"
staged=""
