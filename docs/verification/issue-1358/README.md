# #1358: prepared 100 RUB buyer acceptance

Preparation only. Nothing in this directory has been applied to production.
[Issue #1358](https://github.com/sachkov-inside/platform/issues/1358) owns real acceptance;
[#854](https://github.com/sachkov-inside/platform/issues/854) owns serialized production writes.

## Public Product shell gate

Importing this new, nonarchived Product exposes `/products/payment-acceptance-1358` to anonymous visitors immediately.
Its name, summary and chapter programme are public even when every Material is draft and the Offer is unpublished.
Product has no draft publication gate. `publish: []`, closed Material access and `published: false` on Offer do not hide its shell.

Keep preparation local or read-only until the owner explicitly approves this public shell and its concrete window.
The #854 production preview has not been applied; it is evidence for review, not permission to apply.
Defer the entire Product/Material import until that approval is recorded in #1358.

Sources: [Product composition access](../../../apps/backend/src/modules/materials/shared/product-composition.ts),
[anonymous Product projection](../../../apps/backend/src/modules/materials/infrastructure/postgres/published-material-reader/published-material-projection.ts).

## Prepared configuration

- [content-package.json](content-package.json): separate Product `payment-acceptance-1358`, one chapter and one closed Material.
  Source namespace `inside-payment-test`; no AIE references, media, Tasks or feed placement.
- [billing-template.json](billing-template.json): one unpublished Offer and one `one_time` Option for **10000 kopecks = 100 RUB**.
  Replace `PRODUCT_ID` with the imported Product UUID before validating or sending commands.
  The Product benefit has an explicit lifetime period; Option `months: 1` is a required fallback, not a renewal schedule.
  The template contains no publish, refund, grant or message command.
- [telegram-read.json](telegram-read.json): redacted live Telegram capability read on 2026-10-12, about 18:33 UTC.

The Offer benefits contain `product:<test Product UUID>` and `support`, with `coverage: null`.
Product sales require support with an explicit term. The template uses the six-month term already approved in #854.
Any Product purchase also opens the common community under the current access model.
It does not grant `product:625a0cca-c8ff-4a65-9125-17194dd3b769` (AIE).
An unrelated promotion can still change the final amount: inspect active promotions before opening sale.
Accept only a quote with `firstPriceKopecks: 10000` and no applied promotion.

## Observed production configuration

Read on 2026-10-12, 18:30–18:33 UTC, using SSH `inside-production`, container inspection and read-only SQL.
Secrets, personal contacts, bank tokens and invite links were not recorded.

| Fact | Observation | Limit |
| --- | --- | --- |
| Platform release | v34, `bdae0c8284fe284569453183a40d567c2b099ec4` | Not the preparatory branch head |
| Telegram release | v16; deployed identity/image/migrations passed the release verifier | Full verification failed on counters below |
| Product catalog | Only AIE, id `625a0cca-c8ff-4a65-9125-17194dd3b769` | Test Product is prepared, not imported |
| Billing catalog | One unpublished Inside subscription Offer; no Options | No test Offer or Option exists yet |
| Payment terminal | `TBANK_CONFIG_JSON` absent from running `api`, `mcp`, `billing-worker`; provider mode defaults to `real` | No live terminal, minimum amount or fiscalization verified |
| Billing contact | All six `BILLING_CONTACT_*` configuration keys are nonempty in `api`, `mcp`, `billing-worker`, `notifications-worker` | Presence does not prove SMTP delivery or key validity |
| Platform community | v2 configured in `api` and `billing-worker` | No buyer admission or removal exercised |
| Telegram bot | Identity matches; webhook queue empty, no last webhook error; required updates enabled | No controlled messages sent |
| Canonical group | Supergroup; bot administrator can invite and restrict | This is the existing common group, not an isolated test group |
| Telegram baseline | `inside_telegram_reconciliation_failure_total=1`, `inside_telegram_reconciliation_degraded_total=1`; other four checked counters zero | Failed baseline is handed to #854, not declared healthy |

`pnpm production:verify --application platform --version v34 --host inside-production` passed (exit 0).
Its Logto test application check was `not_checked`: no test app selected.
Telegram v16 verification failed (exit 1) at `Telegram error counters`.
A separate read using the verifier's `TELEGRAM_READ` confirmed the bot/webhook/group facts above;
the verifier had stopped before those checks. Startup-log and subsequent verifier checks remain unverified.

Sources: [terminal configuration](../../../apps/backend/src/config/tbank-config.ts),
[billing contact parsing](../../../apps/backend/src/config/platform-config.ts),
[catalog schema](../../../apps/backend/src/modules/billing/features/manage-catalog/manage-catalog.contract.ts),
[access composition](../../../packages/access-capabilities/src/index.ts),
[Telegram canonical chat adapter](../../../apps/telegram/src/adapters/telegram/grammy-community-chat.adapter.ts),
[production verifier](../../../scripts/production-verify/verify.py).

## Local preparation verification

The canonical copy passed `loadPackage`; package id:
`4017cb78933a4161181a1b6c30b65e812df2064c954fb362c675706d27402b2c`.
Both billing operations passed `ownerOperationSchema` after substitution with a disposable validation UUID.
This verifies payload shape, not a production binding or persisted configuration.
Access composition returns that Product capability, `support` and `community`.
The revised template passed `productOfferUnsellable`, `offerGrantsWithheld` and `tierLacksComposition` publication guards.
An in-memory catalog without promotions returned `not_found` while unpublished.
After simulated publication, ordinary `selectPrice` returned exactly 10000 kopecks without a promotion.
These checks use a fixed instant and the real functions; they neither persist data nor contact the bank.
No application behaviour changed, so no new test seam or TDD cycle was needed.

## Read-only preparation by #854

1. Preserve AIE, existing access grants, payments and the shared stand.
2. Use the owner's accepted existing common group; keep `TELEGRAM_CANONICAL_CHAT_ID` unchanged.
3. Inspect the terminal and [payment contour](../../runbooks/production-release.md#payment-contour), including receipt fields and callback URLs.
   Coordinate configuration changes and credentials through #854 and the existing owner gates; keep Offer sale disabled.
4. Convert the reviewed content package to canonical JSON in a private state directory.
   Use `canonical` and `loadPackage` from `tools/authoring/package.mjs` before previewing it.
5. Run the existing release preview with target `production` and that private state directory.
   Use no `--publish`; review that only the test Product/Material are changed.
   Keep the preview read-only: applying it would expose the public Product shell even with `publish: []`.
   Record its fingerprint and package id; defer apply until the public-shell/window approval below.
6. Keep the billing template local until authorized import returns the real test Product UUID.
   A disposable schema-validation UUID is not an existing Product reference and must not be persisted.
   Inspect promotions read-only; identify any automatic discount that could change the final 10000-kopeck quote.

## Authorized import and unpublished catalog configuration

Before any Product/Material import, record the owner's explicit approval of the public shell and its concrete window.
Apply only through the existing #854 writer, inside that window, using the exact reviewed preview.
If its checked inputs changed, refresh the read-only preview and review the changed exposure before applying it.
Record the package id, Product UUID, Material UUID and current versions returned by the import.
The anonymous shell is now public; draft Materials remain separate from the shell's visibility.

Replace both `PRODUCT_ID` tokens in the billing template with the returned test Product UUID.
Validate each operation with `ownerOperationSchema`, then verify the actual Product reference through `content.list`.
Confirm `content.list` returns the intended available Product and slug, with an ID different from AIE.
Confirm its source identity separately from the source-scoped import receipt.
Schema parsing validates payload shape; it does not prove that a disposable UUID exists in production.
The template's `offers.save` capability UUID validation is not a Product-existence lookup.
`paymentOptions.save` requires its referenced Offer to exist and be nonarchived.
Sources: [owner content catalog](../../../apps/backend/src/modules/billing/facets/billing-operations/billing-operations.ts),
[catalog writes](../../../apps/backend/src/modules/billing/features/manage-catalog/manage-catalog.ts).

Read the billing catalog before saving. If the fixed Offer/Option IDs exist, compare values and current revisions.
Reuse operation IDs only for identical retries; changed payloads need new operation IDs and current revisions.
Save the Offer, then its Option. Read back `published: false`, `mode: one_time`, price and benefits.
Saving an unpublished Offer/Option does not open sale; it also does not hide the already imported Product shell.
Confirm anonymous and unauthorized accounts cannot read the closed test Material or AIE bodies.

Material publication and Offer sale still require their own recorded authorization.
Regular production quotes require a published Offer; do not publish merely to obtain a preparatory quote.

## Owner acceptance record

Before Product/Material import, record the public-shell/window approval below in #1358.
Before the corresponding publication, message or money operation, complete its remaining authorization fields.
Empty fields keep the corresponding action pending.

| Required field | Current state |
| --- | --- |
| Explicit approval to import the public Product shell at `/products/payment-acceptance-1358`, including its name, summary and chapters while Materials are draft | Pending |
| Concrete shell window: start, end, timezone, import time and deadline to archive the Product | Pending |
| Offer/Material publication window and deadline to remove sale | Pending |
| Cleanup authorization: unpublish Offer/Material and archive the test Product, preserving IDs and financial history | Pending |
| Named fresh buyer and email receipt recipient | Pending |
| Chosen group | Existing common group; approved by the owner in #1358 |
| Named Telegram account and private-message recipient | Pending |
| Controlled messages: login/contact codes, payment/access notices, personal invitation and refund effects | Pending concrete authorization |
| Authorization for one 100 RUB payment and full 100 RUB refund | Pending |
| Authorization for public test Material/Offer publication | Pending |

The buyer must have no linked Telegram, prior rights, Tribute grounds or membership in the chosen group.
Use a fresh identity; the existing production access-pass accounts are not automatically suitable.
Inspect `grants.read`, classification and identity mapping before the purchase.
Do not manually grant test access: it would bypass payment fulfillment and could mask refund revocation.

## Real acceptance and cleanup

After concrete authorization, #854 records the deployed versions and a baseline of AIE identities/access and payment counts.
Perform the authorized import and unpublished catalog configuration above inside the approved shell window.
Record the anonymous shell response separately from closed Material access and disabled sale.
Publish only the test Material and Offer for the agreed window; the Offer is visible in the public catalog.
Confirm the ordinary quote is exactly 10000 kopecks; if the bank rejects that amount, stop without increasing it.
The owner personally completes one payment on the working terminal.

Record separate evidence for bank confirmation, signed notification, sale receipt, application email and test access.
Read stored payment state with `payments.read`; distinguish actual notification evidence from recovery polling.
A reachable notification route or `CONFIRMED` payment alone does not prove notification delivery or a fiscal receipt.
Confirm the test Material opens and AIE remains inaccessible.
Then link the agreed Telegram account, receive its personal invitation and join the chosen group.
Confirm the linked Account and entitlement belong to the same buyer.

Read `refunds.read`, then record a full refund decision for the confirmed purchase:
`amountKopecks: 10000`, `basis: withdrawal`, `recurring: cancel`.
`compensation` keeps access and therefore does not satisfy this acceptance.
Execute that decision with its returned `decisionRef` and current `expectedRevision` only after authorization.
A lost bank response keeps its original attempt; reconcile it instead of sending a second refund.
Confirm the bank refund and refund receipt independently, then access revocation and group absence.

At the deadline, unpublish the test Offer even if acceptance is incomplete.
Record its current revision before `offers.unpublish`; verify it disappears from sale and quotes stop succeeding.
Withdraw the test Material through the reviewed authoring publication path after recording denial evidence.
Unpublishing the Offer or withdrawing the Material does not hide the public Product shell.
At the approved shell deadline, archive only the test Product through `content_collection_set_archive`:
`kind: product`, `collectionId: <test Product UUID>`, `archived: true`, with its current `expectedVersion`.
Verify anonymous `/products/payment-acceptance-1358` no longer exposes the shell.
Record cleanup failures immediately in #1358; do not extend the public window without owner approval.
Keep the archived Product, Offer, Option, purchases, refunds and audit history for traceability.
Source: [existing collection archive operation](../../../apps/backend/src/modules/materials/adapters/mcp/material-authoring-mcp.ts).
Compare AIE and legacy access with the baseline; do not revoke another ground to force group removal.
If the buyer has another valid community ground, the buyer was unsuitable and removal acceptance is incomplete.
Record exact deployed versions, package id, redacted transaction references and each pending criterion in #1358.
