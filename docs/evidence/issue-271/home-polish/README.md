# Home visual polishing — 2026-09-05

Owner-requested iteration after the PR #272 handoff at `2e80625`. This is a proposed result;
owner visual GO and merge GO remain separate and pending.

## Result

- Home Topics use a smaller square footprint and a shorter top gap.
- Guides use two columns on mobile, three at intermediate content widths, and four on wide
  desktop layouts. Titles have more room than in the earlier five-column grid.
- Video title footprints keep the topic labels aligned within each row.
- Playlist thumbnails align along the bottom of adjacent cards. A two-material preview shows
  two thumbnails instead of an invented third material; empty previews retain one cover fallback.
- Eleven [generated covers and prompts](../covers/README.md) establish a provisional shared style.
  Topics, square Guides and wide Videos use different compositions in the same visual language.

## Review data

The live application uses a separate local PostgreSQL review database with the current migrations
and a copy of the earlier review data. Four Topics, two Playlists and the seeded Materials were
populated through the existing authoring interfaces. Covers were uploaded through ContentCovers,
processed into responsive WebP renditions, and stored in the local Object Storage. No production
database was changed. The exact same production UI renders both live routes and Storybook.

`Pages/Mobile-first Platform/Home/Illustrated Catalog` uses controlled presentation fixtures and
the checked-in image assets through Storybook static delivery. It does not depend on the local
database, backend process, credentials, or machine paths. The earlier fallback and unavailable
stories remain available. Counts and ordering can differ between the fixture and the live data.

## Exact viewport evidence

Captured from the production-owned Next routes in the local development runtime and from Storybook.
Desktop is 1440 × 1024; mobile is 390 × 844. Animations and developer overlays are hidden for capture.
Images are loaded and decoded before capture. Desktop content scrolls inside the application shell.

| Surface | Desktop | Mobile |
| --- | --- | --- |
| Home `/` | [Top](home-desktop-viewport.png), [Guides](home-desktop-home-guides.png), [Notes](home-desktop-home-notes.png) | [Top](home-mobile-viewport.png), [Guides](home-mobile-home-guides.png), [Notes](home-mobile-home-notes.png) |
| Home Storybook | [Top](storybook-home-desktop-viewport.png), [Guides](storybook-home-desktop-home-guides.png) | [Top](storybook-home-mobile-viewport.png), [Guides](storybook-home-mobile-home-guides.png) |
| Library `/library` | [View](library-desktop-viewport.png) | [View](library-mobile-viewport.png) |
| Topic `/topics/platform` | [View](topic-desktop-viewport.png) | [View](topic-mobile-viewport.png) |
| Playlist `/series/platform-inside` | [View](playlist-desktop-viewport.png) | [View](playlist-mobile-viewport.png) |
| Reader `/materials/kak-ustroen-inside-platform` | [View](reader-desktop-viewport.png) | [View](reader-mobile-viewport.png) |
| Account `/account` | [View](account-desktop-viewport.png) | [View](account-mobile-viewport.png) |

## Verification and limitations

- All `pnpm check` stages passed. The first run reached E2E but could not start a second Next dev
  process in the same worktree; after stopping the review process, E2E and the remaining build
  stages passed, then the review application was restarted.
- Tooling: 74 tests; backend modules: 294 tests; Web module/Storybook: 330 tests.
- Browser E2E: 39 passed, 3 expected skipped. Web/backend builds, standalone configuration tests,
  and Storybook build passed.
- The Home Storybook test verifies the generated cover loads and a two-material Playlist has
  exactly two cover previews.
- Responsive route capture checks image loading, horizontal overflow, browser errors and axe
  on the six live routes and the illustrated Home story in both viewport sizes.
- Backend contracts and persistence code did not change; integration/Compose were not rerun
  locally for this visual pass. The PR CI gate remains required for the final remote head.
- Local Videos use deterministic provider metadata. Real Kinescope playback acceptance remains
  in #184. No production rollout or new browser sign-in acceptance was performed.
