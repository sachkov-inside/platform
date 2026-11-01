# Issue #1909: AI Engineering landing, production visual evidence

Storybook story `Pages/Product/Landing/AI Engineering`, production module
`ai-engineering-course-view.tsx` with the advanced topic names and the stronger FAQ answer from this commit. Captured on 2026-10-31 with
`screenshotWholePage`, reduced motion, no horizontal overflow at any width.

| File | Story | Width |
|---|---|---|
| `landing-1440.png` | `Desktop`, accepted landing description | 1440 |
| `landing-900.png` | `Desktop` | 900 |
| `landing-390.png` | `Desktop` | 390 |
| `published-description-1440.png` | `PublishedDescription`, topics published before #1909 and an unknown block | 1440 |

Accepted proof: branch `prototype/ai-engineering-landing-v2`, commit `fa313ed5f`.

Owner visual GO: 2026-11-01, in session, on these Storybook captures («всё остальное принимаю,
можешь сливать и пушить»), after removing the «Evals и стоимость» topic. The live route was not
captured: the shared local stand reported `recovery` for another worktree's source
(`ui-ux-sidebar`) with no reservation, and the owner proceeded without repairing it.
