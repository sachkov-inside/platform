# Issue 271 — mobile-first production evidence

## Accepted visual baseline

Owner review on 2026-09-04 selected the mobile-first prototype as the canonical visual language
for the public surfaces in this issue. The accepted source is preserved for audit with these
checksums:

| Source | SHA-256 |
| --- | --- |
| `mobile-first-platform.prototype.tsx` | `c2351ff973b9df073c1a62f718670732746f3c7ed15e03748921d24e1f36009a` |
| `mobile-first-platform.prototype.css` | `65e9ccee5b05cebc9f5d143e65033e592061785ed2e821800d52b9bb341c0fd7` |
| `mobile-first-platform.prototype.stories.tsx` | `5b2f5cfff79d1484b2a505dfc7aede2a2b4b81c9ff4492849c3d5058791f0706` |

The prototype stories are excluded from the canonical Storybook. `Pages/Mobile-first Platform`
and `Patterns/Mobile-first Platform` render the same production components used by the Next routes,
with controlled real-data-shaped states. Product behaviour continues to follow issue #271 rather
than the preserved prototype fixtures: there is no Continue/history block, and Home is ordered as
Videos → Playlists → Guides → Notes.

## Production route evidence

Captured from the production Next routes backed by the real Nest `content-library` API and a
dedicated freshly migrated and seeded PostgreSQL evidence database on 2026-09-04.

| Route | Desktop `1440 × 1024` | Mobile `390 × 844` |
| --- | --- | --- |
| Home `/` | [`home-1440x1024.png`](./home-1440x1024.png) | [`home-390x844.png`](./home-390x844.png) |
| Library `/library` | [`library-1440x1024.png`](./library-1440x1024.png) | [`library-390x844.png`](./library-390x844.png) |
| Topic `/topics/platform` | [`topic-1440x1024.png`](./topic-1440x1024.png) | [`topic-390x844.png`](./topic-390x844.png) |
| Series `/series/platform-inside` | [`playlist-1440x1024.png`](./playlist-1440x1024.png) | [`playlist-390x844.png`](./playlist-390x844.png) |
| Reader `/materials/kak-ustroen-inside-platform` | [`reader-1440x1024.png`](./reader-1440x1024.png) | [`reader-390x844.png`](./reader-390x844.png) |
| Account `/account` | [`account-1440x1024.png`](./account-1440x1024.png) | [`account-390x844.png`](./account-390x844.png) |

- Screenshots use exact viewport dimensions; animations are disabled during capture.
- Home, Topic, Series and Reader are server-rendered from production adapters. Library loads the
  same real-data projection through its same-origin BFF and TanStack Infinite Query.
- The fresh evidence database avoids test-authored Materials from earlier smoke runs. It is not a
  frontend fixture or a second catalog store.
- Fallback artwork is expected for seeded entities without an author-uploaded Content Cover.
- The deterministic Kinescope adapter proves local duration and lifecycle wiring. Credentialed
  production Kinescope evidence remains owned by issue #184.
- Verification: `pnpm check` stages (with e2e run on an isolated port), 51 production smoke
  scenarios passed with one desktop-only scenario intentionally skipped on mobile, and the focused
  clean-data evidence smoke passed on desktop and mobile.
