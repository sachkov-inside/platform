# Local sale acceptance

Purchases, renewals and owner billing operations on the stand, with no real money or external mail.

## Local sale: bank double and mail capture

The stand sells without credentials, without real money and without sending a single message off
the machine. Two services make the sale observable end to end, and both are chosen by configuration
alone: the application keeps one bank adapter and one mail transport.

`config/compose/local/*.env` already set `TBANK_PROVIDER_MODE=test`, so API and `billing-worker`
call the `bank-double` service instead of the bank, and `BILLING_CONTACT_SMTP_*` point at `mailpit`
instead of a provider. `TBANK_CONFIG_JSON` must stay absent in that mode: a real terminal beside the
double is refused at startup.

Pass the purchase in this order:

1. Confirm the receipt address in Account. The code arrives in the interceptor's inbox on
   <http://127.0.0.1:8025>; nothing reaches a real mailbox. An unconfirmed contact refuses the
   purchase, so this step comes first.
2. Buy a product or a subscription. The application redirects the browser to the double's payment
   form on <http://127.0.0.1:8090>, which is the address the real hosted form would occupy.
3. Choose the outcome on that form. Each button answers exactly as the bank would:

   | Button | Bank status | What the application does |
   |---|---|---|
   | Оплата прошла | `CONFIRMED` | opens the paid rights and saves the card binding when the purchase asked for one |
   | Банк отказал | `REJECTED` | closes the attempt as failed and grants nothing |
   | Покупатель отменил | `CANCELED` | closes the attempt as failed |
   | Истёк срок оплаты | `DEADLINE_EXPIRED` | closes the attempt as failed |
   | Непонятный ответ банка | `CONFIRMING` without success | leaves the attempt unknown for reconciliation, never charges again |
   | Повторить нотификацию | repeats the current status | proves that a repeated notification issues no second grant |

4. Renewal and refund have no buyer-facing form, so their outcome is chosen in advance on the
   double's own page <http://127.0.0.1:8090>: «Следующее списание» decides what `Charge` answers,
   and «Возврат» retains the legacy synthetic `Cancel` response controls. Since #1420 Platform
   exposes no action that invokes those controls; full bank-originated notifications are tested
   through synthetic adapters in `billing-operations.test.ts`.
5. Changing a card opens the double's binding form. The new method applies only after the binding
   is confirmed there and `billing-worker` reconciles the session within a minute. A charge against
   a binding the double never issued is declined, so a revoked method stays observable.
6. Cancelling recurring charges asks the bank nothing: the schedule closes locally, the paid period
   stays, and the next renewal is simply never sent.

Pass the product and both subscription tariffs the same way: the double receives the same request for
each published offer, and only what the purchase asks the bank for differs — a one-time product never
saves a card, the first subscription payment does, and renewals charge the saved one. The tariffs
themselves differ in price, term or the rights they open, none of which the bank sees. Seeded local offers come from the
development seed.

The double keeps a ledger in its own volume, so restarting it keeps the orders the application may
still have to reconcile; a bank that forgot a payment would strand an unfinished attempt forever.
If the application misses a notification — for example while it is restarting — `billing-worker`
reconciles the same attempt through `CheckOrder`/`GetState` within a minute and settles it without
a second charge. Host processes use the same contour on loopback: `pnpm dev:bank-double` beside
`pnpm dev:api` and `pnpm dev:billing-worker`.

Neither service exists in production. The double refuses to start outside `NODE_ENV=development`,
configuration refuses `TBANK_PROVIDER_MODE=test` and `BILLING_CONTACT_SMTP_LOCAL_CAPTURE=true` in
production mode, and `scripts/production-runtime-contract.test.mjs` fails if the production Compose
or its environment templates mention either of them.

## Subscription payment recovery

