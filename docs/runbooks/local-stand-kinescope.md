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
ssh inside-production "grep '^KINESCOPE_' /etc/inside/runtime/api.env" | pnpm stand:kinescope import
pnpm stand:kinescope status
pnpm stand refresh --worktree <reserved worktree>
```

Run `refresh` from the registered controller checkout (`pnpm stand status`). The file is part of
the stand source fingerprint, so `refresh` recreates the application roles with it. The first
switch to a source that contains `config/compose/local/stand-kinescope.compose.yaml` changes the
stand infrastructure and needs `pnpm stand upgrade` once. `pnpm stand:kinescope remove` followed
by `refresh` returns every role to the deterministic test adapter.

## What the stand does with it

- `api` and `mcp` use the real adapter. Uploads from the editor, MCP or `authoring:video --target
  stand` create provider videos in the production projects: `free` in the public project, `closed`
  in the membership project. Production's database never references them.
- `video-deletions-worker` never receives the file and keeps the test adapter without a token, so
  the stand cannot delete or change a provider video. Deleting a stand upload only tombstones the
  local row; remove the provider copy in the Kinescope dashboard if it is no longer needed. Give
  stand uploads a recognisable title (for example `[стенд] …`) for that cleanup.
- Readiness comes from polling: the editor, MCP `video_reconcile` and `authoring:video` call
  `reconcile`, which reads the video from the Kinescope API. Provider webhooks keep pointing to
  production, which stores an unmatched event for a stand upload and does nothing else.
- Videos recorded before the switch hold test-adapter provider IDs; they never played and do not
  play now. Upload the recording again.

## What plays

| Lesson access | Stand playback |
| --- | --- |
| `free` (public project) | Plays when the project's allowed domains include the stand origin, or have no restriction. |
| `closed` (membership project) | Plays only while the project has no authorization backend. After the backend is on, Kinescope asks production, which refuses a token signed by the stand (other key, unknown local Video), so the player stays locked. |

Closed playback on the stand therefore ends when production protection starts. Keeping it needs
production to trust a separate stand signing key for preview tokens: a production code change, a
production secret and a deployment, and whoever holds the stand key can unlock any membership
video for a few minutes. That is an owner decision, not part of this setup.
