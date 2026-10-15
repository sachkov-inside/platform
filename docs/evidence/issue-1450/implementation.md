# Individual paid links — implementation contract

Assignment: #1450 and prospective legal integration #1464, coordinated by #1359. Base: bc5dfc3893193ffea76cc4241c5d0bb9340bb81a. Accepted proof/text: 48f2fc49320c77b3fe632868aa847ff99df3a761 (PR #1500), owner layout A. Prototype stays on its branch.

## Test seams

- BillingPricing: owner creation/list/revocation, public link status, authenticated quote. Test private checkout with unchanged catalog, owner authorization, amount/expiry validation and replay.
- BillingPricing.reserve and BillingPayments.purchase: real PostgreSQL reservation concurrency, revocation versus initiation, bank-confirmed failure retry, unknown reservation retention and one successful purchase. Existing payment consent, receipt, grant and refund paths remain authoritative.
- HTTP/BFF and buyer UI: validated input, guest entry and preserved link through sign-in, actual terms and server quote, payment status and unavailable links.
- Legal catalog: preserve historical editions/hashes and accepted snapshots; introduce approved edition 6 separately from production publication.

No new real link, bank charge, refund, message, public Offer or deployment is authorized by implementation. Existing #854 production writer retains runtime ownership. Actual terminal bounds remain server-owned. Source integration does not claim production publication.

## Delivered source and verification — 2026-10-15

The production route is `/payment/links/[id]`; authoring uses the existing `/authoring/billing` page. Both production and Storybook import the same presentation modules. The prototype branch is not merged. Private links preserve the ordinary checkout, consent, receipt, fulfillment and refund mechanisms.

Local verification:

| Scope | Evidence |
| --- | --- |
| Real PostgreSQL pricing and payment path | 43 integration cases passed in `billing-payment-links.test.ts` and `billing-one-time-purchase.test.ts`. Includes concurrent reservation, unknown retention, definitive failure retry, owner authorization/replay/revocation/expiry, 26,100 RUB quote/receipt/grants, consumed link after refund, and bounded physical SQL count for 100 links. |
| Legal catalog | 105 tests passed. Edition 5 retains digest `783f031a7904cfd2b7fef3735aa2f195ba30011a083aade2fb5398b994856490`; new one-time consent uses edition 6. |
| Owner and quote BFF | 44 focused cases passed, including fixed operation mapping and rejection of browser-supplied amount/operation selectors. |
| Telemetry | 12 focused cases passed; private bearer IDs are removed before logging. The root route-inventory contract includes the new route. |
| Presentation | 41 Storybook cases passed, including explicit 390px owner/buyer states, accessibility checks and failed-payment route refresh. |
| Production build and live route | Focused `smoke:fullstack` passed both desktop and mobile. It uses synthetic records in an owned isolated PostgreSQL database, real RSC/BFF/backend adapters, exact edition-6 consent metadata, guest sign-in return, no-store/referrer headers, actual owner revocation in a second already-open tab, and blocked buyer payment afterward. No live bank charge was attempted. |

The full-stack smoke selects this feature with `FULLSTACK_TEST_GREP='individual payment link'`; this result is not a claim that every full-stack scenario ran locally. Final aggregate/CI evidence is recorded in PR #1501. Failed intermediate checks were diagnosed: missing telemetry route inventory, a Storybook fixture type, current-document navigation versus versioned consent metadata, and the existing Telegram dialog in the browser fixture.

## Responsive evidence

Storybook uses representative AIE fixtures; the live route uses a disposable seeded Product with its real catalog title. No Product identity is hardcoded in production.

- Storybook owner: [1440](storybook-owner-1440.png), [390](storybook-owner-390.png).
- Storybook buyer, guest: [1440](storybook-buyer-1440.png), [390](storybook-buyer-390.png).
- Storybook buyer, signed in: [1440](storybook-member-1440.png), [390](storybook-member-390.png).
- Live owner module: [desktop](owner-desktop-chromium.png), [mobile](owner-mobile-chromium.png).
- Live private route: [desktop](private-desktop-chromium.png), [mobile](private-mobile-chromium.png).
- [Horizontal-overflow checks](browser-checks.json): five states at 1440 and 390. Storybook play tests own their accessibility checks; the live smoke also runs Axe.

The fixed mobile navigation can appear within a full-page screenshot because it remains attached to the captured viewport. It is not duplicated navigation in the page.

## Independent review

Standards review: immutable `ff7e5856`, fixes checked at `4373aa87`, telemetry/fixture addition checked at `e3f22a66`. Three findings were fixed: serial per-row queries under the pricing lock, absent cross-tab announcements, and an implicit public response projection. No remaining material findings in those reviewed changes.

Spec review: immutable `ff7e5856`, fix checked at `4373aa87`. A failed bank result now refreshes the private link route once so checkout can become available again. No remaining material findings in those reviewed changes. The reviewer confirmed v6 matches the accepted draft except its publication heading.

Production visual acceptance remains pending. The accepted proof at `48f2fc49` establishes layout A; it does not substitute for the separate production visual gate. No merge, deployment, real link issuance or production legal publication is claimed here.
