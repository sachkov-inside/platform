---
status: accepted
---

# A protected recording serves a lesson of any access

The owner asked on 2026-10-28 for a mechanism that lets a course lesson move between free and
closed without a new upload: «Пока что все главы будут закрыты, но дело в том, что позже они могут
открыться, поэтому нам надо как-то сделать механизм так, чтобы видео могло быть бесплатным, потом
стать платным и наоборот.» The same recording should also serve the local stand and production, so
a master is uploaded to Kinescope once.

Until now the Kinescope project followed the Material's access: `free` in the public project,
`closed` in the membership project. A Video kept its project, so changing a lesson's access needed a
new upload, and `authoring:release` refused such a change as `video_access_change`.

## Decision

Platform uploads every recording to the protected project (configured as
`KINESCOPE_MEMBERSHIP_PROJECT_ID`): encrypted, with the strict authorization backend. Platform
issues a playback token for every recording in that project, including to an anonymous viewer of a
free lesson. The token names the viewer (an empty subject for an anonymous one), and the provider
callback repeats `ContentAccess` for the lesson's current access. Opening or closing a lesson is an
ordinary Material Save; the recording, its provider ID and its embed link stay the same, and the
next licence request follows the new access.

A Video records the protection of its project when it is uploaded or attached: stored access
`closed` means the protected project. A closed Material accepts only a protected recording; a free
Material accepts a recording from either project. The public project keeps existing free recordings
and new attachments of public recordings by ID, which play without a token and can never serve a
closed Material. Platform refuses a recording from any other project.

`authoring:release` treats an access change like any other content change. Its preview still names
two cases the target would refuse: `video_not_protected` when a lesson with a public recording
would close, and `video_access_change` for any access change of a lesson that keeps its Video on a
target that predates this decision (it reports no protection for the recording). A replacement
recording named by ID is new to the preview; the target checks it on apply.

## Considered alternative

Kinescope can move a video between projects (`PUT /v1/videos/:video_id/move`) and keeps its ID.
Moving on every access change was rejected: Kinescope does not document whether a moved recording
becomes encrypted or keeps its embed link, a closed lesson would leak while an unencrypted copy
stays playable, the Save would depend on a provider write with its own failure and retry states,
and the stand, which holds a production token but must never change provider videos, could not
make the move.

## Consequences

- A free lesson's video plays through DRM and the authorization backend: each licence request calls
  production, and a browser without DRM support cannot play it. Free recordings outside courses may
  still be attached from the public project when that matters more than a later change of access.
- The protected project needs encryption before the backend is asked at all. Its authorization
  backend is set on the project, never for the whole workspace, so public recordings keep playing
  without a token.
- A rollback to a release before this decision fails closed: older code compares stored access with
  the Material's access, refuses playback of a protected recording on a free lesson and does not
  open anything. A retried upload of a free lesson started under this decision then answers
  `idempotency_key_reused`, because older code expects the public project; the author starts a new
  upload.
- Changing the protected project ID does not move earlier recordings; their stored protection keeps
  their playback, and a new Save of their Material checks the configured projects again.
