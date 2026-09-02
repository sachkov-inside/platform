# Issue 183 — Kinescope video UI evidence

Captured from the production-owned Storybook implementation on 2026-09-01 after module, build and
route E2E checks passed.

| State | Desktop | Mobile |
| --- | --- | --- |
| Ready privacy facade | [`reader-ready-desktop.png`](./reader-ready-desktop.png) | [`reader-ready-mobile.png`](./reader-ready-mobile.png) |
| Processing / provider failure | [`reader-failed-desktop.png`](./reader-failed-desktop.png) | [`reader-processing-mobile.png`](./reader-processing-mobile.png) |

- Desktop viewport: `1440 × 1024`; mobile viewport: `390 × 844`.
- The ready state makes no Kinescope request and creates no provider iframe before the visitor
  selects `Загрузить player`; both captures have no horizontal overflow.
- Processing and failed states preserve access to the Material body and expose literal,
  recoverable status copy.
- These captures use the deterministic test adapter and prove responsive UI composition only.
  They are not credentialed Kinescope evidence and do not satisfy the issue stopping condition.
- Live public/member playback, provider callback cadence, CSP/privacy behavior and owner visual GO
  remain pending the owner-gated Kinescope secret/test contour described in #183.

## Owner-approved real-provider probe — 2026-09-02

- A server-only Bearer token authenticated against the live Kinescope API. Two distinct, dedicated
  `Sachkov Inside Public` and `Sachkov Inside Membership` projects were created and their opaque IDs
  were stored only in the gitignored runtime environment.
- New projects defaulted to `privacy_type=anywhere`. The public project can use that policy, but the
  membership project remains intentionally unused for protected acceptance until an approved HTTPS
  host can serve the authorization callback.
- Upload init returned `201 Created`. A separate init crossed the production adapter's strict
  eight-second timeout; exact-title reconciliation confirmed that no smoke object remained from
  the unknown outcome.
- A bounded 6,503-byte, three-second synthetic MP4 completed Tus transfer in the public project and
  exposed `uploading` then `processing`, but did not reach provider `done` within the 180-second
  acceptance cutoff.
- Cleanup returned `200 OK`; exact-title queries confirmed zero remaining smoke objects in both
  dedicated projects. No token, project ID, upload endpoint or signed value was recorded.

This is partial credentialed protocol evidence, not the issue stopping condition. A later run still
needs provider `done`, public and protected playback, callback/license cadence, browser behavior and
continued-play evidence on the approved host.
