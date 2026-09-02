# Issue 122 — private Account access-state evidence

Captured from the implementation branch on 2026-09-02 after focused backend, module, Storybook and
isolated full-stack checks passed.

| Surface | Desktop | Mobile |
| --- | --- | --- |
| Live authenticated `/account` access block | [`account-unlinked-desktop.png`](./account-unlinked-desktop.png) | [`account-unlinked-mobile.png`](./account-unlinked-mobile.png) |
| Linked active / rejoined | [`active-rejoined-desktop.png`](./active-rejoined-desktop.png) | — |
| Linking | [`linking-desktop.png`](./linking-desktop.png) | — |
| Conflict → support | [`conflict-desktop.png`](./conflict-desktop.png) | — |
| Unsafe recovery → support | [`recovery-required-desktop.png`](./recovery-required-desktop.png) | — |
| Expired attempt → safe restart | — | [`expired-mobile.png`](./expired-mobile.png) |
| Dependency unavailable | — | [`unavailable-mobile.png`](./unavailable-mobile.png) |
| Page loading / error | — | [`loading-mobile.png`](./loading-mobile.png) · [`page-unavailable-mobile.png`](./page-unavailable-mobile.png) |

- Desktop viewport: `1440 × 1024`; live mobile viewport: `390 × 844`. Storybook access blocks use
  the same `390px` mobile width with enough vertical canvas to show both independent rows.
- Telegram linking and Membership are independent rows. The unlinked state does not imply access,
  and the inactive state keeps one external acquisition action.
- The live projection contains no email, AccountId, Telegram ID/username, provider identity,
  evidence, Membership timestamps or audit/security data.
- The isolated full-stack smoke exercised the authenticated Web BFF through real Next/Nest HTTP and
  PostgreSQL. The access block has no serious/critical axe findings or horizontal overflow.
- Sixteen Account Storybook cases cover unlinked, linking, linked member/non-member, conflict,
  stale, unavailable, separately typed safe retry and unsafe recovery, page loading/error and
  mobile composition. The interaction journey exercises Begin, confirmation outage, retry and the
  final linked state.
- Product-owner visual GO is intentionally still pending; these images are the checkpoint input.
