# Issue 271 — mobile-first production evidence

Captured from the production Next routes backed by the real Nest `content-library` API and a
fresh migrated and seeded PostgreSQL database on 2026-09-04.

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
