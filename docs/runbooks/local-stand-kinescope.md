# Real Kinescope on the local stand

Owner decision of 2026-10-28 (#1790): the shared stand may play course video from the production
Kinescope account and its two projects, so the owner reviews a lesson with its real recording
before production. The stand keeps its own database and signing keys; only provider access is
shared. Production provider settings are in [runtime configuration](runtime-configuration.md#kinescope-provider-settings).

## Switch on and off

Provider access comes from the production runtime file and goes straight into a private stand file,
`.identity-proof/stand-kinescope.env` in the primary checkout (`0600`). The command keeps only the
API token, both project IDs and the provider base URLs, adds `KINESCOPE_PROVIDER_MODE=real` and
prints no values:

```bash
ssh inside-production "grep -E '^KINESCOPE_(API_TOKEN|PUBLIC_PROJECT_ID|MEMBERSHIP_PROJECT_ID|API_BASE_URL|UPLOADER_BASE_URL)=' /etc/inside/runtime/api.env" | pnpm stand:kinescope import
pnpm stand:kinescope status
pnpm stand refresh --worktree <reserved worktree>
```

Run `refresh` from the registered controller checkout (`pnpm stand status`); that checkout must
contain this overlay and the matching source fingerprint, otherwise `api` keeps the test adapter
whatever the file says. `pnpm stand:kinescope status` reports the file, not the running roles. The
file is part of the stand source fingerprint, so `refresh` recreates the application roles with it. The first
switch to a source that contains `config/compose/local/stand-kinescope.compose.yaml` changes the
stand infrastructure and needs `pnpm stand upgrade` once. `pnpm stand:kinescope remove` followed
by `refresh` returns every role to the deterministic test adapter.

## What the stand does with it

- `api` and `mcp` use the real adapter. Uploads from the editor, MCP or `authoring:video --target
  stand` create provider videos in the production membership project, whatever the lesson's access
  ([ADR 0041](../adr/0041-protected-recording-serves-any-access.md)). Production's database
  references such a recording only after the lesson source records its provider ID and a production
  release attaches it, so one upload serves both targets ([video authoring](video-authoring.md#one-recording-for-stand-and-production)).
- `video-deletions-worker` never receives the file and keeps the test adapter without a token, so
  the stand cannot delete or change a provider video. Deleting a stand upload only tombstones the
  local row; remove the provider copy in the Kinescope dashboard if it is no longer needed. Give
  stand uploads a recognisable title (for example `[стенд] …`) for that cleanup.
- Readiness comes from polling: the editor, MCP `video_reconcile` and `authoring:video` call
  `reconcile`, which reads the video from the Kinescope API. Provider webhooks keep pointing to
  production, which stores an unmatched event for a stand upload and does nothing else.
- Videos recorded before the switch hold test-adapter provider IDs and the placeholder projects;
  they never played. A Save that keeps one fails with `video_provider_mismatch`, including a
  release that only preserves it. Detach them once after the switch:
  `pnpm stand:kinescope detach-test-videos` clears those references and their chapters in one
  transaction, keeps the Video rows and prints how many Materials it changed. It writes to the
  shared stand database, so run it for the reserved review or on the owner's request. It bypasses
  the editor: reload an open editor tab, and a cached public page may show the old player until
  the next Save of that Material. Upload the recording again with
  `authoring:video upload --target stand … --replace-test-upload`, so the journal drops its
  test-adapter receipt, then sync the lesson.

## Course recordings from the public project

Before [ADR 0041](../adr/0041-protected-recording-serves-any-access.md) the stand's first chapter was
free, so its uploads went to the public project. Such a recording cannot serve a closed lesson: once
the course profile keeps Content's access, the release preview names the lesson with
`video_not_protected` and changes nothing. List those lessons on the stand (read-only):

```bash
docker exec inside-platform-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select m.source_id, v.provider_video_id from materials.materials m join videos.videos v on v.id = m.primary_video_id where v.access = '"'"'free'"'"' and m.source_id is not null"'
```

For each lesson, give it a protected recording and let the ordinary sync replace the Video:

1. When production already holds a protected recording of the same master, use its provider ID.
   Otherwise upload the master once with `authoring:video upload --target stand` from a source that
   contains ADR 0041; the upload lands in the membership project.
2. Record the ID in the lesson source as `platform_video.kinescope_id` and commit it
   ([contract](video-authoring.md#one-recording-for-stand-and-production)).
3. Run the course sync. The release attaches the protected recording, selects it and applies the
   lesson's access in one Save; production later attaches the same ID.
4. The old public copies stay in Kinescope, because the stand never deletes provider videos. The
   owner removes them in the dashboard once no target references them.

## Risk of the production token

The production token can also delete: Kinescope documents no read-and-upload-only token for both
projects. "No deletion" therefore rests on the stand's code paths, not on the token. Any process
that reads the private file or inspects the `api`/`mcp` containers can use the token directly, and
`remove` takes it out of running roles only after `refresh`. Uploads from the stand also count
against the production account and need manual cleanup. These effects follow from the owner's
decision to use the production projects (#1790); a narrower token, if Kinescope offers one, replaces the copied value without other changes.

## What plays

| Recording | Stand playback |
| --- | --- |
| Public project (older free recordings) | Plays when the project's allowed domains include the stand host `127.0.0.1` (the stand opens on `http://127.0.0.1:3000`), or have no restriction. |
| Membership project (every new upload, free or closed lesson) | Plays only while the project has no authorization backend. After the backend is on, Kinescope asks production, which refuses a token signed by the stand (other key, unknown local Video), so the player stays locked. |

Closed playback on the stand therefore ends when production protection starts. Keeping it needs
production to trust a separate stand signing key for preview tokens: a production code change, a
production secret and a deployment, and whoever holds the stand key can unlock any membership
video for a few minutes. That is an owner decision, not part of this setup.
