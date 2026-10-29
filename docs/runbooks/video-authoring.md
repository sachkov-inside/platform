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
3. Call `video_attach_existing` with `materialId`, `providerVideoId` and the Material's current
   access (`free` or `closed`). The recording must be in the protected (membership) project, which
   serves either access, or, for a free Material only, in the public project
   ([ADR 0041](../adr/0041-protected-recording-serves-any-access.md)).
   Repeating attachment to the same Material reuses the local Video, also after an access change. A different Material
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
`video_reconcile` and the same versioned Save. Stop on `upload_outcome_unknown` and inspect the
attempt/provider state; do not manufacture a fresh idempotency key for a blind retry.

### `pnpm authoring:video upload` (#1794)

For an imported Material, this command runs that sequence from a file on a local target
(`editor`, `stand`) or on the trusted `production` target, and journals each step. Content Studio
uses it to deliver an accepted master; the next `authoring:release` attaches the ready upload.

```bash
pnpm authoring:video upload --target production --state ~/.inside-authoring/production \
  --source inside-content:MATERIAL_ID --file MASTER.mp4 --sha256 HEX [--title TITLE]
```

- `--state` is the same state directory that `authoring:release` and `authoring:deliver` use for
  that target; the journal must already know the Material (released, or adopted through
  `authoring:deliver reconcile --adopt`). One command at a time holds that directory, for the
  whole transfer. If the Mac sleeps longer than two minutes, the journal lock may be treated as stale
  and the command may stop; repeat the same command, it continues from the server's offset.
- `production` uses the owner's Keychain session from `authoring:login`, like `authoring:release`,
  and stops when the target does not report the expected runtime. Local targets need no session.
- `--sha256` (64 lowercase hex characters) is required for `production` and optional for local
  targets. A file with another checksum is refused before any request and leaves the journal unchanged.
- The server creates the upload; the Kinescope token stays on the server. The command sends the
  bytes to the returned Tus endpoint in 8 MiB parts (`HEAD` for the offset, then `PATCH`), reading
  the file one part at a time. Only an HTTPS endpoint on `kinescope.io` or a subdomain receives bytes;
  the local test adapter's `.invalid` endpoint skips the transfer. A redirect is followed once, and
  only to another Kinescope HTTPS address. A request that fails without an answer, with 5xx, 408,
  409, 423 or 429 is repeated after 1, 3, 10 and 30 seconds, from the server's offset; then the run
  stops. Progress goes to stderr without the endpoint or tokens.
- The journal file (mode 0600) keeps the idempotency key, phase and endpoint under
  `upload:MATERIAL_ID:SHA256`. The endpoint grants upload access to that one attempt; the journal
  never holds a bearer token, offsets or media bytes. Repeating the same command continues an
  interrupted transfer from the server's offset without a new upload, and waits for processing
  again when it has not finished.
- When the provider no longer knows the upload (`HEAD` answers 404 or 410), the command stops and
  names the `videoId` and idempotency key; repeating it stops the same way. Report both to the owner.
  Starting a replacement upload is the owner's decision after checking that attempt in Kinescope
  and Platform; the command never starts one by itself and offers no way to discard the stored
  attempt (the local-only flags below discard only a test-adapter or public attempt). Do not edit
  the journal by hand.
- Success prints one JSON document on stdout with `target`, `sourceId`, `materialId`, `videoId`,
  `providerVideoId`, `durationSeconds`, `sha256` and `next`, and exits 0. The journal then holds
  `source-video:SOURCE_ID`, which the next release attaches as the primary Video.
- Any stop exits non-zero with a message on stderr: no session (`pnpm authoring:login` hint), wrong
  runtime, checksum mismatch, an unsynchronized Material, an endpoint outside Kinescope,
  `Upload-Length` different from the file size, a refused or exhausted transfer, a file changed
  during the transfer, a failed provider video, or processing still under way (repeat later). The
  checksum, size and transferred bytes come from one open handle; when the file's device, inode,
  size or modification time differ after the transfer, the attempt stays in `transfer` and the
  repeated command hashes the file again. `upload_outcome_unknown` stops and names the
  idempotency key; inspect the attempt, the command never creates a new key for it. Only a failed
  provider video lets the same file start a new attempt.

