# Issue 91 — Library search evidence

The screenshots were captured on 2026-08-31 from the exact production-owned Library component and
from the live PostgreSQL → Nest HTTP → Next server adapter → RSC route.

| Surface | Desktop | Mobile controls | Mobile result |
| --- | --- | --- | --- |
| Live route | [`live-desktop.png`](./live-desktop.png) | [`live-mobile.png`](./live-mobile.png) | [`live-mobile-results.png`](./live-mobile-results.png) |
| Storybook | [`storybook-desktop.png`](./storybook-desktop.png) | [`storybook-mobile.png`](./storybook-mobile.png) | [`storybook-mobile-results.png`](./storybook-mobile-results.png) |

- Live route: `/library?q=developer+pipeline&topic=platform`.
- Storybook: `Pages/Library/Production` (`Search results · desktop` and
  `Search results · mobile`).
- Desktop viewport: `1440 × 1024`; mobile viewport: `390 × 844`.
- The visible query, selected Topic, relevance sort, active-filter count, result count and safe
  closed-Material teaser are all owned by the canonical URL state.
- The live response contains the public title/summary only; the closed body is absent from the
  server-rendered HTML and catalog responses.
- Full-stack Playwright proves RU/EN queries, valid cursor share/reload/back/forward, no-results,
  malformed-value normalization and rejected-cursor recovery on real PostgreSQL in desktop and
  mobile Chromium.
- Backend integration pins title → summary → public-taxonomy ranking, proves OR within one facet,
  AND between facets, stable cursor binding, safe free/closed projections, natural GIN index use
  and a repeatable 10k-row search budget of p95 ≤ 300 ms.
- Storybook covers ready search results and no-results in addition to the existing loading, empty,
  continuation and error states. Agentation remains enabled for owner review.
- Owner production visual GO: explicitly granted on 2026-08-31.
- Owner merge GO: explicitly granted for this delivery chain.
