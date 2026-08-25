# Issue 90 — production Library evidence

Captured from the implementation branch on 2026-08-25 after the real PostgreSQL full-stack smoke
and automated accessibility checks passed.

| Surface | Desktop | Mobile |
| --- | --- | --- |
| Live PostgreSQL → Nest → Next route | [`live-desktop.png`](./live-desktop.png) | [`live-mobile.png`](./live-mobile.png) |
| Exact production-owned Storybook component | [`storybook-desktop.png`](./storybook-desktop.png) | [`storybook-mobile.png`](./storybook-mobile.png) |

- Live route: `/library`
- Storybook: `Pages/Library/Production` (`Ready · desktop` and `Ready · mobile`)
- Desktop viewport: `1440 × 1024`
- Mobile viewport: `390 × 844`
- The live route renders two real local-seed publications through PostgreSQL → Nest HTTP → the
  server-only Next adapter: one free Material and one membership Material.
- Catalog responses and rendered cards expose only safe projections; the closed Material body is
  absent from the HTTP payload and page.
- Keyboard smoke covers the skip link, Material links and pagination controls. Automated desktop
  and mobile checks report no serious or critical axe findings and no horizontal overflow.
- Operational stories cover ready, pagination, loading, empty, controlled infrastructure error and
  unexpected error. Every route-level state preserves the Library page heading and recovery path.
- Agentation is enabled on the exact Storybook surface for interactive owner review.
- Owner production visual GO: pending. Merge GO remains a separate decision.