On a local stand that now runs the real Kinescope adapter, a file uploaded earlier through the test
adapter still has a `ready` receipt whose endpoint ends in `.invalid`, so a rerun returns the fake
provider ID. `--replace-test-upload` discards that receipt, and the `source-video:SOURCE_ID` receipt
when it names the same `videoId`, then uploads the file as new with a fresh idempotency key. It is
refused on trusted targets before any request. Any other stored receipt for this file, or none,
is left as it is and the command runs as without the flag: it continues an unfinished upload or
returns the ready one. So an interrupted run can be repeated with the same flag.

A file uploaded before [ADR 0041](../adr/0041-protected-recording-serves-any-access.md) for a free
lesson has a receipt whose recording is in the public project, so a rerun returns that public
recording. `--replace-public-upload` asks the target about the stored attempt's Video
(`POST /authoring/videos/VIDEO_ID/reconcile`) and discards the receipt only when the answer says
`protected: false`, together with the `source-video:SOURCE_ID` receipt when it names the same
`videoId`; the file then uploads as new into the protected project. This covers a ready, `transfer`
or `processing` attempt; a failed one starts anew anyway. An `initializing` attempt holds no Video
yet: its replayed init answer names the recording, and a public one is discarded the same way
before any byte is sent. A protected recording, a test-adapter receipt (`--replace-test-upload`
owns it) or no receipt leaves the command as without the flag, so the same command can be
repeated. A target that does not report `protected` (a source before ADR 0041) stops the command:
for a stored Video with the journal unchanged, for an init answer before any byte is sent, with the
attempt kept in `initializing`. A reconcile error, such as `provider_mismatch` (Kinescope no longer
reports the recording in its project) or `video_not_found` (the stand database was reset), also
stops it with the journal unchanged; report the source and `videoId` to the owner. The flag is
refused on trusted targets before any request. The command deletes nothing at the provider; the
public recording stays in Kinescope until the owner removes it.

`authoring:release preview` lists every such upload in `videoUploads` (`sourceId`, `state`
`pending` or `ready`, `sha256`), and each Material row carries its own `videoUploads`. Apply attaches
only a `ready` upload; a pending one leaves the Material's Video unchanged. The Material keeps its
publication state; uploading does not publish anything.

### One recording for stand and production

Every upload lands in the protected Kinescope project, whatever the lesson's access, so the same
provider recording serves the stand and production and survives a later change of access
([ADR 0041](../adr/0041-protected-recording-serves-any-access.md)). The contract with Content Studio:

1. Upload an accepted master once, through one target: `--target stand` while the stand runs the
   real adapter (`pnpm stand:kinescope status`), otherwise `--target production`. Keep the printed
   `providerVideoId`; a stand on the test adapter prints a fake one, which no other target knows.
2. Record it in the lesson source as `platform_video.kinescope_id: PROVIDER_VIDEO_ID` and commit.
3. Every target attaches that ID through its ordinary sync or `authoring:release`
   (`row.video.kinescopeId`): no target uploads the bytes again, and a production publication is
   the same release with `--publish`. The uploading target keeps a `platform_upload`; the others
   hold an `external_attachment`, which Platform never deletes at the provider.
4. Access is ordinary source content. Opening or closing the lesson later is a release with an
   `accessChange` and no `videoChange`. Only a recording in the public project cannot serve a
   closed lesson: the preview names it `video_not_protected` (the target would refuse the Save with
   `video_provider_mismatch`); upload the master to the protected project and record the new ID.
   When the stand journal already holds the public upload of that master, the upload needs
   `--replace-public-upload` (see above). A
   target that predates ADR 0041 refuses any access change of a lesson that keeps its Video, which
   the preview names `video_access_change`.

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
