# Video deletion runbook

`video-deletions-worker` is the only process that physically deletes Kinescope Video. An authoring
request only commits a stable deletion operation together with the successful Material Save that
removes the selected reference. Ordinary detach and replacement do not enqueue deletion.

## Runtime contract

Development uses `config/compose/local/video-deletions-worker.env` and the deterministic test
provider. Production uses the server-owned `video-deletions-worker.env`, with
`KINESCOPE_PROVIDER_MODE=real` and a server-only `KINESCOPE_API_TOKEN` that is allowed to delete in
both configured projects. Start only one logical worker deployment; duplicate jobs remain safe,
but extra processes add unnecessary provider traffic.

The process reports one redacted JSON readiness line:

```json
{"process":"video-deletions-worker","status":"ready"}
```

Terminal or exhausted failures report `status=operator_attention` with only the local operation
ID, typed error category and provider request ID when Kinescope supplied it. Tokens, provider
payloads, locators and Video titles are never logged.

## Expected lifecycle

- `deletion_requested`: durable and waiting for a zero-reference claim, terminal provider state or
  retry time;
- `deleting`: claimed with an incremented attempt count;
- `deleted`: Kinescope returned confirmed success or a trusted already-absent result; the local
  Video is a tombstone and its embed locator is cleared;
- `delete_failed`: fail-closed terminal state. The author can use «Повторить удаление» after the
  underlying reference/configuration issue is resolved.

Timeouts, network failures, `429` and `5xx` are retried with bounded exponential backoff and jitter.
`400` is a terminal data/integration error. `401` or `403` means the production token or project
permission must be corrected before retry. An unverified not-found result requires investigation;
do not rewrite provenance or delete the local audit row to force convergence.

## Investigation

1. Identify the operation by its redacted operation ID and inspect its state, attempts,
   `last_error_category`, `provider_request_id` and timestamps in `videos.deletion_operations`.
2. Verify that neither `materials.materials.primary_video_id` nor
   `materials.published_materials.primary_video_id` references the Video. A `referenced` failure is
   intentional protection, not a worker defect.
3. For active uploads or processing, wait for an authoritative Kinescope terminal state. The worker
   must not issue DELETE early.
4. For permission/configuration failures, repair only the server-owned worker environment, restart
   the worker, then use the authoring retry action. Do not paste credentials into logs or issues.
5. For real-provider behavior, follow issue #184 with disposable media. Platform does not promise
   recycle-bin restoration or purge timing.

Never manually change a Video to `deleted`: only a confirmed provider outcome may create the local
tombstone. Retain the operation and Video rows for audit and late-webhook suppression.
