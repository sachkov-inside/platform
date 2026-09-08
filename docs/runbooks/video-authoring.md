# Video authoring through MCP

Platform #445 supplies this first agent attachment slice of #444. It uses the existing Material and
Videos facets, delegated Account, project/access validation and optimistic Material Save.
Kinescope API tokens remain server-only. The MCP client needs its own delegated Logto session;
an SSH connection or provider API token does not authenticate a Material author.

## Existing recording

1. Identify the exact provider UUID and verify the recording, duration and allowed Kinescope
   project. This slice does not yet expose catalog search; use the provider catalog for discovery.
2. Load the target with `material_load`, or create a never-published Material through
   `material_create_draft` using a stable idempotency key. Preserve its complete body and metadata.
3. Call `video_attach_existing` with `materialId`, `providerVideoId` and the Material access
   (`free`, `membership` or `workshop`). The provider ID must match the configured project.
   Repeating attachment to the same Material/access reuses the local Video. A different Material
   cannot silently take the same provider Video. This does not select the primary Video yet.
4. Call `video_reconcile` with the returned local `videoId`. Processing is not ready playback.
5. Call `material_save` with the loaded `expectedContentVersion`, complete state, a stable
   idempotency key and `primaryVideoId` set to that local `videoId`. Keep the intended
   `publicationState`; saving a published Material changes live content immediately.
6. Reload and use `material_preview`. If Save returns `stale_content_version`, reload and resolve
   the change; do not overwrite an unknown version. Attachment may already have succeeded when
   Save fails; reuse it after reconciling instead of uploading another copy.

Every subsequent MCP Save explicitly carries `primaryVideoId`. Null detaches; it does not delete
an externally attached recording. The MCP tool intentionally does not expose provider deletion.

## New file

`video_init_upload` accepts `materialId`, access, filename, byteSize, title and idempotencyKey.
It returns the same limited Tus endpoint and Video identity as the editor. The MCP call does not
transfer bytes. A Tus client transfers the local file outside the model context, followed by
`video_reconcile` and the same versioned Save. A packaged local-file transfer runner, cancellation
and batch reports remain #444. Stop on `upload_outcome_unknown` and inspect the attempt/provider
state; do not manufacture a fresh idempotency key for a blind retry.

## Links to a video moment

Reader links support `#t=<whole seconds>`, for example `/materials/example#t=261`. The explicit
moment, including zero, wins over resume. Invalid, duplicate, negative, fractional or out-of-range
values fall back to normal resume. Changing the hash on the same page seeks the mounted player.
The link does not grant playback access: the normal session and DRM authorization still apply.

Structured chapter persistence, a chapter list beside the player, active-chapter highlighting,
editor controls and Kinescope chapter synchronization remain #444. This change supplies the time
link mechanism; it does not claim those interfaces or canonical chapter synchronization exist.
A local editorial list is not evidence of chapter accuracy on the provider recording.

## Verification and remaining acceptance

The focused MCP integration uses real PostgreSQL, Account authorization, Material versioning and
Videos ownership, with a local provider double. Browser playback checks replace only Kinescope's
SDK; real BFF/API authorization and progress persistence remain in the path. Neither proves real
Kinescope playback. Provider acceptance remains #184; deploy and publishing require owner approval.
The first generated cover stays an unapproved editorial asset until the owner accepts it.
