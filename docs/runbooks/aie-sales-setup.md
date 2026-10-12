# AIE sales setup — #1359

This is a prepared configuration for the existing #854 production writer. It is not a sales-opening receipt.
The owner's [12 October decision](https://github.com/sachkov-inside/platform/issues/1359)
authorizes preparation alongside #1358. Production application remains serialized through #854.

## Target and conditions

Use Product `625a0cca-c8ff-4a65-9125-17194dd3b769`, slug `ai-engineering`.
Preserve its published programme, Materials, Tasks, rights, progress and purchase history.
Use the published Content SHA and manifest recorded in [#1356](https://github.com/sachkov-inside/platform/issues/1356).
Subsequent editorial changes require their own authorized package.

| Condition | Prepared value |
| --- | --- |
| Start | 9 November 2026, Europe/Moscow |
| Before start | 29 900 ₽, one-time payment |
| Questionnaire discount before start | 10%; 26 910 ₽ with a personal code |
| From start | 39 900 ₽; questionnaire discount ends |
| Materials and common chat | No expiry |
| Support | Six months from purchase; no SLA or promised live-session schedule |
| Author's code review | Not included |

The catalogue payloads in [the preparation directory](../evidence/issue-1359/) contain integer kopecks.
They retain one Offer and one PaymentOption when the price changes, as [ADR 0033](../adr/0033-product-tariff-payment-model.md) requires.
The option's `months: 1` does not override the explicit lifetime Material/community periods or six-month support period.
The prepared Offer does not enable tariff assignments or a subscription.

## Apply preparation through #854

1. Re-read the target Product, Offer, Option, promotions and cohort through the deployed catalogue.
   Compare them with [the read-only baseline](../evidence/issue-1359/baseline.json).
   If any prepared UUID already belongs to another configuration, stop and review new IDs.
2. Apply [prepare.json](../evidence/issue-1359/prepare.json) sequentially through owner billing operations.
   The existing admin API or billing MCP owns permission, idempotency and revision checks.
   Keep each full command and receipt in the #854 journal. Retry an unknown result with its original operationId.
3. Verify the Offer remains unpublished and the questionnaire template is archived.
   The template save temporarily creates an active promotion, so finish its archive before any publication.
   An interruption keeps the AIE Offer unpublished; resume preparation before opening.
4. Verify the owner catalogue shows one-time 2 990 000 kopecks without a promotion.
   Verify the public catalogue excludes this Offer and a buyer quote refuses it.
   Verify the cohort says `announcement`, `2026-11-09`, and future display price 3 990 000 kopecks.

These commands create new billing records. They leave the existing unpublished Inside subscription untouched.
Preparation does not issue rights, contact respondents, create a payment or publish content.

## Questionnaire price

Use the private respondent list and `respondents.issue` with the archived template ID from `prepare.json`.
Import the owner's authorized questionnaire column through `respondents.import` only when needed.
Keep usernames and personal codes in the private operational journal, outside Git and public evidence.
The issued promotion is single-use and scoped to the AIE Offer and Option.
The payment link is `https://sachkov.dev/products/ai-engineering/buy?promo=<personal-code>`.
Issuing a link sends no message; delivery retains the owner's external-message gate.

A Telegram username alone does not apply the discount at checkout.
The buyer supplies the personal code; verify its price with a fresh quote after sale opening.
An unlisted username must fail issuance. A repeated issuance must return the same code.
The archive prevents the template's 10% from discounting the public price.
The expiry is `2026-11-09T00:00:00+03:00`, equivalent to `2026-11-08T21:00:00Z`.

## Open only after the concrete GO

Require completed #1358 payment/refund acceptance, mandatory technical readiness from #854,
and an explicit public-sale GO naming this Offer.
Open #1355/#1357 educational work alone is not a sales gate.

Recheck the current revisions before applying [open-after-go.json](../evidence/issue-1359/open-after-go.json).
The supplied expected revisions describe an untouched preparation.
If the state differs, review a replacement command with a new operationId; retain any unknown command's original payload.
Apply the preorder cohort and publish this Offer through #854.
If opening occurs on or after the start date, apply the post-start price first and open with stage `running`.
The preorder commands and pre-start quotes then do not describe the actual sale.

Before-start opening requires fresh production quotes for 2 990 000 and 2 691 000 kopecks.
On or after the start date, require 3 990 000 kopecks both without and with an expired questionnaire code.
Check the public product page and signed-in checkout show the same Offer, price and access periods.
Use the supported legal links below and verify their actual versions/digests before payment.
The quote step stores a price snapshot; it does not initialize a bank payment.
These checks require no further AIE purchase.

## Start-date price transition

The current runtime does not schedule this transition.
`priceAfterStartKopecks` is a display field; the charge reads `PaymentOption.priceKopecks`.
See [the cohort contract](../../apps/backend/src/modules/billing/domain/product-cohort.ts)
and [price selection](../../apps/backend/src/modules/billing/shared/select-price.ts).

[start-date.json](../evidence/issue-1359/start-date.json) prepares a manual change for the #854 writer
at `2026-11-09T00:00:00+03:00`. An owner decision about automatic execution is pending.
The transition is not accepted merely because the future display price is present.
The questionnaire expiry is automatic; the base-price and `running` stage changes require these commands.

Re-read revisions, change the Option to 3 990 000 kopecks, then set the cohort to `running`.
Keep the Option's identity and access periods. Verify a fresh quote returns 3 990 000 kopecks,
including with a previously issued questionnaire code.
A still-valid, unreserved pre-transition quote must fail reservation with `quote_changed` after the price update.
An expired quote returns `quote_expired` first; an existing reservation follows its stored receipt.
Previously completed purchases retain their stored price and terms.
If the timely price change cannot be ensured, keep the Offer unpublished at the boundary until the price is correct.
An unexpected state during opening can be contained through `offers.unpublish` with its current revision.
Archive is not the reversible sale switch.

## Programme, description and legal links

The Product currently describes development with AI agents and building AI systems.
The published package has five chapters, 28 Materials and eight Tasks (two free, six closed).
Chapters 1–2 form the starting block; chapters 3–5 are the planned programme.
Preparation reuses that accepted description and programme; it does not publish local editorial edits.

| Surface | URL | Required check |
| --- | --- | --- |
| Product and programme | https://sachkov.dev/products/ai-engineering | Published programme, planned chapters, honest support promise |
| Purchase | https://sachkov.dev/products/ai-engineering/buy | One-time price and explicit access periods; personal code where applicable |
| One-time purchase terms | https://sachkov.dev/legal/purchase/v5 | Version 5; checkout accepts this document, without recurring consent |
| Data policy | https://sachkov.dev/legal/privacy/v4 | Version 4, effective 12 October 2026 |
| Seller contacts | https://sachkov.dev/legal/contacts/v2 | Version 2; support/refund contact is available |

## Evidence and remaining acceptance

The isolated rehearsal tests the actual JSON commands through `BillingPricing.manage`, owner/public catalogue,
quotes, respondent issuance and reservation. It uses migrated PostgreSQL, synthetic identities and a fixed clock.
These are the pre-agreed billing seams; no bank call is needed.
Run the focused check with:

```bash
pnpm --filter @inside/backend test:integration --project integration test/integration/aie-sales-setup.test.ts
```

Record production application separately in #1359 and link it from #853/#854.
Keep #1359 open until the owner gates, production quotes, checkout acceptance and actual sales state are recorded.
HTTP 200 for a route proves its availability, not a rendered checkout or a successful purchase.