`pnpm dev:billing-worker` starts the same recovery process provided by the local Compose service.
It scans durable purchases every minute, reconciles unresolved attempts through CheckOrder/GetState,
and applies the saved entitlement outbox. A failed or unknown Init is never automatically repeated.
The worker and API share the database and one bank contour; its schema is
`apps/backend/src/config/tbank-config.ts`. The contour comes from `TBANK_PROVIDER_MODE`: `test`
builds the local double described in [Local sale](#local-sale-bank-double-and-mail-capture) and
`real` reads `TBANK_CONFIG_JSON`. Without either, payment admission is unavailable.
Use only synthetic bank adapters in automated tests. DEMO configuration on a real test terminal and
production activation belong to #413 and #414 respectively; neither is enabled by the local double.

The JSON configuration requires explicit environment/terminal credentials, a 32-byte base64 encryption
key, receipt tax settings, HTTPS notification and return URLs, amount limits, and confirmation that
the terminal supports recurrent cards and its hosted form exposes only supported cards. The terminal
has one return URL for both outcomes, so point it at `https://<web host>/subscription/return`: that
page reads the authoritative purchase state from the server and never treats the redirect itself as
a successful payment. Keep the
same encryption key available for recovery of saved receipt contacts and recurring bindings. Do not
log the configuration, card binding or receipt email. The callback is
`POST /billing/tbank/notification`; it acknowledges a validated durable result with plain `OK`.

The same process owns the `billing.subscription-notices` queue: three days before a charge it
records the renewal reminder for an active schedule with a usable payment method, issues its next
revision when the date, amount or composition changes, and closes it when the charge is no longer
coming. It records the occurrence only; templates, channels and sending belong to
[Notifications](notifications.md).

The same process owns the `billing.subscription-renewal` queue: it starts due renewals, reconciles
card binding sessions and closes lapsed schedules. A renewal persists its attempt before Init and
records `CHARGE_CALLED` before the network, so a lost response is reconciled through GetState on the
same attempt and never repeated. Cancelling a renewal or revoking a saved method is checked under the
same lock as worker dispatch. Changing a card needs the optional `cardBinding` capability of the
contour with an explicit confirmed check type; without it the operation reports
`method_unavailable` instead of guessing a binding. The local double declares that capability, so
renewal and card change are verifiable on the stand.

The `billing.payment-recovery` queue reads bank state for historical unresolved refunds.
It never calls `Cancel`. A full successful `REFUNDED` settles the stored attempt and applies
purchase-specific revocation. Other states remain unresolved for operator inspection.
A missed cabinet refund on an already confirmed payment is recovered by explicitly invoking
`payments.reconcile`; the general payment queue does not poll every historical confirmed payment.

## Seeded offer catalog

The development seed leaves a catalog that can be bought immediately, so a local purchase check
needs no manual setup: subscription «Материалы», subscription «Материалы + сопровождение», and a
one-time purchase of the seeded `platform-inside` Product. Its prices are deliberately not product
prices, and they live in one place at the top of
`apps/backend/src/development/seed-local-offer-catalog.ts`.

The seed issues the same catalog commands the owner issues in `/authoring/billing`
(`offers.save`, `paymentOptions.save`, `offers.publish`), so command parsing, revision checks and
the catalog's own rules are the real ones. Only the permission decision is the stand's own: the
owner Account is bootstrapped after the seed, so there is nobody to ask yet. A saved offer is
never on sale by default; the seed turns sale on with its own explicit `offers.publish` command.

Each run brings those three offers back to the definition in that file and sends no command at all
when they already match, so repeating the seed never writes a second set. Edit a price there and
the next run applies it — no volume wipe. That cuts both ways: the file owns the name, benefits and
price of its three offers, so renaming or repricing one of them in the admin surface is restored on
the next run. Two things the seed does not touch: an offer the owner created themselves, and the
sale switch of an offer that already exists — turning a seeded variant off to test keeps it off
across runs. When a catalog row cannot be reconciled at all, the seed names it on the console and
moves on rather than failing, because a failed seed stops `api` and `web` from starting.

This is the local stand only. The production catalog and real prices remain an owner decision in
the admin surface, and no demonstration data is seeded there: `seed-local.ts` refuses to run
outside `NODE_ENV=development`, and no production Compose service runs it.

## Owner billing operations

`POST /billing/admin` and the MCP tools named `billing_<operation>` are the same operations behind
one facet, so authorization, idempotency, revision checks and audit are identical. They need the
`billing:manage` permission of the current owner; `platform:admin` includes it. Grant it locally
through the [owner release bootstrap](local-owner-operations.md#owner-account-release-bootstrap) with `OWNER_PERMISSION=billing:manage`.

Reading and previewing repeat freely. Every changing command stores an audit row with the actor,
operation, reason and result, which also acts as its replay receipt: the same payload returns the
original result and a changed payload conflicts.

A local subscription purchase starts only after the owner records who the buyer is. An Account with
no recorded decision reports `unknown`, refuses recurring charges and answers the purchase with
`legacy_review_required`. Read it with `grants.readClassification`, record the decision with
`grants.classify` and its `expectedRevision` (`0` for an Account with no decision yet), or classify
a set through the same `grants.previewBatch` and `grants.applyBatch`. The owner page
`/authoring/billing` performs the same operations under «Кто этот покупатель».

Refunds are initiated by the seller in the T-Bank cabinet only (#1420, 2026-10-13).
The owner UI has refund history only; MCP omits `billing_refunds_decide` and
`billing_refunds_execute`. Historical HTTP commands return `method_unavailable` (422)
for an authorized owner and send nothing. Read `refunds.read` and use `payments.reconcile`
to recover a missed full bank result. Preserve payment amounts, history and previous evidence.
Do not start a real payment or refund for a code check. Cabinet-originated bank acceptance
requires its own explicit bounded owner packet; the prior Platform DEMO refund is historical
proof of the previous flow only. Automated tests use synthetic bank adapters and isolated databases.

The first period starts when Inside first verifies and durably records CONFIRMED, whether from a
signed notification or server reconciliation (owner-approved for #407 on 2026-09-09). Delayed
confirmation still gives a full period; duplicate notifications and fulfillment recovery preserve
the original saved bounds. No separate time-policy injection is required. Missing terminal
configuration continues to disable payment admission; DEMO/production activation remains separate.
