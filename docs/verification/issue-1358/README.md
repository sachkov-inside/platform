# #1358: prepared 100 RUB buyer acceptance

Preparation only. Nothing in this directory has been applied to production.
[Issue #1358](https://github.com/sachkov-inside/platform/issues/1358) owns real acceptance;
[#854](https://github.com/sachkov-inside/platform/issues/854) owns serialized production writes.

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

## Serialized preparation by #854

1. Preserve AIE, existing access grants, payments and the shared stand.
2. Resolve the community decision before publishing or initiating a purchase.
   The current adapter uses one `TELEGRAM_CANONICAL_CHAT_ID`; it does not route by Product.
   Switching that setting would redirect the existing community and is not an isolated test.
   A separate test group requires an agreed integration change; do not infer authorization for it.
3. Obtain the working Inside terminal configuration through the existing secrets procedure.
   Check the [payment contour](../../runbooks/production-release.md#payment-contour), including exact receipt fields and callback URLs.
   Apply identical terminal configuration to `api`, `mcp`, `billing-worker` through #854.
   Keep Offer sale disabled throughout preparation. Confirm startup readiness after configuration.
4. Convert the reviewed pretty-printed content package to canonical JSON in a private state directory.
   The release loader requires canonical JSON bytes; use `canonical` from `tools/authoring/package.mjs`.
   Load the result with `loadPackage` before previewing it.
5. Run the existing release preview with the canonical package, target `production` and a private state directory.
   Use no `--publish` during preparation. Review that only the test Product/Material are changed.
   Apply that exact preview through the #854 writer; record the package id, Product UUID and Material UUID.
6. Replace both `PRODUCT_ID` tokens in the billing template with that Product UUID.
   Validate each operation with `ownerOperationSchema` before sending it through owner billing operations.
   Verify the resolved Product UUID differs from AIE and the amount remains exactly 10000.
7. Read the catalog before saving. If those fixed Offer/Option IDs exist, compare their values and revisions.
   Reuse operation IDs only for identical retries; changed payloads need new operation IDs and current revisions.
   Save the Offer and Option. Confirm `published: false`, `mode: one_time`, price and benefits by reading them back.
8. Inspect every active promotion that could match the Option; resolve any automatic discount before sale.
   Verify anonymous and unauthorized accounts cannot read the closed test Material or AIE bodies.

Saving an unpublished Offer is preparation. Publishing a Material or Offer is a separate authorized action.
Regular production quotes require a published Offer; do not publish merely to obtain a preparatory quote.

## Owner acceptance record

Before publication, record all fields below in #1358. Empty fields keep acceptance pending.

| Required field | Current state |
| --- | --- |
| Short public window, timezone and removal deadline | Pending |
| Named fresh buyer and email receipt recipient | Pending |
| Named Telegram account, private-message recipient and chosen group | Pending |
| Controlled messages: login/contact codes, payment/access notices, personal invitation and refund effects | Pending concrete authorization |
| Authorization for one 100 RUB payment and full 100 RUB refund | Pending |
| Authorization for public test Material/Offer publication | Pending |

The buyer must have no linked Telegram, prior rights, Tribute grounds or membership in the chosen group.
Use a fresh identity; the existing production access-pass accounts are not automatically suitable.
Inspect `grants.read`, classification and identity mapping before the purchase.
Do not manually grant test access: it would bypass payment fulfillment and could mask refund revocation.

## Real acceptance and cleanup

After concrete authorization, #854 records the deployed versions and a baseline of AIE identities/access and payment counts.
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
Keep the Product, Offer, Option, purchases, refunds and audit history for traceability.
Compare AIE and legacy access with the baseline; do not revoke another ground to force group removal.
If the buyer has another valid community ground, the buyer was unsuitable and removal acceptance is incomplete.
Record exact deployed versions, package id, redacted transaction references and each pending criterion in #1358.
