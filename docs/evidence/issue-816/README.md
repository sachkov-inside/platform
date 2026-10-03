# Evidence: sales funnel report (#816)

Captured from the built Storybook (`pnpm build:storybook`, served locally) for the production module
`apps/web/src/_pages/sales-funnel-report/ui/sales-funnel-report-view.tsx`, stories
`Pages/Authoring/Sales funnel report`. Each capture asserted `scrollWidth === clientWidth`.

| State | 390 | 1440 |
|---|---|---|
| Ready: bot connected, five sources | [ready-390.png](ready-390.png) | [ready-1440.png](ready-1440.png) |
| Bot not connected yet (inside-telegram#118) | [bot-not-connected-390.png](bot-not-connected-390.png) | [bot-not-connected-1440.png](bot-not-connected-1440.png) |

The live route without a session is covered by `apps/web/test/e2e/routes.spec.ts` at both widths.
Visual acceptance is #819.
