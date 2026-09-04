#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! -r "$1" ]]; then
  echo "usage: configure-deploy-key.sh <public-key-file>" >&2
  exit 1
fi

if [[ -n "${INSIDE_DEPLOY_TEST_ROOT:-}" ]]; then
  if [[ "$EUID" -eq 0 ]]; then
    echo "Test root is forbidden for a root process" >&2
    exit 1
  fi
  host_root="${INSIDE_DEPLOY_TEST_ROOT%/}"
else
  if [[ "$EUID" -ne 0 ]]; then
    echo "Run this script as root" >&2
    exit 1
  fi
  host_root=""
fi

public_key_file="$1"
if [[ "$(wc -l <"$public_key_file" | tr -d ' ')" -ne 1 ]] ||
   ! ssh-keygen -l -f "$public_key_file" >/dev/null 2>&1; then
  echo "Expected one valid Ed25519 public key" >&2
  exit 1
fi
key_type="$(awk '{print $1}' "$public_key_file")"
key_body="$(awk '{print $2}' "$public_key_file")"
if [[ "$key_type" != ssh-ed25519 ]]; then
  echo "Expected one valid Ed25519 public key" >&2
  exit 1
fi

ssh_dir="$host_root/home/inside-deploy/.ssh"
authorized_keys="$ssh_dir/authorized_keys"
install -d -m 700 "$ssh_dir"
temporary="${authorized_keys}.tmp.$$"
printf 'restrict,command="sudo -n /usr/local/libexec/inside/inside-deploy" %s %s\n' \
  "$key_type" "$key_body" >"$temporary"
chmod 600 "$temporary"
mv "$temporary" "$authorized_keys"
if [[ -z "${INSIDE_DEPLOY_TEST_ROOT:-}" ]]; then
  chown -R inside-deploy:inside-deploy "$ssh_dir"
fi

echo "Restricted inside-deploy key installed."
