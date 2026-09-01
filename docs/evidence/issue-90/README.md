# Issue 90 — Library evidence

The screenshots below were captured on 2026-08-25 before the TanStack infinite-catalog upgrade.
They are retained as historical visual-review context, not as evidence of the current catalog
architecture. ADR 0011 supersedes the captured SSR/hydration and virtualization details; current
behaviour is proved by the checked-in full-stack Playwright test and `pnpm smoke:fullstack`.

| Historical surface | Desktop | Mobile |
| --- | --- | --- |
| Pre-continuation live route | [`live-desktop.png`](./live-desktop.png) | [`live-mobile.png`](./live-mobile.png) |
| Pre-continuation Storybook component | [`storybook-desktop.png`](./storybook-desktop.png) | [`storybook-mobile.png`](./storybook-mobile.png) |

- Live route: `/library`
- Storybook: `Pages/Library/Production` (`Ready · desktop` and `Ready · mobile`)
- Desktop viewport: `1440 × 1024`
- Mobile viewport: `390 × 844`
- At capture time, the local seed published 13 Materials through the application interface. The
  first 12 were server-rendered through PostgreSQL → Nest HTTP → the server-only Next adapter;
  TanStack Query then loaded the cursor continuation when the catalog sentinel entered the
  viewport.
- Catalog responses and rendered cards expose only safe projections; the closed Material body is
  absent from the HTTP payload and page.
- Keyboard smoke covers the skip link and Material links. Full-stack automation proves that the
  continuation request loads the thirteenth card; desktop and mobile checks report no serious or
  critical axe findings and no horizontal overflow.
- Operational stories cover ready, continuation, loading, empty, controlled infrastructure error
  and unexpected error. Every route-level state preserves the Library page heading and recovery
  path.
- Agentation is enabled on the exact Storybook surface for interactive owner review.
- Owner production visual GO: accepted after iterative review of the Library, sidebar, card click
  target and copy.
- Owner merge GO: given separately with the instruction to synchronize and push `main`.
