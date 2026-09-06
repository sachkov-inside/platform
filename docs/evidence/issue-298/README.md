# Connected steps within mixed Series — #298

Production implementation: [PR #300](https://github.com/sachkov-inside/platform/pull/300).
Core implementation `474a4a2`; final fixture assertions `ce06d8d`.
Content contract alignment: [Inside Content #5](https://github.com/sachkov-inside/inside-content/pull/5).

## Observed result

The live `/series/demo-series-release` contains six ordered entries: video, preparation guide,
Docker video, note, environment guide, deployment guide. The three guides explicitly belong to
“От проекта до релиза” and show steps 1/3, 2/3 and 3/3 at overall positions 2, 5 and 6.
The same preparation guide in `/series/demo-series-release-shared` has no step mark. Reader for
that guide in the release Series remains position 2/6 and goes next to the Docker video.
There is no second Reader path, format-based inference, or main/optional role.

Root coordinator independently reviewed the live Series, shared Series and Reader, then reviewed
the rebuilt foreground label and mobile screenshot: visual GO. Browser was released afterward.

## Responsive evidence

Captured from the real Compose API/web after rebuilding the foreground-contrast correction.
All application data comes from development seed through the production adapter, not Storybook.

- [Desktop, 1440 × 1024](series-desktop.png)
- [Desktop lower steps](series-desktop-steps.png)
- [Mobile, 390 × 844](series-mobile.png)
- [Mobile lower steps](series-mobile-steps.png)
- [Same guide in another Series](shared-series-desktop.png)
- [Reader retains the mixed Series next item](reader-desktop.png)

Mobile DOM measurement: document scrollWidth = innerWidth = 390. All three badges present in
published order. Shared Series badge count = 0. Temporary viewport override was reset, evidence
tab closed; the coordinator's deliverable tab remains available.

## Verification

Pinned Node 24.19.0 / pnpm 11.22.0 root `pnpm check` passed: backend 296 tests, Web/module/Storybook
341 tests, Playwright 39 passed / 3 environment-conditional skipped, builds and guardrails green.
PostgreSQL suite: all 152 tests passed after updating demo cardinality and migration-registry
expectations. Hosted Integration separately passed on the corrected commit. MCP round-trip includes
a normalized step assignment.

Storybook uses the production public and authoring modules, with connected steps desktop/mobile
and real composition-mutation form assertions. Its accessibility checks caught accent-on-secondary
contrast 4.3:1 in the first iteration; the corrected foreground text passed the unmodified checks.
Live CUA console showed only the known development Agentation localhost session fallback warning.
Final full-stack and CI closure are recorded in the PR.

## Limits and runtime

These are explicitly labelled test materials, not Kirill's real content. Real provider video
playback, content import and production deployment were not performed. The local provider is the
existing deterministic test adapter. Automatic Git import remains #289.

Singleton `inside-platform` retains named PostgreSQL/object-storage volumes. The owner can inspect
`http://127.0.0.1:3000/series/demo-series-release`. Stop without removing data:

```sh
docker compose -p inside-platform stop
```
