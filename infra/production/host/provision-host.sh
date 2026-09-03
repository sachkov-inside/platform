#!/usr/bin/env bash
set -euo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "Run this script as root: sudo $0" >&2
  exit 1
fi

if [[ ! -r /etc/os-release ]]; then
  echo "Cannot identify the operating system" >&2
  exit 1
fi

# shellcheck source=/dev/null
source /etc/os-release
if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "24.04" ]]; then
  echo "This provisioning kit supports only Ubuntu 24.04" >&2
  exit 1
fi

backup_units=(
  inside-pgbackrest-backup@.service
  inside-pgbackrest-diff.timer
  inside-pgbackrest-full.timer
  inside-pgbackrest-incr.timer
)

managed_marker=/etc/inside/host-provisioned
if [[ ! -f "$managed_marker" ]]; then
  for managed_path in /etc/inside /opt/inside /srv/inside /var/lib/inside; do
    if [[ -e "$managed_path" || -L "$managed_path" ]]; then
      echo "Refusing to overwrite unmanaged path: $managed_path" >&2
      exit 1
    fi
  done

  for managed_file in \
    /etc/caddy/Caddyfile \
    /usr/local/libexec/inside/database-backup; do
    if [[ -e "$managed_file" || -L "$managed_file" ]]; then
      echo "Refusing to overwrite unmanaged file: $managed_file" >&2
      exit 1
    fi
  done
  for unit in "${backup_units[@]}"; do
    managed_file="/etc/systemd/system/$unit"
    if [[ -e "$managed_file" || -L "$managed_file" ]]; then
      echo "Refusing to overwrite unmanaged file: $managed_file" >&2
      exit 1
    fi
  done

  if command -v caddy >/dev/null || command -v docker >/dev/null; then
    echo "Refusing first provisioning on a host that already has Caddy or Docker" >&2
    exit 1
  fi

  install -d -m 700 /etc/inside
  printf 'state=provisioning\n' >"$managed_marker"
  chmod 600 "$managed_marker"
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install --yes \
  age \
  ca-certificates \
  caddy \
  curl \
  docker-compose-v2 \
  docker.io \
  openssh-server \
  sudo \
  ufw

if ! id inside-deploy >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash --user-group inside-deploy
fi
passwd --lock inside-deploy >/dev/null

install -d -m 700 /etc/inside/age /etc/inside/foundation
install -d -m 755 /opt/inside/foundation/infra/identity/logto
install -d -m 755 /opt/inside/foundation/infra/production/database
install -d -m 755 /opt/inside/foundation/infra/production/logto
install -d -m 755 /srv/inside/runtime/caddy /var/lib/inside
install -d -m 755 /usr/local/libexec/inside

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
production_dir="$(cd "$script_dir/.." && pwd)"
repository_dir="$(cd "$production_dir/../.." && pwd)"

cp --archive \
  "$production_dir/database/." \
  /opt/inside/foundation/infra/production/database/
cp --archive \
  "$production_dir/logto/." \
  /opt/inside/foundation/infra/production/logto/
cp --archive \
  "$repository_dir/infra/identity/logto/." \
  /opt/inside/foundation/infra/identity/logto/
chown -R root:root /opt/inside/foundation

install -m 644 "$script_dir/Caddyfile" /etc/caddy/Caddyfile
install -m 755 \
  "$production_dir/database/database-backup" \
  /usr/local/libexec/inside/database-backup
for unit in "${backup_units[@]}"; do
  install -m 644 \
    "$production_dir/database/$unit" \
    "/etc/systemd/system/$unit"
done

caddy validate --config /etc/caddy/Caddyfile
systemctl daemon-reload

ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

systemctl enable docker.service ssh.service caddy.service
systemctl start docker.service ssh.service
systemctl restart caddy.service

printf 'state=ready\n' >"$managed_marker"
chmod 600 "$managed_marker"

echo "Host prerequisites and the production foundation files are ready."
echo "Do not enable backup timers until #244 configures and verifies the backup repository."
