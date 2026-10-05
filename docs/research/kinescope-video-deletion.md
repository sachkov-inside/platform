# Kinescope video deletion semantics and safe Platform policy

## Scope

This note records what Kinescope's first-party documentation and published OpenAPI contract say
about deleting a video as of 2026-09-02. No provider mutation was performed. In particular, this
research did not call `DELETE`, did not create disposable media, and did not inspect local API
tokens or environment files.

The main product question is not only whether Kinescope exposes a delete method, but when Platform
may safely use it. Platform supports both uploads that it initiated and attachment of an existing
Kinescope video ID; those two origins must not have the same destruction policy.

## Executive decision

Kinescope exposes `DELETE /v1/videos/{video_id}`, but Platform should treat it as an irreversible,
asynchronous cleanup operation, separate from removing a video from a Material.

Recommended policy:

1. `Remove from Material` only detaches the relation. It must not call Kinescope.
2. `Delete video everywhere` is available only for a video whose local provenance proves that
   Platform created the upload. A manually attached Kinescope video is detach-only.
3. Provider deletion runs from an outbox/job after a database transaction has detached the video,
   rechecked that no Material references it, and recorded an audit event.
4. The worker treats `200 {"data":{"success":true}}` as deleted and a `404` after previously
   verified ownership as convergence to the same absent state. It retries ambiguous timeouts,
   `429`, and `5xx` with a stable operation ID and bounded backoff; `401`/`403` require operator
   action.
5. Until a disposable-account probe or a written Kinescope answer resolves the API-versus-recycle-
   bin contradiction, Platform must not promise restore, retention, or immediate storage savings.
6. Physical deletion of `uploading` or `processing` media remains disabled until its interaction
   with the active Tus upload and transcoding has been verified against real disposable media.

This gives an administrator an immediate, reliable detach operation while keeping an explicitly
destructive provider operation narrow, observable, and retryable.

## Confirmed API contract

### Endpoint and response

The Kinescope API reference documents a single-resource endpoint:

```http
DELETE https://api.kinescope.io/v1/videos/{video_id}
Authorization: Bearer <ACCESS_TOKEN>
```

