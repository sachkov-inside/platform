# Confirmed Telegram participant activity v1

`@inside/contracts/telegram-activity` owns the runtime codec for read-only
`POST /integrations/platform/v1/participant-activity`. Platform uses the configured identity-linking
origin and the existing Platform integration bearer credential. Telegram authenticates before parsing
or reading. There are no Telegram API calls, external messages or mutations in this report. The
endpoint uses the same service-authenticated boundary as identity linking. The existing Telegram
Caddy allowlist admits only this additional literal route; the runtime bearer check remains mandatory.

The request is exactly `contractVersion: inside.telegram-activity.v1`, `from`, `to`. Boundaries are
UTC or explicit-offset ISO instants, `[from,to)`, maximum 31 days. Source `asOf`, collection start and
365-day horizon use the Telegram database clock, independent of an application/test wall clock.
Future intervals and intervals outside retention are refused. An interval wholly before collection
returns `outside_collection`, never observed zero. An overlapping interval remains explicitly partial
and exposes its collection boundary. Calendar interpretation is
Europe/Moscow, not a sum of daily distinct counts.

The current confirmed catalog contains:

| Kind | Required durable outcome |
| --- | --- |
| `marketing_preference` | An explicit `/stop`, `/resume` or consent choice saved by Communications for this bot/update and sender. |
| `marketing_entry` | A published marketing entry accepted with `outcome=entered` for this bot/update and sender. `unavailable` and `marketing_off` are excluded. |
| `template_saved` | A private template intake receipt with `outcome=saved`. Merely opening/closing mode, unsupported content, unauthorized requests and ignored input are excluded. |
| `sign_in_decision` | The same sender, chat, prompt message and update actually approved or denied a sign-in request. Expired, unknown, foreign and repeated callbacks cannot create another successful decision. A subsequently consumed approval still confirms its original update. |

A recognized command, HTTP202, provider success status, absence of an exception or a queued technical
request is not enough. Access/activation, invitation, community, author-dialog and link-start commands
have mixed refusal/no-op outcomes and are outside this finite catalog. Provider membership,
contactability, system reconciliation, failures and rate-limited input never count. The report's
coverage is explicitly partial; it does not claim every form of bot use is collected.

After the domain handler commits, the processor asks the owning capability to confirm its durable
receipt. A fact is inserted in the **same transaction** as successful lease-aware inbox settlement.
Its unique key is bot/update, its timestamp is native database collection time at settlement, and its
only other fields are the private sender ID and finite kind. It contains no raw text, token,
callback payload, contact address or command parameters. A crash before settlement leaves no fact;
a retry can confirm an existing owner receipt. Lost leases, rejected work and duplicate settlement
cannot create a fact. The existing retention job deletes at most 1000 facts older than 365 days per
pass; update keys retain their existing 30-day retention independently. No past inbox is replayed or
reconstructed. Collection start records migration installation, with continuity `not_proven`, because
installation alone cannot prove every worker was collecting continuously.

A report uses one read-only repeatable-read snapshot, 2 s statement and 500 ms lock timeouts. It reads
at most 10,001 distinct private senders of the configured bot; more than 10,000 is
`source_budget_exceeded`. IdentityLinking composes its own current verified mapping into that same
snapshot. The response contains distinct linked Account UUIDs and a distinct count of currently
unlinked senders, never Telegram IDs. A legacy invalid Account mapping makes the source unavailable,
not zero. Attribute `current_confirmed_link` is mandatory: this is **current-link projection** of
recorded actions, not historical Account attribution. A later confirmed link or transfer can move an
existing action into a different current Account bucket; unlinking moves it to unlinked. No
email/username/IP or browser fact joins identities.

Platform validates the complete bounded response, exact requested interval and version. HTTP
errors/old-Telegram404, invalid schemas, private extra fields, oversized responses and timeouts become
`source_unavailable`. It keeps source failures and coverage explicit, never converts them to zero,
and returns only aggregate counts from MCP. Telegram and Membership are independent snapshots, not
one cross-application transaction. Combined Accounts are the set union of all successful source
Account IDs. One failed Membership owner makes Membership and combined unknown; a failed Telegram
owner makes Telegram, unlinked and combined unknown while preserving observed Membership.

Platform-first rollout remains compatible with old Telegram via UNKNOWN. Install the additive
Telegram migration and new worker/HTTP code together before accepting Telegram collection. Rollback
stops these collectors/readers before applying migration down; dropping the new analytics table
loses collected activity but never changes primary domain outcomes. No production rollout is
performed by this preparation task.
