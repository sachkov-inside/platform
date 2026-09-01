# Issue 189 — simplified Account and Member Profile evidence

Captured from the implementation branch on 2026-09-01 after focused integration, module and
Storybook checks passed.

| Surface | Desktop | Mobile |
| --- | --- | --- |
| Live authenticated `/account` route | [`desktop.png`](./desktop.png) | [`mobile.png`](./mobile.png) |
| Account production Storybook state | [`account-desktop.png`](./account-desktop.png) | [`account-mobile.png`](./account-mobile.png) |
| Member Profile production Storybook state | [`member-profile-desktop.png`](./member-profile-desktop.png) | [`member-profile-mobile.png`](./member-profile-mobile.png) |

- Desktop viewport: `1440 × 1024`; mobile viewport: `390 × 844`.
- The Account surface contains only create/edit, the member preview and its opaque link. Complaints,
  Profile export/delete, the decorative `Граница` seam and the redundant introductory copy are
  absent.
- The preview heading is `Профиль участника`; the active-member route uses the same accepted
  projection without a complaint control.
- Removed Nest routes for reports, export and delete return `404`; the generated OpenAPI client
  contains only read/create/update/view operations.
- The full-stack smoke passed against an isolated disposable PostgreSQL database through real Nest
  HTTP and a production Next build. It covers both clean-database onboarding and repeat edit paths.
- Desktop and mobile live checks report no serious or critical axe findings and no horizontal
  overflow.
- The persistent singleton database was not reset: it contains the parallel #180 migration at
  position `0012`, so issue #189 used an isolated database for acceptance and must renumber its
  append-only migration if #180 merges first.
- Product owner desktop/mobile visual GO was accepted on 2026-09-01 in the issue #189 delivery
  session; #155 records the durable decision and implementation handoff.
