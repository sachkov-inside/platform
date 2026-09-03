# Issue 122 — private Account access-state evidence

Captured from the implementation branch on 2026-09-02 after focused backend, module, Storybook and
isolated full-stack checks passed.

| Surface | Desktop | Mobile |
| --- | --- | --- |
| Post-sign-in Telegram onboarding | [`onboarding-unlinked-desktop.png`](./onboarding-unlinked-desktop.png) | [`onboarding-unlinked-mobile.png`](./onboarding-unlinked-mobile.png) |
| Live authenticated `/account` access block | [`account-unlinked-desktop.png`](./account-unlinked-desktop.png) | [`account-unlinked-mobile.png`](./account-unlinked-mobile.png) |
| Access-required related materials | [`access-related-desktop.png`](./access-related-desktop.png) | [`access-related-mobile.png`](./access-related-mobile.png) |
| Linked active / rejoined | [`active-rejoined-desktop.png`](./active-rejoined-desktop.png) | — |
| Linking | [`linking-desktop.png`](./linking-desktop.png) | — |
| Conflict → support | [`conflict-desktop.png`](./conflict-desktop.png) | — |
| Unsafe recovery → support | [`recovery-required-desktop.png`](./recovery-required-desktop.png) | — |
| Expired attempt → safe restart | — | [`expired-mobile.png`](./expired-mobile.png) |
| Dependency unavailable | — | [`unavailable-mobile.png`](./unavailable-mobile.png) |
| Page loading / error | — | [`loading-mobile.png`](./loading-mobile.png) · [`page-unavailable-mobile.png`](./page-unavailable-mobile.png) |

- Desktop viewport: `1440 × 1024`; live mobile viewport: `390 × 844`. Storybook access blocks use
  the same `390px` mobile width with enough vertical canvas to show both independent rows.
- Telegram linking and Membership remain independent: Account renders a compact blue Telegram
  strip above an orange-accented premium `Доступ к Sachkov Inside` card. The inactive state keeps
  one external acquisition action without exposing a diagnostic table.
- While Telegram is unlinked, the centered onboarding appears once per authenticated browser
  session after sign-in. It is dismissible, survives navigation/reload after dismissal, and owns
  the complete one-action begin → Telegram `/start` → return → automatic confirm journey. It is a
  compact Telegram-only surface: no Membership state or acquisition action is shown, and the
  linked result with its success check stays visible until the user closes it.
- The live projection contains no email, AccountId, Telegram ID/username, provider identity,
  evidence, Membership timestamps or audit/security data.
- The isolated full-stack smoke exercised the authenticated Web BFF through real Next/Nest HTTP and
  PostgreSQL. The access block has no serious/critical axe findings or horizontal overflow.
- The access-required reader keeps related Materials in two columns on desktop and one column on
  mobile; the third desktop card starts the next row.
- Sixteen Account Storybook cases cover unlinked, linking, linked member/non-member, conflict,
  stale, unavailable, separately typed safe retry and unsafe recovery, page loading/error and
  mobile composition. The interaction journey exercises Begin, immediate bot launch, automatic
  confirmation on browser return, outage fallback, retry and the final linked state.
- Eight compact onboarding stories cover every Telegram link state plus both safe unavailable
  retry modes without introducing Membership or acquisition copy into the modal.
- Route checks prove compact centered desktop/mobile geometry, session-scoped dismissal/reset, the
  complete linking journey, visible final linked result without Membership copy, and suppression
  for an already linked Account.
- Product-owner visual GO is intentionally still pending; these images are the checkpoint input.
