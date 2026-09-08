#!/usr/bin/env bash
set -euo pipefail

# Shared by clean provisioning and the separately approved host upgrade procedure.
# Existing hosts must be backed up and validated as described in production-foundation.md.
[[ "$EUID" -eq 0 ]] || { echo 'Run as root' >&2; exit 1; }
[[ "$(dpkg --print-architecture)" == amd64 ]] || { echo 'Pinned Caddy package requires amd64' >&2; exit 1; }

caddy_version=2.11.4
caddy_sha256=c41708ffb4af9bc6d19f7d22a7a034804352a21ecc62e1d3dfe3d58e30b38a3e
caddy_url="https://dl.cloudsmith.io/public/caddy/stable/deb/debian/pool/any-version/main/c/ca/caddy_${caddy_version}/caddy_${caddy_version}_linux_amd64.deb"
caddy_stage="$(mktemp -d)"
trap 'rm -rf -- "$caddy_stage"' EXIT
chmod 755 "$caddy_stage"
caddy_deb="$caddy_stage/caddy.deb"
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
  --connect-timeout 10 --max-time 120 "$caddy_url" --output "$caddy_deb"
printf '%s  %s\n' "$caddy_sha256" "$caddy_deb" | sha256sum --check --status
[[ "$(dpkg-deb -f "$caddy_deb" Package)" == caddy ]]
[[ "$(dpkg-deb -f "$caddy_deb" Version)" == "$caddy_version" ]]
[[ "$(dpkg-deb -f "$caddy_deb" Architecture)" == amd64 ]]

DEBIAN_FRONTEND=noninteractive apt-get install --yes \
  -o Dpkg::Options::=--force-confold "$caddy_deb"
[[ "$(dpkg-query -W -f='${Version}' caddy)" == "$caddy_version" ]]

# Do not silently replace the verified upstream build with a distro backport.
# Updating Caddy is an explicit version/checksum change followed by reload acceptance.
install -d -m 755 /etc/apt/preferences.d
printf 'Package: caddy\nPin: version %s\nPin-Priority: 1001\n' "$caddy_version" \
  > /etc/apt/preferences.d/inside-caddy
chmod 644 /etc/apt/preferences.d/inside-caddy
