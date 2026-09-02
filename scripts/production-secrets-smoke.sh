#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
host_mode="${PRODUCTION_SECRETS_HOST_MODE:-0}"
if [[ "$host_mode" == 1 ]]; then
  temporary_root="$(mktemp -d "/run/inside-secrets-smoke.XXXXXX")"
  host_runtime="/run/inside/secrets"
  recovered_runtime="$host_runtime"
  materialize_command="materialize"
  materialize_extra=()
else
  temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/inside-secrets-smoke.XXXXXX")"
  host_runtime="$temporary_root/host-runtime"
  recovered_runtime="$temporary_root/recovered-runtime"
  materialize_command="materialize-fixture"
  materialize_extra=(--fixture-root "$temporary_root")
fi
trap 'rm -r "$temporary_root"' EXIT

host_key="$temporary_root/host.age"
offline_key="$temporary_root/offline.age"
wrong_key="$temporary_root/wrong.age"
age-keygen -o "$host_key" >/dev/null 2>&1
age-keygen -o "$offline_key" >/dev/null 2>&1
age-keygen -o "$wrong_key" >/dev/null 2>&1
chmod 600 "$host_key" "$offline_key" "$wrong_key"
host_recipient="$(age-keygen -y "$host_key")"
offline_recipient="$(age-keygen -y "$offline_key")"
ciphertext="$temporary_root/secrets.sops.json"
secret_marker="$(openssl rand -hex 24)"

node - "$repository_root/infra/production/secrets/secret-policy.json" "$secret_marker" <<'NODE' |
const { readFileSync } = require("node:fs");
const [policyPath, marker] = process.argv.slice(2);
const policy = JSON.parse(readFileSync(policyPath, "utf8"));
const names = new Set();
for (const service of Object.values(policy.services)) {
  for (const name of Object.values(service.secrets)) names.add(name);
}
const secrets = Object.fromEntries([...names].sort().map((name) => [name, `${marker}-${name}`]));
process.stdout.write(JSON.stringify({ schemaVersion: policy.schemaVersion, secrets }));
NODE
  node "$repository_root/scripts/production-secrets.mjs" encrypt \
    --host-recipient "$host_recipient" \
    --offline-recipient "$offline_recipient" \
    --output "$ciphertext" >"$temporary_root/encrypt.log" 2>&1

node "$repository_root/scripts/production-secrets.mjs" validate \
  --encrypted "$ciphertext" >"$temporary_root/validate.log" 2>&1
if node "$repository_root/scripts/production-secrets.mjs" materialize \
  --age-key-file "$host_key" \
  --encrypted "$ciphertext" \
  --generation forbidden-generation \
  --runtime-root "$temporary_root/persistent-runtime" \
  >"$temporary_root/persistent-runtime.log" 2>&1; then
  echo "Production materializer accepted a non-tmpfs runtime root" >&2
  exit 1
fi
node "$repository_root/scripts/production-secrets.mjs" "$materialize_command" \
  --age-key-file "$host_key" \
  --encrypted "$ciphertext" \
  "${materialize_extra[@]}" \
  --generation host-generation \
  --runtime-root "$host_runtime" >"$temporary_root/host.log" 2>&1

if node "$repository_root/scripts/production-secrets.mjs" "$materialize_command" \
  --age-key-file "$host_key" \
  --encrypted "$ciphertext" \
  "${materialize_extra[@]}" \
  --generation host-generation \
  --runtime-root "$host_runtime" >"$temporary_root/reuse.log" 2>&1; then
  echo "Immutable secret generation was unexpectedly replaced" >&2
  exit 1
fi

rm "$host_key"
node "$repository_root/scripts/production-secrets.mjs" "$materialize_command" \
  --age-key-file "$offline_key" \
  --encrypted "$ciphertext" \
  "${materialize_extra[@]}" \
  --generation recovered-generation \
  --runtime-root "$recovered_runtime" >"$temporary_root/recovery.log" 2>&1

if SOPS_AGE_KEY_FILE="$wrong_key" sops --decrypt "$ciphertext" >/dev/null 2>"$temporary_root/wrong-recipient.log"; then
  echo "Wrong age recipient unexpectedly decrypted production ciphertext" >&2
  exit 1
fi

grep -q "$secret_marker" "$recovered_runtime/current/api.env"
if grep -R -q "$secret_marker" "$temporary_root"/*.log; then
  echo "Secret value leaked to lifecycle diagnostics" >&2
  exit 1
fi
if find "$recovered_runtime" -type f ! -perm 400 -print -quit | grep -q .; then
  echo "Recovered secret files are not mode 0400" >&2
  exit 1
fi

echo "Synthetic host/offline SOPS recovery passed"
