#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/inside-foundation-drill.XXXXXX")"
database_project="inside-foundation-database-$$"
logto_project="inside-foundation-logto-$$"
database_network="inside-foundation-database-$$"
logto_port="${FOUNDATION_DRILL_LOGTO_PORT:-43301}"
artifact_dir="${FOUNDATION_DRILL_ARTIFACT_DIR:-}"

public_config="$temporary_root/public"
secret_config="$temporary_root/secrets"
mkdir -p "$public_config" "$secret_config"

export FOUNDATION_DATABASE_NETWORK="$database_network"
export FOUNDATION_DATABASE_PROJECT="$database_project"
export FOUNDATION_LOGTO_LOOPBACK_PORT="$logto_port"
export FOUNDATION_LOGTO_PROJECT="$logto_project"
export FOUNDATION_MINIO_CERT_DIR="$temporary_root/minio-certs"
export FOUNDATION_PUBLIC_CONFIG_DIR="$public_config"
export FOUNDATION_SECRET_CONFIG_DIR="$secret_config"

database_compose=(
  docker compose
  --file "$repository_root/infra/production/database/compose.yaml"
  --project-name "$database_project"
)
logto_compose=(
  docker compose
  --file "$repository_root/infra/production/logto/compose.yaml"
  --project-name "$logto_project"
)

cleanup() {
  local test_status=$?
  local cleanup_status=0
  trap - EXIT
  if ((test_status != 0)) && [[ -n "$artifact_dir" ]] && mkdir -p "$artifact_dir"; then
    "${database_compose[@]}" --profile fixture --profile operations ps --all \
      --format json >"$artifact_dir/database-ps.json" 2>&1 || true
    "${logto_compose[@]}" ps --all --format json \
      >"$artifact_dir/logto-ps.json" 2>&1 || true
    printf '%s\n' 'Foundation drill failed; raw service logs are intentionally excluded.' \
      >"$artifact_dir/README.txt"
  fi
  if ! "${logto_compose[@]}" down --volumes --remove-orphans; then
    cleanup_status=1
  fi
  if ! "${database_compose[@]}" --profile fixture --profile operations down --volumes --remove-orphans; then
    cleanup_status=1
  fi
  rm -r "$temporary_root"
  if ((test_status != 0)); then
    exit "$test_status"
  fi
  exit "$cleanup_status"
}
trap cleanup EXIT

random_hex() {
  openssl rand -hex 24
}

latest_backup_set() {
  "${database_compose[@]}" --profile operations run --rm -T pgbackrest \
    --stanza=production --output=json info \
    | node -e 'let value="";process.stdin.on("data",chunk=>value+=chunk).on("end",()=>{const info=JSON.parse(value);const backups=info[0]?.backup??[];process.stdout.write(backups.at(-1)?.label??"")})'
}

verify_recovery_markers() {
  local expected="$1"
  local mode="$2"
  local database_spec database database_user recovered
  for database_spec in "inside:platform_owner" "logto:logto_owner"; do
    database="${database_spec%%:*}"
    database_user="${database_spec##*:}"
    recovered="$("${database_compose[@]}" exec -T postgres psql \
      --username "$database_user" \
      --dbname "$database" \
      --tuples-only \
      --no-align \
      --command="select string_agg(id, ',' order by id) from foundation_recovery_marker;")"
    if [[ "$recovered" != "$expected" ]]; then
      echo "$database $mode marker verification failed" >&2
      return 1
    fi
  done
}

postgres_password="$(random_hex)"
platform_owner_password="$(random_hex)"
platform_runtime_password="$(random_hex)"
logto_password="$(random_hex)"
backup_access_key="$(random_hex)"
backup_cipher="$(random_hex)"
minio_password="$(random_hex)"
secret_vault_kek="$(openssl rand -base64 32 | tr -d '\n')"

