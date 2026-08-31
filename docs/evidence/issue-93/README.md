# Issue 93 — Topic, Series and related navigation evidence

The screenshots were captured on 2026-08-31 from live production routes backed by the isolated
PostgreSQL → Nest HTTP → generated client → Next RSC path.

| Surface | Desktop | Mobile |
| --- | --- | --- |
| Topic `/topics/platform` | [`topic-desktop.png`](./topic-desktop.png) | [`topic-mobile.png`](./topic-mobile.png) |
| Series `/series/platform-inside` | [`series-desktop.png`](./series-desktop.png) | [`series-mobile.png`](./series-mobile.png) |
| Reader related section | [`reader-related-desktop.png`](./reader-related-desktop.png) | [`reader-related-mobile.png`](./reader-related-mobile.png) |

- Desktop viewport: `1440 × 1024`; mobile viewport: `390 × 844`.
- Topic and Series pages are server-rendered from safe published projections; the closed Material
  body is absent from the HTTP payload and initial HTML.
- Series renders the stable author-defined order and visible ordinal for free and closed Materials.
- Library cards and Reader metadata link to canonical Topic and Series URLs.
- Related Materials are deterministic: explicit author pins lead, followed by public metadata
  scoring. The first seeded related card proves the pin order.
- Missing Topic/Series, empty, loading, dependency outage and unexpected error states have
  controlled production presentations. Storybook covers ready Topic/Series, related
  ready/empty/unavailable and route operational states.
- Full-stack Playwright verifies the complete Library → Topic → Series → Reader navigation on
  desktop and mobile Chromium, with no serious/critical axe findings or horizontal overflow.
- Owner production visual GO: explicitly granted on 2026-08-31.
- Owner merge GO: explicitly granted for this delivery chain.
