# Issue #295 — Серии

## Delivered behaviour

- Public product copy uses «Серия/Серии» while compatibility-facing routes, DTO fields and MCP
  tool names remain unchanged.
- A Material remains independent and may belong to zero, one or several Series. One Series owns one
  explicit order of every included Material; there are no inferred `main`/`optional` roles, format
  sorting or automatic skips.
- Reader previous/next navigation is resolved from the complete published Series selected by the
  `from` context. An invalid context falls back to the Library and direct reading selects no Series.
- Home presents shortcuts, the real membership-state invitation, Series, compact Topic filters,
  videos, guides, notes and the independent catalog in that order. Active members and unknown
  membership state do not receive the invitation.

## Real-adapter development scenario

The idempotent development seed creates clearly labelled examples through the Materials authoring
application interface. They are not editorial content and do not replace existing Materials.

- <http://127.0.0.1:3000/series/demo-series-harness> — shared guide → final guide.
- <http://127.0.0.1:3000/series/demo-series-review> — the same shared guide → video → note.
- <http://127.0.0.1:3000/materials/demo-295-samostoyatelnaya-zametka> — standalone reading with no
  Series navigation.

Live browser inspection at desktop `1440x1024` and mobile `390x844` confirmed the two different
next links, the mixed-format transition, no standalone Series context and zero horizontal overflow.
Axe reported zero WCAG A/AA findings in the application Home and Reader UI. The development-only
Agentation toolbar was excluded from Axe because its own controls and blocked localhost webhook
requests are outside the application DOM contract. Compose smoke passed against API, PostgreSQL and
MCP. The coordinator independently repeated the Home, both-Series and standalone paths on the live
Compose stack and gave visual GO with no findings.

## Evidence

- [Home desktop](home-desktop.png)
- [Home mobile](home-mobile.png)
- [Harness Reader desktop](harness-reader-desktop.png)
- [Mixed Reader desktop](mixed-reader-desktop.png)
- [Mixed Reader mobile](mixed-reader-mobile.png)
- [Standalone Reader mobile](standalone-mobile.png)

## Verification

- `pnpm lint`, both package typechecks, `pnpm api:check`, `pnpm docs:check`: passed.
- `pnpm test`: passed, including backend `296/296`, web module `334/334`, tooling contracts and Go
  evaluator tests.
- `pnpm test:storybook`: `158/158` passed.
- `pnpm test:integration`: `151/151` passed with isolated Testcontainers.
- `bash scripts/compose-stack-smoke.sh`: passed on the preserved local volumes.
- Host full-stack smoke and final root check are recorded after their terminal results on the PR.

## Proof promotion boundary

The accepted prototype reference is PR #296. UI direction was adapted from stable source
`0addf2ab910e9b51c983b73e98426eb29b523dfc`; mock routers, proof fixtures and prototype-only hub
components were not promoted. Production routes use the existing Home, Library, Series and Reader
adapters and reusable application primitives.
