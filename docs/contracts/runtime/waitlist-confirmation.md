# Waitlist confirmation v1

The runtime codec `@inside/contracts/waitlist-confirmation` owns strict request and response shapes.
The same fixed-purpose command has two service-authenticated directions:

- Platform POSTs to the existing Telegram `/integrations/platform/v1/communications` boundary with
  the communications service credential. The response echoes `eventId`, status `accepted`.
- Immediately before dispatch Telegram POSTs that command to the existing Platform
  `/integrations/telegram/v1/communications/waitlist` boundary with its existing author-authorization
  service credential. The response echoes `eventId`, status `accepted` or `suppressed`.

This wire version never carries arbitrary message text, a Telegram user/chat ID, an author actor,
marketing audience or a purchase link. Platform resolves the committed occurrence and its Account,
active membership generation and exact link revision. This authorization does not require
`communications:manage` and cannot authorize a marketing send. Telegram resolves its own confirmed
Account/identity link and reachable private contact for the configured bot.

A repeated event with the same payload reuses its durable provider receipt; a conflicting payload
returns 409. `accepted` means durably queued, not delivered. Safe known retryable provider rejection
may retry up to three attempts. Lost transport responses and expired sending leases become `unknown`
and never automatically resend. Membership remains committed through provider failure.

Historical active memberships have no new occurrence/outbox row. Withdrawal or another join
supersedes the earlier generation. Authorization is read just before provider admission; a membership
or link change after that answer can race an already admitted external call. No cross-service atomic
transaction or claim of cancelling an already admitted Telegram send is provided.

Old Telegram returns a malformed/unsupported response for this new wire version; Platform keeps
its outbox pending. Old Platform denies the new callback and Telegram keeps the queued receipt
unsent. Neither side interprets old marketing authorization as a receipt authorization.
