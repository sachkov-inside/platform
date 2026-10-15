# Commercial preparation — #1359, #1450 and #1464

Status: prototype and prospective legal draft only. Owner visual acceptance and approval of the concrete legal text are pending. No runtime, legal publication, real links, payments or public sales are delivered by this branch.

## Recorded decisions

Authoritative requested link rules are in [#1450](https://github.com/sachkov-inside/platform/issues/1450). A link selects a Product and its normal benefits, final amount or discount, and optional expiry. It is transferable and permits one successful purchase. The owner may revoke it before payment initiation. Unknown bank outcomes retain the reservation; confirmed failure permits retry subject to link eligibility. Revocation does not undo a successful purchase. Free access uses the existing manual grant flow.

Preorder is presentation of an ordinary purchase with an applicable discount, with no separate order lifecycle. The start date alone does not change pricing. Current AIE conditions stay at 29,000 RUB, questionnaire 10% / 26,100 RUB, start 9 November 2026 Europe/Moscow. No new reference price, promotion expiration or future price is selected here.

## Visual proof

Source: `apps/web/src/storybook/prototypes/commercial-links/`. It stays on the `prototype/1359-commercial-conditions` branch, outside the production graph. Use `pnpm build:storybook` and the repository static Storybook capture recipe. The existing shared development Storybook on port 6006 belongs to another worktree and is preserved.

Story group: `Prototypes/Commercial/PaymentLinks`. Owner story offers A (form plus summary), B (Product row followed by inline price controls), C (two-step creation). Buyer stories show available, pending, unknown, confirmed, revoked, expired and definitive-failure states. The state controls are prototype-only. Products, email, copyable `.invalid` link and bank outcomes are fixtures. Controls do not call a bank or send messages. A successful fixture does not prove payment or entitlement implementation.

Review questions: which owner layout to keep, whether creation/copy/revocation and the buyer states are clear. No layout is accepted yet.

## Legal draft and mapping

[Prospective purchase edition 6](../../legal/purchase-v6-draft.md) derives from edition 5. Edition 5 and the runtime catalog are unchanged. The draft has no effective date and is not published.

| Surface or record                   | Prospective mapping                                                                                                                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public `/legal/purchase`            | Continue serving the published edition until a separately approved release publishes edition 6.                                                                                                                             |
| Version archive                     | Preserve all old edition texts, hashes and addresses. Add edition 6 only when approved and dated.                                                                                                                           |
| Checkout, public or individual link | Show the actual Product, selected benefits, actual chat when included, price/discount, terms, allocation and published edition before payment. Accept with the existing explicit action; preserve the current consent flow. |
| Purchase snapshot                   | Retain Product, actual benefits and configured chat mapping, final quote, allocation, accepted edition/hash/time and duration terms. Implementation must prove preservation; the draft does not alter persistence.          |
| Existing purchases and acceptances  | Keep their original edition, prices and benefits. Never migrate them to the draft.                                                                                                                                          |
| Free manual grant                   | Use existing grant rules. No bank payment or fabricated purchase acceptance.                                                                                                                                                |
| Product without chat                | Promise no invitation. Support remains available through direct messages/email when included.                                                                                                                               |
| Shared Telegram group               | End one purchase's benefit only; preserve access supported by another valid Product/purchase/grant.                                                                                                                         |

The draft replaces a generic shared-chat promise with the Product's actual optional chat, adds individual-link rules and clarifies preorder. Existing refund provisions and allocation policy are retained. Without support, 100% of the price belongs to materials and any included chat. Without chat, that part contains materials only.

AIE price allocation with support:

| Final price | Materials and included chat | Support    |
| ----------- | --------------------------- | ---------- |
| 29,000 RUB  | 14,500 RUB                  | 14,500 RUB |
| 26,100 RUB  | 13,050 RUB                  | 13,050 RUB |

Materials and applicable chat have no end date; support lasts six months from payment confirmation. The existing 12-month calculation period affects refund allocation only, not the duration of access. Full terms remain accessible without a prominent support-duration banner.

## Provider bounds

Official [Init](https://developer.tbank.ru/eacq/api/init) accepts integer kopecks. Published [card minimum](https://www.tbank.ru/business/help/business-payments/internet-acquiring/how-work/working-conditions/) is 1 RUB. SBP minimum is 10 RUB; the [default SBP range](https://developer.tbank.ru/eacq/intro/errors/error-codes) is 10–1,000,000 RUB. Actual merchant limits remain to be verified against the configured terminal. The prototype's 1–1,000,000 RUB range reflects published card minimum and the current application legal-snapshot maximum, not a guarantee that a payment method accepts it. The implementation must use the existing server-owned payment-admission and terminal limits, hide SBP below its minimum and handle bank rejection without consuming the link.

## Remaining delivery

Owner reviews the concrete proof and legal draft. #1450 then implements reservation, revocation, expiry, quote/checkout and purchase integration using the accepted presentation. #1464 verifies immutable historical records and separately obtains legal-publication approval. #854 owns release and financial acceptance. #1359 remains open for the concrete readiness report and separate sale-opening GO.
