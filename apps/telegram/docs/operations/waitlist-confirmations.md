# Waitlist service confirmations (#1582)

The bot sends «Вы находитесь в списке ожидания.» only for a new committed waitlist transition.
This receipt works with global marketing disabled and does not require author permission. It does
not open sales, send a launch broadcast or backfill historical active memberships.
The fixed-purpose [wire contract](../../../../../docs/contracts/runtime/waitlist-confirmation.md)
owns authorization, deduplication and uncertain-result behavior.

## Release order and copy

1. Complete the normal source, review, acceptance, CI, backup/restore and release gates.
2. Deploy Platform first. Additive migration `0101_waitlist_confirmations` leaves old membership
   rows without a new confirmation generation. New joins atomically create the event and outbox;
   an old Telegram provider leaves these rows pending without rolling back membership.
3. Prepare the existing Telegram application environment using the exact non-secret values in
   [waitlist-linked-copy.env](config/waitlist-linked-copy.env). All three `TELEGRAM_LINKED_*_TEXT`
   settings must say `Telegram привязан`. Existing production values override `.env.example`;
   changing this example alone does not update the running bot. Preserve all other environment
   settings and secrets. This task artifact does not apply the change to production.
4. Deploy Telegram with additive migration `035-waitlist-confirmations` and the prepared copy.
   The existing communications service credentials and exact private ingress paths are reused.
   Current authorization suppresses withdrawn, superseded or transferred recipients before send.
5. Perform a fresh canonical production verification for both exact sources. Record actual receipt
   delivery separately from queue acceptance. Historical failed verification remains historical;
   a recovered healthy interval does not erase it.

An application rollback is allowed only under the normal schema-compatibility rules. Never delete
membership, event, operation or provider receipt/outbox rows to recover a release or retry an unknown
send. Preserve `unknown`, delivered and conflicting event receipts; do not replay with a new event ID.
No down migration or live database restore is part of this procedure.

## Read-only delivery evidence

Run these bounded aggregate queries through the normal protected operator connection with
`default_transaction_read_only=on` and a statement timeout. Never export commands, Account refs,
Telegram IDs, message text or recipient lists.

Platform database:

```sql
SELECT count(*) FILTER (WHERE completed_at IS NULL) AS pending,
       count(*) FILTER (WHERE completed_at IS NOT NULL) AS relayed_or_suppressed
FROM sales_funnel.product_waitlist_confirmations;
```

Telegram database:

```sql
SELECT state, count(*) AS total
FROM waitlist_confirmations
GROUP BY state ORDER BY state;
```

`delivered` is provider acceptance with a stored provider receipt, not proof the person read it.
`suppressed` is a withdrawn/superseded generation, a transferred binding or an unreachable contact.
`pending`/`sending` require waiting or diagnosing the relay/provider; `rejected` is a settled known refusal (for example a person blocked the bot); it is diagnostic, not unfinished work;
`unknown` must never be automatically replayed. All inspections remain read-only.
The canonical Platform verification checks its relay backlog, and Telegram metrics refresh the
confirmation queue from PostgreSQL on every scrape. Its pending/sending and unknown
gauges must be zero during the canonical healthy observation window. Missing gauges fail that check.
