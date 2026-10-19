#!/usr/bin/env bash
# Restore this experiment's host snapshot. Snapshot data stays on its owning host.
set -euo pipefail

if [[ $# -ne 2 || ( "$1" != origin && "$1" != edge ) || "$2" != /* ]]; then
  echo 'usage: rollback-entry.sh <origin|edge> <absolute-snapshot-directory>' >&2
  exit 2
fi
snapshot_dir="$2"
if [[ "$1" == origin ]]; then
  test -f "$snapshot_dir/Caddyfile"
  caddy validate --config "$snapshot_dir/Caddyfile" --adapter caddyfile
  install -m 644 "$snapshot_dir/Caddyfile" /etc/caddy/Caddyfile
  caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
  systemctl disable --now inside-entry.service
  ufw --force delete allow from 185.125.101.90 to any port 8443 proto tcp
else
  test -f "$snapshot_dir/xrayebator-sub"
  install -m 644 "$snapshot_dir/xrayebator-sub" /etc/nginx/sites-available/xrayebator-sub
  nginx -t
  systemctl disable --now inside-entry.service
  rm -f /etc/nginx/conf.d/inside-entry-http.conf
  ufw --force delete allow 443/tcp
  ufw --force delete allow 80/tcp
  ufw limit 443/tcp
  ufw limit 80/tcp
  systemctl restart nginx
fi
