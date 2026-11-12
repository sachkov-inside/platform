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
| `discussions.list` | `limit` (1..100), optional `status`, inclusive `from`/`to` creation dates, inclusive `changedSince` content-update time, `unreviewedOnly`, `cursor`. Returns `items`, `nextCursor`. |
| `discussions.read` | `discussionId`. Returns `discussion` with every source message in numeric Telegram order. |
| `discussions.mark` | `discussionId`, `status`, `materialUrls`, optional `expectedRevision`. Returns the saved discussion. |

List pagination orders by creation time and UUID. A cursor binds the status and normalized date filters; equivalent ISO instants share the same scope.
The list exposes summaries and dates; read adds message text, anonymous role and original Telegram links.
`used` requires 1..20 HTTP(S) Material URLs. Other statuses require an empty URL list.
Setting `new` removes a manual mark. This operation never creates or edits a Material.
A repeated mark with the same bot, Account and request ID returns the original result.
Changing its status, discussion, URLs or expected revision returns `409`. A timeout does not authorize a new mutation ID.

New provider responses include `revision` and `hasChanges`; the wire accepts their absence for legacy responses/receipts.
`hasChanges` means the content revision exceeds the last acknowledged revision. `reviewed` and `used` acknowledge
the current revision; `new` and `awaiting_answer` clear that acknowledgement. Manual status and Material URLs remain independent.
Pass `expectedRevision` from read when marking. A different current revision returns `409 operation_conflict` without
changing status or acknowledgement. Replaying a successful old receipt returns its original response and never acknowledges later content.
The proxy requires the expected revision in a successful version-bound acknowledgement.
`unreviewedOnly=true` includes new and substantively supplemented discussions regardless of manual status.
`changedSince` filters substantive content updates; pure repeats and manual marks do not change `updatedAt`.
All filters bind the creation-time/UUID cursor. Follow continuation until null before treating a list as complete.

## Daily processing

Collection must be enabled explicitly. Without grouping credentials, intake continues and processing reports `unconfigured`.
The independent worker checks a durable PostgreSQL schedule. Its lease prevents overlapping instances.
A completed run schedules the next run 24 hours after its start. Failure retries after five minutes.
The lease expires after three minutes; each model call has a two-minute timeout and disables SDK retries.
Restart after a committed batch continues pending work without duplicating discussions.

Before grouping, the processor traverses every author-resolution page, including pages containing unavailable roles.
A confirmed linked Account with current `communications:manage` is the author. Unlinked or denied senders are participants.
Unavailable roles remain null. If any pending role in the finite snapshot stays unavailable, grouping defers the whole snapshot.
The run reports failure and retries after five minutes without acknowledging related answers as chatter.
AuthorMode, Telegram administrator status and usernames never establish authorship.

One run captures a finite upper message ID. Each model call receives at most 50 pending messages, so one response fits the timeout.
Context contains discussions of every status updated in the last seven days, plus discussions referenced by edits or direct replies.
It also contains up to 40 ranked historical candidates from full-text search over durable questions, across every date and status.
The search uses Russian text normalization and the first 1000 characters of each pending message/transcript.
This is bounded lexical candidate retrieval, not exhaustive semantic matching. The model decides whether the question actually matches;
uncertain or merely related questions remain separate. Limits remain 200 discussions and 2000 sources per call.
Each existing discussion includes its source message IDs, topics, reply IDs and original message times.
Exceeding a context limit fails explicitly and leaves the batch pending. Redacted diagnostics name that limit.

The model receives message text, time, topic, reply IDs and anonymous roles only. An edit of a source or a direct reply to a source
also carries the ID of the saved discussion it belongs to; an edited source keeps its own discussion even when it replies to another.
Participant profile names and Telegram user IDs never enter the model request.
The prompt requires summaries to use these anonymous roles and excludes personal names.
Message content itself can contain personal data; model instructions cannot guarantee deidentification of arbitrary quoted text.
A local HTTP adapter contract verifies the actual AI SDK request. Production model quality requires owner acceptance under #1957.

The module validates structured output and checks known message IDs, eligible discussion IDs and unique membership.
The AI SDK request also constrains output message IDs to an enum of incoming IDs. Historical source IDs remain context,
not new membership; server-side validation remains authoritative even if a provider ignores its requested schema.
An edit or reply assigned to an existing discussion cannot be moved to a new discussion by the model. If the model places such a
message elsewhere or omits an edited source, the module returns it to its saved discussion instead of failing the batch;
the added entry keeps the saved summaries. A reply the model omits is acknowledged like chatter.
Only a saved result acknowledges a batch; non-question chatter is acknowledged without discussion membership.
A concurrent edit invalidates the batch snapshot and leaves it retryable.
A later edit clears its processing mark and updates its existing discussion on the next run.
Revision order uses `edit_date` (or original `date`), then `update_id` for revisions within the same second.
Telegram can choose a random `update_id` after a week without updates. Accepted media changes clear the cached transcript.
Discussion changes, source references and processing marks commit in one transaction.

New unanswered questions start as `awaiting_answer`; answered questions start as `new`.
Summaries contain only supplied facts, with separate `Ответ автора:` and `Ответы участников:` headings in answers.
Promises, acknowledgements and “I do not know” do not count as substantive answers. Contradictory or changed answers
retain their attribution; the model must not infer external facts or suggest Materials/programme changes.
The model sets `hasNewInformation=false` for pure repeated questions/answers and acknowledgements attached to a saved discussion.
Their sources are added without replacing the existing summary, changing its revision or resurfacing it for review.
New substantive details, corrections and conflicting answers increment the content revision. Edits of existing source messages always
increment it, even if the model incorrectly reports a pure repeat. A new discussion cannot be classified as a pure repeat.
Processing only changes an existing status from `awaiting_answer` to `new` when a substantive answer appears.
It preserves `reviewed`, `used`, their Material URLs, and marks committed while the model call was running.
New content after a manual mark remains visible through `hasChanges` and `unreviewedOnly`.

## Upgrade and rollback

Migration 044 adds the rebuildable question index and revision acknowledgement. Existing `reviewed`/`used` discussions
start acknowledged at revision 1; other statuses start unacknowledged. Existing summaries and source references are unchanged.
Deploy Platform first so its proxy accepts optional revision metadata, then Telegram, then use the new MCP arguments.
Older Telegram rejects new arguments rather than returning a misleading successful filtered list. Legacy requests remain supported.
Rollback of migration 044 drops revision acknowledgement and its search index; take the normal release backup before deployment.
Synthetic tests prove orchestration and transport, not semantic model accuracy; real discussion quality still requires author review.

## Retention and extensions

Raw content and file references expire strictly after 90 days from the original message time.
Discussion summaries, statuses and source references have independent storage and survive that deletion.
Read then returns `text: null` with the retained role, time and source URL.

`modules/community-discussions/discussion-model.ts` owns one `group`/`transcribe` model port.
The grouping adapter uses `ai` and `@ai-sdk/openai-compatible`.
Transcription uses `@ai-sdk/openai` against its separately configured OpenAI-compatible audio endpoint.
The same model port carries both operations through the durable monthly budget gate.
The daily processor downloads and transcribes pending audio before grouping and exposes transcript state through read.
The budget gate records usage and attempt estimates, blocks calls at the monthly limit and persists run diagnostics.
Platform exposes author MCP tools through the [Platform integration](../../../../docs/integrations/community-discussions-v1.md).
Both applications verify the [shared corpus](../../../../docs/contracts/inside-community-discussions-v1/README.md) and its HTTP scenarios.
The [launch runbook](../operations/community-discussions.md) owns configuration, cost units and the owner quality checks.
