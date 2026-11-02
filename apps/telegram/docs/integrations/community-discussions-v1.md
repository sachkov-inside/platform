# Community discussions v1

Telegram owns captured community messages, discussions, source references, statuses and the daily schedule.
Platform owns author permission. The canonical runtime wire schemas are
[`@inside/contracts/community-discussions`](../../../../docs/contracts/runtime/community-discussions.ts).

## Authorization and HTTP

`POST /integrations/platform/v1/community-discussions` requires the dedicated
`PLATFORM_COMMUNITY_DISCUSSIONS_SECRET` bearer credential. It cannot equal another application service secret.
The request carries `contractVersion: "inside.community-discussions.v1"`, `requestId`, `actor.accountRef` and `operation`.
Every operation checks current `communications:manage` through the existing Platform author authorization callback,
before reading data or replaying a mutation receipt. A service secret never replaces author permission.
Missing/wrong service credentials return `401`, denied/revoked permission `403`, unavailable authorization `503`.
Malformed requests return `400`, missing discussions `404`, conflicting mutation receipts `409`.
Errors contain only the contract version and a stable status.

| Operation | Input and result |
| --- | --- |
| `discussions.list` | `limit` (1..100), optional `status`, inclusive `from`/`to` creation dates, `cursor`. Returns `items`, `nextCursor`. |
| `discussions.read` | `discussionId`. Returns `discussion` with every source message in numeric Telegram order. |
| `discussions.mark` | `discussionId`, `status`, `materialUrls`. Returns the saved discussion. |

List pagination orders by creation time and UUID. A cursor binds the status and date filters.
The list exposes summaries and dates; read adds message text, anonymous role and original Telegram links.
`used` requires 1..20 HTTP(S) Material URLs. Other statuses require an empty URL list.
Setting `new` removes a manual mark. This operation never creates or edits a Material.
A repeated mark with the same bot, Account and request ID returns the original result.
Changing its status, discussion or URLs returns `409`. A timeout does not authorize a new mutation ID.

## Daily processing

Collection must be enabled explicitly. Without grouping credentials, intake continues and processing reports `unconfigured`.
The independent worker checks a durable PostgreSQL schedule. Its lease prevents overlapping instances.
A completed run schedules the next run 24 hours after its start. Failure retries after five minutes.
The lease expires after three minutes; each model call has a two-minute timeout and disables SDK retries.
Restart after a committed batch continues pending work without duplicating discussions.

Before grouping, the processor traverses every author-resolution page, including pages containing unavailable roles.
A confirmed linked Account with current `communications:manage` is the author. Unlinked or denied senders are participants.
Unavailable roles remain null and are deferred without a processing mark until another run resolves them.
AuthorMode, Telegram administrator status and usernames never establish authorship.

One run captures a finite upper message ID. Each model call receives at most 200 pending messages.
Context contains discussions updated in the last seven days, plus discussions referenced by edits or direct replies.
This includes manually marked and older discussions. The limits are 200 discussions and 2000 source IDs per call.
Exceeding a context limit fails explicitly and leaves the batch pending. Redacted diagnostics name that limit.

The model receives message text, time, topic, reply IDs and anonymous roles only.
Participant profile names and Telegram user IDs never enter the model request.
The prompt requires summaries to use these anonymous roles and excludes personal names.
Message content itself can contain personal data; model instructions cannot guarantee deidentification of arbitrary quoted text.
A local HTTP adapter contract verifies the actual AI SDK request. Production model quality requires owner acceptance under #1957.

The module validates structured output and checks known message IDs, eligible discussion IDs and unique membership.
An edit or reply assigned to an existing discussion cannot be moved to a new discussion by the model.
Only a saved result acknowledges a batch; non-question chatter is acknowledged without discussion membership.
A concurrent edit invalidates the batch snapshot and leaves it retryable.
A later edit clears its processing mark and updates its existing discussion on the next run.
Discussion changes, source references and processing marks commit in one transaction.

New unanswered questions start as `awaiting_answer`; answered questions start as `new`.
Processing only changes an existing status from `awaiting_answer` to `new` when an answer appears.
It preserves `reviewed`, `used`, their Material URLs, and marks committed while the model call was running.

## Retention and extensions

Raw content and file references expire strictly after 90 days from the original message time.
Discussion summaries, statuses and source references have independent storage and survive that deletion.
Read then returns `text: null` with the retained role, time and source URL.

`modules/community-discussions/discussion-model.ts` owns one `group`/`transcribe` model port.
The grouping adapter uses `ai` and `@ai-sdk/openai-compatible`; transcription is disabled until #1955.
#1955 extends the message owner and read projection with transcription and Telegram file handling.
#1956 records model usage returned by this port, checks its budget before each call, and persists run diagnostics.
#1954 consumes the shared runtime schemas and extends the shared corpus with cross-application scenarios.
