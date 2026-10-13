# Issue #1401: checkout email

The existing production checkout now has an editable Order Email field. A Telegram buyer can pay without starting email confirmation.

| Surface | Mobile | Desktop |
| --- | --- | --- |
| Production route with real Nest/PostgreSQL and synthetic bank/identity provider | [390px](mobile-chromium-checkout.png) | [1440px](desktop-chromium-checkout.png) |
| Production-owned panel in Storybook | [390px](storybook-mobile.png) | [1440px](storybook-desktop.png) |

The buyer journey asserts inline format errors, focus, no horizontal overflow, payment, material access, community rights, and no email confirmation requests.
The checkout also receives a WCAG 2 A/AA and WCAG 2.1 AA check with axe.
All providers and buyer addresses in this evidence are synthetic. The bank fixture uses a 30 RUB payment and six-month support term; Storybook uses its existing catalog fixtures.

Reproduce route evidence with `UPDATE_EVIDENCE=issue-1401 pnpm smoke:buyer-journey`.
Storybook stories: `pages-product-payment--mobile`, `pages-product-payment--desktop`, `pages-product-payment-flow--email-without-code`.
Snapshots use the shared `screenshotWholePage` helper and contain no real buyer data.

Owner visual acceptance is pending. Automated checks do not establish visual GO or authorize a merge.
