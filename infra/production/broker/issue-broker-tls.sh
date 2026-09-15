#!/usr/bin/env bash
set -euo pipefail

# Issues the environment broker's private CA and its server certificate for the name `rabbitmq`.
# Clients verify both the certificate and the name; they authenticate with their own principal.
# The production runbook and the local production smoke call this same script.
if [[ $# -ne 3 || ! "$2" =~ ^[1-9][0-9]*$ || ! "$3" =~ ^[1-9][0-9]*$ ]]; then
  echo "usage: issue-broker-tls.sh <empty-output-directory> <ca-days> <server-days>" >&2
  exit 1
fi
output_dir="$1"
ca_days="$2"
server_days="$3"

install -d -m 0700 "$output_dir"
if [[ -n "$(ls -A "$output_dir")" ]]; then
  echo "Broker TLS output directory must be empty: $output_dir" >&2
  exit 1
fi
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/inside-broker-tls.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT

cat >"$work_dir/openssl.cnf" <<'EOF'
[req]
distinguished_name = subject
prompt = no
[subject]
CN = Inside environment broker CA
[broker_ca]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
[broker_server]
basicConstraints = CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:rabbitmq
EOF

openssl req -x509 -config "$work_dir/openssl.cnf" -extensions broker_ca -newkey rsa:3072 -nodes \
  -days "$ca_days" -keyout "$output_dir/ca-key.pem" -out "$output_dir/ca.pem"
openssl req -new -config "$work_dir/openssl.cnf" -subj /CN=rabbitmq -newkey rsa:3072 -nodes \
  -keyout "$output_dir/server-key.pem" -out "$work_dir/server.csr"
openssl x509 -req -in "$work_dir/server.csr" -CA "$output_dir/ca.pem" -CAkey "$output_dir/ca-key.pem" \
  -CAserial "$work_dir/ca.srl" -CAcreateserial -days "$server_days" \
  -extfile "$work_dir/openssl.cnf" -extensions broker_server -out "$output_dir/server.pem"
openssl verify -CAfile "$output_dir/ca.pem" -verify_hostname rabbitmq "$output_dir/server.pem" >/dev/null
echo "Issued ca.pem, ca-key.pem, server.pem and server-key.pem in $output_dir"
