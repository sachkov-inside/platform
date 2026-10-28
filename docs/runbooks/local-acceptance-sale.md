# Local Product purchase acceptance

Use the session-owned local stand or isolated PostgreSQL with a synthetic bank. This procedure
moves no real money, sends no external mail and grants no production access. Follow the
[stand ownership contract](local-stand.md) before any Compose command.

Published purchase edition 7 carries the Product/community/three-calendar-month terms
(`commercialModel: product-lifetime-v1`, #1464). The ordinary stand therefore admits new payments on
the bank double. `pnpm smoke:buyer-journey` exercises the published path: Telegram sign-in,
free/protected Materials, acceptance of v7 by the payment button, payment on the bank double and
the opened protected Material. Its backend uses the real direct Product seed.
The full-stack private-link reader test separately seeds two already saved links through real
Pricing and a distinct synthetic legal-provider composition. The running API serves the published
catalog and creates a further link. Reading fixed terms, revoking the saved link and updating
another open owner tab remain real API/browser checks. The fixture CLI is restricted to the isolated
loopback `inside_checks` database and synthetic identity; it creates no bank operation or legal
acceptance and publishes no legal edition. Each browser profile also receives its own disposable
admin-price Product. The catalogue-edit test selects that Product by fixture ID and asserts that
both saved-link Products retain their original prices and revisions.

## Purchase and recovery

The local configuration selects `TBANK_PROVIDER_MODE=test` and Mailpit. Keep real
`TBANK_CONFIG_JSON` absent in that mode. The bank double runs at
<http://127.0.0.1:8090>, and captured mail at <http://127.0.0.1:8025>.

1. Open the seeded Product's purchase page. Its single Product Price is the basis of the quote;
   one best applicable Promotion may reduce it. A Payment Link saves its own amount and accepts
   no additional Promotion.
2. Choose Order Email or an existing verified Billing Contact, and explicitly accept the exact
   purchase edition shown beside the payment button. Order Email does not change sign-in identity
   or prove ownership of a mailbox.
3. Start payment. `NEW`, `AUTHORIZED`, a receipt notification and the browser return grant nothing.
   Only a verified `CONFIRMED` records payment. Access may remain `preparing` until fulfillment.
4. Repeat the command or notification, and restart the recovery process after a lost answer. The
   same durable purchase is resumed through `CheckOrder` and `GetState`; a sent or unknown Init is
   never sent again. Crash recovery applies the confirmed Product Access idempotently.
5. Close Product sales or archive the Product. A fresh quote or unsent payment, including one
   through a transferable Payment Link, is refused. Already sent operations finish using their
   preserved amount, legal acceptance and Order Email. Holders retain lifetime access.
6. Observe a synthetic bank refund. The financial history changes, but Product Access does not.
   Withdraw and restore access through separate authorized owner commands, checking their reasons,
   expected revisions and replay behavior. Payment or course replay cannot override withdrawal.

`billing.payment-recovery` reconciles unresolved attempts and confirmed fulfillment. Historical
recurring attempts are passive facts: recovery can observe an already sent operation, but neither
Init nor Charge can start a recurring operation. There are no renewal, card-binding, subscription
notice or Tribute jobs. The bank adapter exposes no saved-card or refund-initiation operation.

## Development Product price

`seed-local-offer-catalog.ts` owns one synthetic Product Price of 3000 kopecks for the seeded
`platform-inside` Product. It uses `productPrices.save`. Repeating an unchanged seed sends no
command and preserves an existing owner's sales closure. A hidden demo is not sold.
Production prices and the production catalogue remain the owner's decisions; the development seed
refuses production mode.

## Owner operations and historical facts

`POST /billing/admin` and the corresponding MCP tools share authorization and command receipts.
They manage direct Product prices, Promotions, Payment Links and course Activation Rules, and read
payments, refund history and survey-respondent facts. `billing:manage` or `platform:admin` is required.
No tariff, invitation, classification, subscription, saved-card or refund-initiation command exists.

The Product Access endpoints under `/admin/access/products` list or read one lifetime state and its
history, explicitly issue access, preview withdrawal, withdraw or restore it. Owner issuance records
its actual issuance time. Callers cannot supply or reset it. Withdrawal requires a reason and an
expected revision; only explicit restoration opens the withdrawn state again.

The seller performs real refunds manually in T-Bank. `refunds.read` and `payments.reconcile` read the
bank fact without withdrawing access. Never start a real payment or refund as a code check.

The configured terminal requires its environment, identifiers, credentials, amount limits, receipt
tax settings, HTTPS callback/return addresses and the encryption key for retained Order Email.
Retired recurring-card and card-binding configuration fields are rejected. Use `/payment/return`
as the return page; it reads authoritative server state. Preserve encryption keys needed to read
historical order contacts. Never log credentials or personal email.

Accepted financial and legal snapshots remain immutable. The concrete
Product/community/three-calendar-month edition is purchase edition 7, accepted and published through
[#1464](https://github.com/sachkov-inside/platform/issues/1464). Opening real sales remains an owner action.
