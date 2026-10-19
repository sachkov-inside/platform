#!/usr/bin/env bash
set -euo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "Run as root" >&2
  exit 1
fi
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v python3 >/dev/null
test -S /var/run/docker.sock
install -d -o root -g root -m 755 /usr/local/libexec/inside
install -o root -g root -m 755 "$script_dir/inside-image-cleanup.py" /usr/local/libexec/inside/inside-image-cleanup.py
for unit in inside-image-cleanup.service inside-image-cleanup.timer; do
  install -o root -g root -m 644 "$script_dir/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
echo "Installed without starting cleanup. Review dry-run before enabling the timer."
