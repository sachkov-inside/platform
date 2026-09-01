# Issue 192 — Knowledge Base copy evidence

Captured from the implementation branch on 2026-09-01 after the focused Web checks and full
`pnpm check` passed.

| Surface | Desktop | Mobile |
| --- | --- | --- |
| Live `/library` route | [`desktop.png`](./desktop.png) | [`mobile.png`](./mobile.png) |

- Desktop viewport: `1440 × 1024`; mobile viewport: `390 × 844`.
- The public catalog is labelled `База знаний`, Guide is displayed as `Гайд`, and Series is
  displayed as `Плейлист` or `Плейлисты` according to context.
- Both viewports have no horizontal overflow, and the browser console reports no errors.
- Search, filter, sorting, URL-navigation and request behaviour are unchanged. Selecting a filter
  still changes only the checkbox until the existing `Найти` action is used.
