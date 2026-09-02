#!/usr/bin/env bash
set -euo pipefail

: "${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}"
: "${PGBACKREST_REPO1_S3_BUCKET:?PGBACKREST_REPO1_S3_BUCKET is required}"

mc alias set fixture https://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" --insecure >/dev/null
mc --insecure mb --ignore-existing "fixture/$PGBACKREST_REPO1_S3_BUCKET" >/dev/null
mc --insecure anonymous set none "fixture/$PGBACKREST_REPO1_S3_BUCKET" >/dev/null
echo "Synthetic backup bucket is ready"
