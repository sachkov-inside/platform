#!/usr/bin/env bash
# Copies the stand's objects from its former MinIO volume into the RustFS object-storage service
# (platform#700) and proves the copy by object count and content checksums.
#
# The former volume is mounted read-only once, to snapshot it: MinIO rewrites its own system files
# at start-up, so it serves a disposable copy. The target keeps objects it already has; keys are
# immutable, so a repeated run copies nothing new and verifies again. It never deletes an object.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

# The last MinIO image the stand ran. Its registry is closed, so only a local copy can serve it.
minio_image="${MINIO_IMAGE:-quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z}"

project="$(docker compose config --format yaml | sed -n '1s/^name: //p')"
source_volume="${project}_object-storage-data"
snapshot_volume="${project}_object-storage-transfer-snapshot"
transfer_container="${project}-object-storage-transfer"

if ! docker image inspect "$minio_image" >/dev/null 2>&1; then
  echo "The MinIO image $minio_image is not in the local Docker cache; set MINIO_IMAGE to a cached one" >&2
  exit 1
fi
if ! docker volume inspect "$source_volume" >/dev/null 2>&1; then
  echo "The former MinIO volume $source_volume does not exist; there is nothing to transfer" >&2
  exit 1
fi

# The stand's former MinIO root credentials were the same local values RustFS now uses.
# shellcheck source=/dev/null
source config/compose/local/object-storage.env
access_key="$RUSTFS_ACCESS_KEY"
secret_key="$RUSTFS_SECRET_KEY"

started_storage=false
created_snapshot=false
created_container=false
cleanup() {
  if [[ "$created_container" == true ]]; then docker rm --force "$transfer_container" >/dev/null; fi
  if [[ "$created_snapshot" == true ]]; then docker volume rm "$snapshot_volume" >/dev/null; fi
  if [[ "$started_storage" == true ]]; then docker compose stop object-storage >/dev/null; fi
}
trap cleanup EXIT

storage_container="$(docker compose ps --status running --quiet object-storage)"
if [[ -z "$storage_container" ]]; then
  # A stand stopped before platform#699 still has a MinIO container on the former volume; `up`
  # recreates it from the current RustFS definition instead of starting it.
  docker compose up --detach --wait object-storage
  started_storage=true
  storage_container="$(docker compose ps --status running --quiet object-storage)"
fi
storage_image="$(docker inspect --format '{{.Config.Image}}' "$storage_container")"
if [[ "$storage_image" != "$(docker compose config --images object-storage)" ]]; then
  echo "object-storage runs $storage_image, not the RustFS image from compose.yaml; restart it from current main" >&2
  exit 1
fi

docker volume create "$snapshot_volume" >/dev/null
created_snapshot=true
docker run --rm --pull never --entrypoint cp \
  --volume "$source_volume:/former:ro" --volume "$snapshot_volume:/snapshot" \
  "$minio_image" -a /former/. /snapshot/

# MinIO shares the RustFS container's network, so both answer on loopback: RustFS on 9000.
docker run --detach --pull never --name "$transfer_container" \
  --network "container:$storage_container" --volume "$snapshot_volume:/data" \
  --env "MINIO_ROOT_USER=$access_key" --env "MINIO_ROOT_PASSWORD=$secret_key" \
  --env "MC_HOST_former=http://$access_key:$secret_key@127.0.0.1:9100" \
  --env "MC_HOST_rustfs=http://$access_key:$secret_key@127.0.0.1:9000" \
  "$minio_image" server --address 127.0.0.1:9100 --console-address 127.0.0.1:9101 /data >/dev/null
created_container=true

docker exec --interactive "$transfer_container" bash -s <<'TRANSFER'
set -euo pipefail
shopt -s nocasematch

timeout 60 bash -c 'until mc ready former >/dev/null 2>&1; do sleep 1; done'

# One line per object: bucket/key, size, SHA-256 of the bytes, Content-Type and user metadata.
# The application reads Content-Type and the sha256 user metadata, so both must survive the copy.
manifest() {
  local alias="$1" bucket="$2" path stat size content_type metadata rest pairs
  mc find "$alias/$bucket" | while IFS= read -r path; do
    stat="$(mc stat --json "$path")"
    [[ "$stat" =~ \"size\":([0-9]+) ]] && size="${BASH_REMATCH[1]}"
    content_type=""
    [[ "$stat" =~ \"content-type\":\"([^\"]*)\" ]] && content_type="${BASH_REMATCH[1]}"
    pairs=()
    rest="$stat"
    while [[ "$rest" =~ \"(x-amz-meta-[^\"]+)\":\"([^\"]*)\" ]]; do
      pairs+=("${BASH_REMATCH[1],,}=${BASH_REMATCH[2]}")
      rest="${rest#*"${BASH_REMATCH[0]}"}"
    done
    metadata="$(printf '%s\n' "${pairs[@]}" | sort | paste -sd ' ')"
    printf '%s\t%s\t%s\t%s\t%s\n' "${path#"$alias"/}" "$size" \
      "$(mc cat "$path" | sha256sum | cut -d ' ' -f 1)" "$content_type" "$metadata"
  done | sort
}

buckets=()
while IFS= read -r line; do
  [[ "$line" =~ \"key\":\"([^\"]+)/\" ]] && buckets+=("${BASH_REMATCH[1]}")
done < <(mc ls --json former)

missing=0
for bucket in "${buckets[@]}"; do
  mc mb --ignore-existing "rustfs/$bucket" >/dev/null
  mc mirror --quiet "former/$bucket" "rustfs/$bucket" >/dev/null
  manifest former "$bucket" >"/tmp/former-$bucket"
  manifest rustfs "$bucket" >"/tmp/rustfs-$bucket"
  absent="$(comm -23 "/tmp/former-$bucket" "/tmp/rustfs-$bucket")"
  former_count="$(wc -l <"/tmp/former-$bucket")"
  absent_count=0
  [[ -n "$absent" ]] && absent_count="$(printf '%s\n' "$absent" | wc -l)"
  printf '%s: %s objects in MinIO, %s identical in RustFS (%s in RustFS in total), manifest sha256 %s\n' \
    "$bucket" "$former_count" "$((former_count - absent_count))" "$(wc -l <"/tmp/rustfs-$bucket")" \
    "$(sha256sum <"/tmp/former-$bucket" | cut -d ' ' -f 1)"
  if [[ -n "$absent" ]]; then
    printf 'Missing or different in RustFS:\n%s\n' "$absent" >&2
    missing=$((missing + absent_count))
  fi
done

if ((missing > 0)); then
  echo "Transfer is incomplete: $missing objects differ; the former volume is unchanged" >&2
  exit 1
fi
echo "Transfer verified: every MinIO object is in RustFS with the same size, content and metadata"
TRANSFER
