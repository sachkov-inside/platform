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
