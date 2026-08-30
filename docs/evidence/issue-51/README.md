# Issue 51 — production Member Profile evidence

Captured from the implementation branch on 2026-08-30 through the isolated PostgreSQL → Nest →
Next full-stack smoke, after automated accessibility checks passed.

| Surface | Desktop | Mobile |
| --- | --- | --- |
| Private Account editor and exact Member Profile projection | [`desktop.png`](./desktop.png) | [`mobile.png`](./mobile.png) |
| Active-member projection and report control | Storybook `Active · desktop` | Storybook `Active · mobile` |

- Live route: `/account` with a real authenticated local session fixture.
- Desktop viewport: `1440 × 1024`.
- Mobile viewport: `390 × 844`.
- The same production projection component renders the owner preview and `/members/<publicProfileId>`.
- `Pages/Member Profile/Production` exercises the positive active-member projection and report
  control at desktop and 390 px mobile widths with Storybook accessibility checks enabled.
- Narrow order remains edit → preview → lifecycle; desktop adds the labelled privacy seam.
- Full-stack automation covers fail-closed mandatory onboarding, create, edit, export, safe member
  404 and hard delete against real PostgreSQL and Nest HTTP.
- Desktop and mobile checks report no serious or critical axe findings and no horizontal overflow.
- Finish review verdict: `ship`; `material_fixes: []`.
- Avatar and file delivery are intentionally absent from issue #51 and tracked separately in #153.
- Visual direction: delegated Mirror seam fallback; owner production visual GO is still required
  before promotion from the temporary semantic UI. Acceptance is tracked in #155.
- Asset producer verdict: `produce: []`, `direct: []`; the PNGs are review evidence and no raster
  ships in the product.
