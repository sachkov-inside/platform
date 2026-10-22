# Former MinIO objects

One-off copy of objects from the former MinIO volume into RustFS.

## Former MinIO objects

Until platform#699 the stand kept files, covers and attachments in MinIO, in the
`inside-platform_object-storage-data` volume. RustFS stores objects in another format and a new
volume, and `pnpm local:product` skips originals its journal already transferred, so a stand that
ran on MinIO shows its files only after this one-off copy. Only the stand's
[singleton owner](local-stand.md#parallel-worktrees-and-singleton-ownership) runs it:

```bash
bash scripts/local-object-storage-transfer.sh
```

The script needs the last MinIO image in the local Docker cache, because its registry is closed. It
reads the former volume without changing it, copies every bucket it holds into the stand's
`object-storage` service and starts that one service only for the run when the stand is stopped. It
never overwrites or deletes an object, so it is safe to repeat.

It succeeds only when every MinIO object is present in RustFS with the same size, SHA-256 of its
content, Content-Type and user metadata; each bucket line reports both counts and the manifest
checksum. An object listed as different was already in RustFS under the same key: keep both
volumes and investigate it before retrying. A run killed before its own cleanup leaves the
`inside-platform-object-storage-transfer` container or the
`inside-platform-object-storage-transfer-snapshot` volume; the next run names them, and removing
them touches no stand data.

Then start the stand with `pnpm local:stand` and open the product featured on Home: its cover, the
images on its page and its files load again.

The former volume stays until the owner decides to delete it; the transfer does not change it.