cat >"$public_config/database.env" <<EOF
POSTGRES_DB=postgres
POSTGRES_USER=postgres
PGDATA=/var/lib/postgresql/18/docker
PGBACKREST_REPO1_TYPE=s3
PGBACKREST_REPO1_S3_BUCKET=inside-foundation-backups
PGBACKREST_REPO1_S3_ENDPOINT=minio
PGBACKREST_REPO1_S3_REGION=us-east-1
PGBACKREST_REPO1_S3_URI_STYLE=path
PGBACKREST_REPO1_S3_VERIFY_TLS=n
PGBACKREST_REPO1_STORAGE_PORT=9000
EOF
cat >"$public_config/minio.env" <<EOF
MINIO_ROOT_USER=$backup_access_key
MINIO_ROOT_PASSWORD=$minio_password
EOF
cat >"$public_config/logto.env" <<'EOF'
ADMIN_DISABLE_LOCALHOST=true
CI=true
DATABASE_STATEMENT_TIMEOUT=5000
ENDPOINT=https://auth.sachkov.dev
TRUST_PROXY_HEADER=1
EOF
cat >"$secret_config/postgres.env" <<EOF
POSTGRES_PASSWORD=$postgres_password
POSTGRES_SUPERUSER_PASSWORD=$postgres_password
PLATFORM_DATABASE_OWNER_PASSWORD=$platform_owner_password
PLATFORM_DATABASE_RUNTIME_PASSWORD=$platform_runtime_password
LOGTO_DATABASE_OWNER_PASSWORD=$logto_password
EOF
cat >"$secret_config/pgbackrest.env" <<EOF
PGBACKREST_REPO1_S3_KEY=$backup_access_key
PGBACKREST_REPO1_S3_KEY_SECRET=$minio_password
PGBACKREST_REPO1_CIPHER_PASS=$backup_cipher
EOF
cat >"$secret_config/logto.env" <<EOF
LOGTO_DATABASE_PASSWORD=$logto_password
SECRET_VAULT_KEK=$secret_vault_kek
EOF
chmod 400 "$secret_config"/*.env
mkdir -p "$FOUNDATION_MINIO_CERT_DIR"
openssl req \
  -x509 \
  -newkey rsa:2048 \
  -nodes \
  -days 1 \
  -subj /CN=minio \
  -addext subjectAltName=DNS:minio \
  -keyout "$FOUNDATION_MINIO_CERT_DIR/private.key" \
  -out "$FOUNDATION_MINIO_CERT_DIR/public.crt" >/dev/null 2>&1
chmod 600 "$FOUNDATION_MINIO_CERT_DIR/private.key"

"${database_compose[@]}" --profile fixture --profile operations config --quiet
"${logto_compose[@]}" config --quiet
"${database_compose[@]}" build postgres
"${database_compose[@]}" --profile fixture up --detach --wait minio
"${database_compose[@]}" --profile fixture run --rm minio-bootstrap
"${database_compose[@]}" up --detach --wait postgres
"${database_compose[@]}" --profile operations run --rm pgbackrest --stanza=production stanza-create
"${database_compose[@]}" --profile operations run --rm pgbackrest --stanza=production check

"${logto_compose[@]}" build logto
"${logto_compose[@]}" up --detach --wait
"${logto_compose[@]}" run --rm logto-migrations
discovery="$({ curl --fail --silent --show-error --retry 20 --retry-all-errors --retry-delay 1 "http://127.0.0.1:${logto_port}/oidc/.well-known/openid-configuration"; })"
node -e 'const value=JSON.parse(process.argv[1]);if(value.issuer!=="https://auth.sachkov.dev/oidc")process.exit(1)' "$discovery"

for database_spec in "inside:platform_owner" "logto:logto_owner"; do
  database="${database_spec%%:*}"
  database_user="${database_spec##*:}"
  "${database_compose[@]}" exec -T postgres psql \
    --username "$database_user" \
    --dbname "$database" \
    --set=ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE foundation_recovery_marker (
  id text PRIMARY KEY,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO foundation_recovery_marker (id) VALUES ('before-target');
SQL
done

"${database_compose[@]}" --profile operations run --rm pgbackrest \
  --stanza=production --type=full backup
pitr_backup_set="$(latest_backup_set)"
if [[ -z "$pitr_backup_set" ]]; then
  echo "pgBackRest did not report the full backup set" >&2
  exit 1
fi
# pgBackRest records backup stop times at whole-second precision. Keep the PITR
# target strictly after that stop time so the selected base backup is eligible.
"${database_compose[@]}" exec -T postgres psql \
  --username postgres \
  --dbname postgres \
  --command="select pg_sleep(2);" >/dev/null
before_marker_epoch="$("${database_compose[@]}" exec -T postgres psql \
  --username platform_owner \
  --dbname inside \
  --tuples-only \
  --no-align \
  --command="select extract(epoch from recorded_at) from foundation_recovery_marker where id = 'before-target';")"
target_record="$("${database_compose[@]}" exec -T postgres psql \
  --username postgres \
  --dbname postgres \
  --tuples-only \
  --no-align \
  --field-separator='|' \
  --command="select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US+00'), extract(epoch from clock_timestamp());")"
target_timestamp="${target_record%%|*}"
target_epoch="${target_record##*|}"

for database_spec in "inside:platform_owner" "logto:logto_owner"; do
  database="${database_spec%%:*}"
  database_user="${database_spec##*:}"
  "${database_compose[@]}" exec -T postgres psql \
    --username "$database_user" \
    --dbname "$database" \
    --set=ON_ERROR_STOP=1 \
    --command="insert into foundation_recovery_marker (id) values ('after-target');"
done
last_marker_epoch="$("${database_compose[@]}" exec -T postgres psql \
  --username platform_owner \
  --dbname inside \
  --tuples-only \
  --no-align \
  --command="select extract(epoch from recorded_at) from foundation_recovery_marker where id = 'after-target';")"
"${database_compose[@]}" exec -T postgres psql --username postgres --dbname postgres --command="select pg_switch_wal();" >/dev/null
"${database_compose[@]}" --profile operations run --rm pgbackrest --stanza=production check
"${database_compose[@]}" --profile operations run --rm pgbackrest \
  --stanza=production --type=incr backup
empty_backup_set="$(latest_backup_set)"
if [[ -z "$empty_backup_set" ]]; then
  echo "pgBackRest did not report a recoverable backup set" >&2
  exit 1
fi

"${logto_compose[@]}" down
"${database_compose[@]}" stop postgres
"${database_compose[@]}" rm --force postgres
postgres_volume="$(docker volume ls --quiet \
  --filter "label=com.docker.compose.project=$database_project" \
  --filter "label=com.docker.compose.volume=postgres-data")"
if [[ -z "$postgres_volume" || "$postgres_volume" == *$'\n'* ]]; then
  echo "Could not resolve one disposable PostgreSQL volume" >&2
  exit 1
fi
docker volume rm "$postgres_volume" >/dev/null

empty_started="$(date +%s)"
empty_target_epoch="$empty_started"
# This is a restore drill against the same repository, so do not let its
# promoted test timeline archive back into the source repository.
"${database_compose[@]}" --profile operations run --rm restore \
  --stanza=production --archive-mode=off restore
"${database_compose[@]}" up --detach --wait postgres
verify_recovery_markers "after-target,before-target" "empty-host"
empty_finished="$(date +%s)"
empty_rto="$(( empty_finished - empty_started ))"
empty_rpo="$(node -e 'process.stdout.write(String(Math.max(0, Number(process.argv[1])-Number(process.argv[2]))))' "$empty_target_epoch" "$last_marker_epoch")"

"${database_compose[@]}" stop postgres
"${database_compose[@]}" rm --force postgres
postgres_volume="$(docker volume ls --quiet \
  --filter "label=com.docker.compose.project=$database_project" \
  --filter "label=com.docker.compose.volume=postgres-data")"
docker volume rm "$postgres_volume" >/dev/null
pitr_started="$(date +%s)"
"${database_compose[@]}" --profile operations run --rm restore \
  --stanza=production \
  --type=time \
  "--target=$target_timestamp" \
  --target-action=promote \
  restore
"${database_compose[@]}" up --detach --wait postgres
verify_recovery_markers "before-target" "PITR"
pitr_rto="$(( $(date +%s) - pitr_started ))"
pitr_rpo="$(node -e 'process.stdout.write(String(Math.max(0, Number(process.argv[1])-Number(process.argv[2]))))' "$target_epoch" "$before_marker_epoch")"

evidence="$temporary_root/recovery-evidence.json"
node - \
  "$evidence" \
  "$repository_root/infra/production/database/recovery-targets.json" \
  "$pitr_backup_set" \
  "$empty_backup_set" \
  "$target_epoch" \
  "$pitr_rpo" \
  "$pitr_rto" \
  "$empty_target_epoch" \
  "$empty_rpo" \
  "$empty_rto" <<'NODE'
const { readFileSync, writeFileSync } = require("node:fs");
const [
  path,
  targetsPath,
  pitrBackupSet,
  emptyBackupSet,
  pitrEpoch,
  pitrRpo,
  pitrRto,
  emptyEpoch,
  emptyRpo,
  emptyRto,
] = process.argv.slice(2);
const { databases } = JSON.parse(readFileSync(targetsPath, "utf8"));
writeFileSync(path, JSON.stringify({
  schemaVersion: 1,
  drills: [
    { backupSet: pitrBackupSet, databases, mode: "pitr", rpoSeconds: Number(pitrRpo), rtoSeconds: Number(pitrRto), targetTimestamp: new Date(Number(pitrEpoch) * 1000).toISOString() },
    { backupSet: emptyBackupSet, databases, mode: "empty-host", rpoSeconds: Number(emptyRpo), rtoSeconds: Number(emptyRto), targetTimestamp: new Date(Number(emptyEpoch) * 1000).toISOString() },
  ],
}, undefined, 2));
NODE
node "$repository_root/scripts/production-recovery-evidence.mjs" "$evidence"

if [[ -n "$artifact_dir" ]]; then
  mkdir -p "$artifact_dir"
  cp "$evidence" "$artifact_dir/recovery-evidence.json"
fi

echo "Production foundation drill passed: Logto config/migrations, pgBackRest PITR and empty-host recovery"