The documented success response is HTTP 200 with `{"data":{"success":true}}`. The endpoint takes
only `video_id`; it has no request body, project parameter, conditional version, dry-run flag, or
idempotency key. The reference describes the operation as permanently deleting the video and says
it cannot be undone. See the official [API reference](https://docs.kinescope.com/api/) and the
published [OpenAPI operation](https://github.com/kinescoper/kinescope_openapi/blob/e5a5a4d1fc55cc983b707ee73cb47ef27efbf21d/kinescope-api-openapi.yaml#L3347-L3435).

The documented error surface is:

- `400` for malformed input; the OpenAPI example is `400301 invalid uuid format`;
- `401` for missing or invalid authentication;
- `403` for access denied;
- `404` when the object is not found.

Kinescope's [general API rules](https://docs.kinescope.com/developer-guides/api-general-rules/)
add that `404` can mean that a resource does not exist or is not visible to the token, and their
example detail also covers a resource that has been deleted. Consequently, a first `404` must not
be used as proof that Platform owned and deleted the media. It is safe to treat `404` as an
idempotent success only after Platform has already established provenance and provider visibility.

HTTP `DELETE` expresses an idempotent desired state, but the published contract does not return the
same response on every repetition: the first call may return `200`, while a later call may return
`404`. There is no documented provider idempotency key. A timeout is therefore an unknown outcome,
and the Platform job needs reconciliation rather than a synchronous all-or-nothing assumption.

All API responses include `X-Request-ID`; Kinescope asks clients to use it for support. The general
limits are 10 requests per second and 300 per minute, with `429` on excess. The published OpenAPI
contains no bulk video-destruction endpoint: its video delete operation accepts one `video_id`.
`DELETE /v1/playlists/{playlist_id}/entities` is a different operation which only removes media
from a playlist and must not be confused with deleting the video object.

### Authentication, workspace and projects

Every request uses a Bearer API token. A token is tied to one workspace, and Kinescope derives the
workspace from the token; callers do not pass a workspace ID. Kinescope recommends a separate
server-side token per integration because anyone who obtains a broad token can act with its
workspace authority. See [API authentication](https://docs.kinescope.com/api/getting-started/authentication/)
and the [general API rules](https://docs.kinescope.com/developer-guides/api-general-rules/).

The access-token examples expose separate `read`, `write`, and `delete` API permissions. A token
used for this operation therefore needs API `delete` authority in addition to whatever read/write
authority the upload pipeline uses. The API's `403` response covers a valid token without access
to the resource or action. Kinescope's Dashboard roles separately show that Editors and Guest
Editors may delete media while Managers and Guest Managers may not; those human-role rules do not
replace the integration token scope. See the first-party [token API examples](https://docs.kinescope.com/api/)
and [team access rights](https://docs.kinescope.com/team-management/team-access-rights/).

The delete URL contains no project ID. Visibility and authorization come from the token and the
video object. A video returned by the API carries a `project_id`, but project membership alone is
not proof that Platform created it. In particular, a human can place a manually managed video into
the same project, and Platform can attach an existing provider ID without uploading its bytes.
Platform must persist its own provenance at upload initialization and never infer destruction
ownership merely from `GET` visibility or a matching project.

The documentation does not establish that a project-scoped *upload* token can invoke the general
REST video delete endpoint. The access-token examples distinguish an `api` scope from an `upload`
scope, so deployment must use a deliberately scoped API token whose effective delete permission
has been verified without assuming that uploader permissions are interchangeable.

## Permanent delete versus recycle bin

The first-party documentation currently contains a material contradiction:

- the API reference says that `DELETE /v1/videos/{video_id}` permanently deletes the video and
  cannot be undone;
- the Dashboard catalog documentation says deleted files go to a recycle bin, remain restorable,
  and continue occupying billed storage until the bin is emptied.

The [recycle-bin guide](https://docs.kinescope.com/catalog-and-video-management/recycle-bin/)
documents a default 30-day retention period configurable to immediate deletion, 7 days, 30 days,
1 year, or indefinitely. It says users with Editor, Editor Plus, and Administrator roles can
restore or permanently remove items. The [media-library guide](https://docs.kinescope.com/catalog-and-video-management/organizing-media-library/)
explicitly describes that behavior for files deleted through the catalog.

The published OpenAPI specification has no documented trash listing, restore, or permanent-purge
operation, and the video `DELETE` response contains no `deleted_at`, retention deadline, or restore
token. Absence from the published specification is not proof that no internal Dashboard API
exists; it does mean Platform cannot build a supported restore workflow from the public contract.

Therefore the safe Platform assumption is that public-API deletion is irreversible. The UI must
use destructive wording and must not promise a recovery window. Before production rollout, one
disposable video should be deleted with the public API and checked in both the normal catalog and
the Dashboard recycle bin, or Kinescope support should confirm the distinction in writing.

## Uploading and processing media

Kinescope initializes large uploads through `POST https://uploader.kinescope.io/v2/init` and then
the browser sends Tus chunks directly to a separate upload endpoint. The initialization response
contains both a media ID and the Tus endpoint. See the official [Tus integration guide](https://docs.kinescope.com/developer-guides/tus-protocol-implementation/).

The video delete contract has no documented status restriction, but Kinescope does not specify:

- whether deleting an `uploading` video invalidates the outstanding Tus URL;
- whether later chunks can recreate or mutate the deleted media;
- whether transcoding is cancelled when a `pending`, `pre-processing`, or `processing` video is
  deleted;
- whether the result becomes `aborted`, disappears immediately, or generates another event;
- whether incomplete uploaded bytes remain billable after the operation.

The provider's documented video statuses are `pending`, `uploading`, `pre-processing`,
`processing`, `aborted`, `done`, `error`, and `suspended`. There is no documented `deleted` status.
The official [webhook type reference](https://docs.kinescope.com/developer-guides/webhook-types/)
only documents `media.update.status` for video lifecycle changes and does not document a video-
deleted event.

Platform should consequently stop the local upload client first, mark the video as a deletion
candidate, and not issue provider deletion for an active upload/processing status until the real-
provider behavior is proven. Late `media.update.status` webhooks must be ignored once a local
deletion tombstone exists; the deletion job must reconcile with `GET /v1/videos/{video_id}` rather
than wait for an undocumented delete webhook.

## Billing and storage

Kinescope bills all stored originals, transcoded renditions, audio tracks, attachments, and
subtitles. Storage usage is recalculated daily, so deleting data during the month lowers later
storage usage rather than refunding the entire month's history. Transcoding is billed once when a
new video is uploaded and is not described as refundable on deletion. See the official
[pricing and billing guide](https://docs.kinescope.com/pricing-and-billing/kinescope-pricing-plans/).

Items in the Dashboard recycle bin remain billable. Because the documentation does not reconcile
that behavior with the public API's claim of permanent deletion, Platform must verify the provider
side effect before presenting deletion as an immediate cost-saving measure. Operational metrics
should track both local deletion completion and Kinescope storage separately.

## Recommended Platform lifecycle

### Provenance

Persist enough immutable provider metadata when the Video row is created:

- `origin = platform_upload | external_attachment`;
- provider video ID and the configured provider project ID used for initialization;
- upload operation ID / creator integration version;
- creation timestamp and actor;
- deletion state, request timestamp, completion timestamp, attempt count, last provider status,
  last error category, and provider `X-Request-ID` when available.

`external_attachment` is never provider-deletable from Platform, even if it currently lives in a
dedicated Platform Kinescope project. The administrator may detach it and delete it manually in
Kinescope. If a future product need requires taking ownership, use a separately specified copy or
import workflow that creates a new Platform-owned video rather than silently changing provenance.

### Commands

Expose two deliberately different actions:

- **Remove from Material** — update the Material relation only; it is reversible by attaching the
  video again and does not affect Kinescope.
- **Delete Platform upload** — explicit confirmation; allowed only for `platform_upload`; first
  detach it from the current draft and enqueue cleanup. If another draft or published Material
  still references it, reject destruction and show those references.

Do not couple provider destruction to ordinary Material Save. A network failure at Kinescope must
not roll back or ambiguously fail the author's content edit.

### Job state machine

One workable minimal state machine is:

```text
active -> deletion_requested -> deleting -> deleted
                                \-> delete_failed
```

The job locks the Video row, rechecks provenance and a zero-reference invariant, and then calls the
provider outside the authoring request. Suggested outcome mapping:

- `200 success=true`: mark `deleted` and retain a local tombstone/audit record;
- `404`: if provenance and earlier visibility were established, mark `deleted`; otherwise flag
  `delete_failed` for investigation;
- timeout/network/`429`/`5xx`: keep `deletion_requested`, retry with exponential backoff and jitter;
- `400`: terminal integration/data error;
- `401`/`403`: terminal configuration/permission error with an operator alert.

A stable local operation ID prevents duplicate jobs even though Kinescope exposes no documented
idempotency key. The tombstone also prevents a late processing webhook from reviving the row.

## Provider acceptance still required

Before enabling `Delete Platform upload` in production, use disposable media to prove:

1. `done` video: delete response, subsequent GET/list/player behavior, Dashboard recycle-bin
   presence or absence, and storage reporting;
2. repeated delete and timeout/retry reconciliation;
3. an ID from another workspace or a project invisible to the token: exact `403`/`404` behavior;
4. a token without API `delete` permission: exact failure behavior;
5. `uploading`, interrupted Tus, `processing`, `error`, and `aborted` videos;
6. late webhook delivery after local deletion request;
7. a manually attached video is detach-only and cannot reach the provider-delete adapter;
8. one Platform-uploaded video referenced by two Materials cannot be destroyed until both
   references are removed.

Until those checks are green, the complete safe product is detach plus auditable manual Kinescope
cleanup, not automated physical deletion.

## Unknowns requiring Kinescope confirmation

- Does the public `DELETE /v1/videos/{video_id}` bypass the Dashboard recycle bin, or does the API
  reference's “permanent” wording conflict with current backend behavior?
- Is there a supported public restore/purge API that is absent from the published OpenAPI?
- What exact response does a repeated delete return in production?
- Does delete revoke a live Tus URL and cancel transcoding atomically?
- Is any `media.update.status` webhook emitted after deletion, and can already queued webhooks
  arrive after the object disappears?
- When exactly do deleted bytes stop contributing to storage usage, especially if a recycle-bin
  retention period is configured?
- Can a project-scoped upload token call the REST delete endpoint, or is an `api.delete` scope
  mandatory?

These are bounded provider questions. They do not block implementing the local provenance,
detach, reference guard, outbox, audit, retry, and tombstone mechanics.
