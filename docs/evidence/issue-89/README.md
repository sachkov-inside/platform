# Issue 89 — production Reader evidence

Captured from the implementation branch on 2026-08-25 after `pnpm check:full` passed.

| Surface | Desktop | Mobile |
| --- | --- | --- |
| Live PostgreSQL → Nest → Next route | [`live-desktop.png`](./live-desktop.png) | [`live-mobile.png`](./live-mobile.png) |
| Exact production-owned Storybook component | [`storybook-desktop.png`](./storybook-desktop.png) | [`storybook-mobile.png`](./storybook-mobile.png) |

- Live route: `/materials/inside-platform-overview`
- Storybook: `Pages/Material/Reader` (`Desktop` and `Mobile`)
- Desktop viewport: `1440 × 1000`
- Mobile device viewport: `iPhone 15` / live route `390 × 844`
- Storybook Agentation control is enabled in the development capture.
- Owner production visual GO: pending; this evidence does not self-approve it.
