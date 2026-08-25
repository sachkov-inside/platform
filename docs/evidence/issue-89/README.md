# Issue 89 — production Reader evidence

Captured from the implementation branch on 2026-08-25 after `pnpm check:full` passed.

| Surface | Desktop | Mobile |
| --- | --- | --- |
| Live PostgreSQL → Nest → Next route | [`live-desktop.png`](./live-desktop.png) | [`live-mobile.png`](./live-mobile.png) |
| Exact production-owned Storybook component | [`storybook-desktop.png`](./storybook-desktop.png) | [`storybook-mobile.png`](./storybook-mobile.png) |
| Membership offer state | [`access-required-desktop.png`](./access-required-desktop.png) | [`access-required-mobile.png`](./access-required-mobile.png) |

- Live route: `/materials/inside-platform-overview`
- Storybook: `Pages/Material/Reader` (`Desktop` and `Mobile`)
- Desktop viewport: `1440 × 1000`
- Mobile viewport: `390 × 844`
- Storybook Agentation control is enabled in the development capture.
- Keyboard smoke: first `Tab` focuses “Перейти к содержанию”; `Enter` moves focus to `main`;
  local navigation, code and table overflow regions remain keyboard reachable.
- Screen-reader/AX smoke: one named main journey exposes the Material `h1`, ordered section
  headings, article, “В этом материале” navigation, named table region and “Ресурсы” region; denied
  states expose their own heading and recovery action without the protected body.
- Automated accessibility: no serious/critical axe findings on desktop or mobile.
- Production performance gate on both Playwright profiles: TTFB ≤ 800 ms, LCP ≤ 2.5 s,
  INP ≤ 200 ms and CLS ≤ 0.1.
- Hydration smoke: the live route produces no browser console or page errors after load and local
  navigation interaction.
- Operational stories distinguish infrastructure `Unavailable`, access-policy unavailability and
  unexpected errors; topic, tags and series remain plain metadata until their owning routes ship.
- Membership offer uses short owner-approved copy and sends `Вступить в Мастерскую` to the external
  `https://sachkov.dev` landing.
- Owner production visual GO: pending; this evidence does not self-approve it.
