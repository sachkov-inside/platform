# Sales funnel events and report

Platform #816 owns the owner's Sales Funnel report and the bot-to-Platform contract
`inside.sales-funnel-events.v1` that feeds its first two steps. The Telegram side of the contract is
[inside-telegram#118](https://github.com/sachkov-inside/inside-telegram/issues/118). The
[Workspace communications contract](../specifications/telegram-communications-v1.md)
keeps the bot the owner of sources, participation and marketing preferences; this contract only
reports those facts to Platform through an authenticated, versioned API.

## Events

`POST /integrations/telegram/v1/sales-funnel/events` accepts 1 to 100 events under
`Authorization: Bearer TELEGRAM_SALES_FUNNEL_INGRESS_SECRET`. The secret is optional in the
environment; without it the ingress answers `401`. It must differ from every other Telegram
credential, and startup rejects a reused one. The body schema is the controller schema in
`apps/backend/src/modules/sales-funnel/domain/bot-events.ts` and the generated OpenAPI document.

| `kind` | Extra field | Meaning |
|---|---|---|
| `bot_entered` | `sourceCode`: `null` or `^[A-Za-z0-9_-]{1,64}$` | A `/start` that entered the marketing flow, with the label of its link |
| `marketing_consent` | `granted`: boolean | Explicit consent to marketing messages, or its withdrawal |
| `account_linked` | `telegramIdentityRef` | The contact now has a confirmed link to a Platform Account |

Every event carries `eventId`, `contactRef` and `occurredAt`. `contactRef` is an opaque, stable bot
contact identifier; Telegram user IDs, usernames and names are never sent. A repeated `eventId` with
identical content is a duplicate; the same `eventId` with different content rejects the whole
delivery with `409 event_conflict`. The answer is `{ contractVersion, accepted, duplicates }`;
storage failure is `503` and the bot retries the same delivery.

Platform keeps the events as an append-only journal in `sales_funnel.bot_events`. An
`account_linked` event stores the Account its Telegram link points to when the event arrives, so
the source stays with the Account after a later unlink. A link reported before Platform knows it is
resolved through the current confirmed Telegram link when the report is read.

## Report

`GET /sales-funnel/report?from&to[&guideId][&chapterId]` needs `billing:manage` (or
`platform:admin`) and answers only aggregates. The owner reads it at `/authoring/sales-funnel`,
where dates are whole Moscow days and the last one is included.

The report follows a cohort (owner decision of 2026-09-30, #816): the bot contacts whose first
`bot_entered` falls in the period, and the Accounts without a known bot entry whose first step for
the Product falls in it: the first open of any of its lessons, checkout or payment, whichever
chapter the report shows. Each later step counts who of that cohort has reached it by the time the
report is read; the steps are counted independently, so a buyer who skipped the chapter still
counts as paid.

- **Entered** is the cohort of bot contacts, grouped by the label of their first entry.
  **Consented** counts those of them who ever granted marketing consent; a later withdrawal does
  not undo it.
- **Opened chapter** counts cohort Accounts that opened any published lesson of the chosen
  chapter. Opens are recorded only for signed-in readers. The default chapter is the first; a
  Product without chapters has no such step.
- **Checkout** counts cohort Accounts that received a price quote for an Offer naming the Product in
  its content scope. The checkout page requests that quote when it opens. A subscription covering
  all Products is not a purchase of one.
- **Paid** counts cohort Accounts with a confirmed initial or one-time payment for such an Offer.
  Refunds are not subtracted.
- An Account takes the label of its linked contact that entered first. An Account without a known
  bot entry is `outside_bot`, where the bot steps are `null`. A step that does not apply, and the
  bot steps before the bot has reported anything, are `null`, never zero.
- `lastBotEventReceivedAt` tells whether and when the bot last reported, so an empty bot column can
  be told apart from a bot that is not connected yet.

`surveyRespondents` shows the survey discount of #815 as aggregates only (owner decision of
2026-09-30, [platform#818](https://github.com/sachkov-inside/platform/issues/818)). A survey
username is never linked to an Account, so a respondent bought when their personal promo link ended
in a confirmed initial or one-time payment for an Offer naming the selected Product within the
period. `uploaded` and `issued` count the list and the issued links as they are now; the page shows
the share `paid / issued`. The field is `null` until the owner uploads the list, and `paid` is
`null` without a selected Product. Billing owns the reading (`BillingSurveyRespondentSales`); the
`survey` source label counts bot entries through the survey link, not respondents.
