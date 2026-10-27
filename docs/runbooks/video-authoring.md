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
   (`free` or `membership`). The provider ID must match the configured project.
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
`video_reconcile` and the same versioned Save. For an imported Material in a local environment,
`pnpm authoring:video upload` runs this sequence from a file and journals the attempt; see the
[local authoring runbook](./local-acceptance-authoring.md#local-obsidian-authoring-preview-468). It accepts
only the test adapter; cancellation, batch reports and real provider transfer are not packaged. Stop on `upload_outcome_unknown` and inspect the attempt/provider
state; do not manufacture a fresh idempotency key for a blind retry.

## Links to a video moment

Reader links support `#t=<whole seconds>`, for example `/materials/example#t=261`. The explicit
moment, including zero, wins over resume. Invalid, duplicate, negative, fractional or out-of-range
values fall back to normal resume. Changing the hash on the same page seeks the mounted player.
The link does not grant playback access: the normal session and DRM authorization still apply.

Imported Materials persist video chapters from their original, and the reader lists them beside
the player with the current chapter highlighted. The editor’s «Видео» document block can override chapters and add a description. Kinescope
chapter synchronization does not exist.
A local editorial list is not evidence of chapter accuracy on the provider recording.

## Verification and remaining acceptance

The focused MCP integration uses real PostgreSQL, Account authorization, Material versioning and
Videos ownership, with a local provider double. Browser playback checks replace only Kinescope's
SDK; real BFF/API authorization and progress persistence remain in the path. Neither proves real
Kinescope playback. Provider acceptance remains #184; deploy and publishing require owner approval.
The first generated cover stays an unapproved editorial asset until the owner accepts it.

## Position within a Material (#1741)

The Material still owns one primary Video through the existing attachment/upload flow. In the editor,
insert «Видео» from the block menu at the desired position between paragraphs. Move it with the
ordinary block controls. Its description and chapters belong to the saved document; chapters must
have nonempty titles and increasing nonnegative whole-second starts within the recording duration.
Only one top-level video block is accepted. Removing the block keeps the attached recording and
restores the legacy placement above the text. Detachment and deletion remain in the Video panel.
A document with only a video block is a video lesson; surrounding ordinary blocks make it a mixed lesson.

For source-authored Markdown, a `video` fence carries the same context and no provider URL or ID:

````markdown
Introduction.

```video
{"description":"Demonstration recording","chapters":[{"start":0,"title":"Introduction"},{"start":37,"title":"Example"}]}
```

Continue reading here.
````

The fence controls placement of the primary Video selected through `platform_video` or attachment.
Omitted chapter metadata retains imported chapters; an explicit empty chapter list hides them.
Old documents without the block keep their primary Video above the text.
