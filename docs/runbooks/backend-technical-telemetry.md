# Backend technical telemetry

The API and MCP have opt-in manual OpenTelemetry instrumentation. It exports registered route templates,
HTTP methods, response statuses and durations. HTTP counters and duration histograms include
successful health requests and failed requests independently of trace sampling. Unmatched routes
use `unmatched`; arbitrary HTTP methods use `_OTHER`. Aborts and timeouts finish once,
with fixed `http.request.outcome` / `error.type` values and no invented HTTP status when no response
was completed. `http.server.active_requests` reports the current total, including unsampled work.

The API, MCP, all four pg-boss workers and the notifications worker read these settings:

| Variable | Meaning |
| --- | --- |
| `INSIDE_OTEL_ENABLED` | Only the literal `true` enables export. The default is disabled. |
| `INSIDE_OTEL_ENDPOINT` | Collector HTTP(S) base URL, without credentials, query or fragment. The SDK appends `/v1/traces` and `/v1/metrics`. |
| `INSIDE_OTEL_SAMPLE_RATIO` | Trace ratio between 0 and 1; default 1 for the initial pilot. It does not sample HTTP metrics. |

The existing runtime identity supplies the release, and Platform mode supplies the environment.
Service identity is selected by its entrypoint: `platform-api`, `platform-mcp`,
`platform-material-assets-worker`, `platform-profile-avatars-worker`,
`platform-video-deletions-worker`, `platform-billing-worker` or `platform-notifications-worker`. Invalid telemetry configuration emits a fixed warning and
leaves the application running with export disabled. No production configuration is enabled by
this change.

When any ambient `OTEL_EXPORTER_OTLP*` variable is present, export stays disabled with the fixed
`telemetry_ambient_configuration_unsupported` warning. This prevents the pinned SDK from inheriting
foreign collector credentials, headers, endpoints or TLS client certificate/key files from `process.env`.
The application keeps running; no environment values are logged. This runtime does not support
ambient OTLP transport configuration or authenticated collectors yet.

The telemetry interface accepts no request headers, raw URL, body, SQL or exception. Trace status
records a server failure without its message or stack. HTTP logs keep the existing server-generated
`requestId` and gain `service`, `environment`, `release`, `traceId`, `spanId` and `traceSampled` within the request
scope. Existing dependency log redaction remains in force; this change does not add OTLP log export.
Trace IDs on unsampled requests do not promise stored traces. Even a sampled trace can be dropped
by the bounded queue or a failed export. `telemetry.trace.sampling.ratio` exposes the configured ratio.
No client trace context or baggage is accepted by this HTTP slice.

Pending sampled spans are bounded to 512, including exports in progress. Excess spans increment
`telemetry.trace.dropped`. SDK batches contain at most 64 spans. Both exporter timeouts are one
second; export intervals are five seconds. Metric cardinality is bounded to 128 series per instrument
with SDK overflow aggregation marked by `otel.metric.overflow=true`; totals remain counted but
route/status detail in that series is unavailable. Metric batches are bounded to 128 data points. Export failure counters
are `telemetry.trace.export.failures` and `telemetry.metric.export.failures`; the runtime also emits
fixed `telemetry_export_failed` warnings with only service and signal. Export failures do not alter
HTTP outcomes. Shutdown flushes the SDK after requests drain: through Fastify close for API, and
after the Node HTTP server closes for MCP.

MCP observes known health, OAuth metadata and MCP route paths; unknown paths become `unmatched`.
Host/origin rejections are counted too. Node request/response emitters are explicitly bound through
public OpenTelemetry context APIs, so asynchronous body callbacks retain trace and log request IDs.
The shared socket is never bound to one request. Terminal completion removes its per-request timeout
listener; completed bodies remain active until response completion.

Enabled runtimes share one process-owned `AsyncLocalStorageContextManager`. Repeated shutdown is
idempotent; the last runtime releases only its own manager. A pre-existing or replacement foreign
manager is preserved. If acquisition or SDK construction fails, the runtime emits the fixed
`telemetry_context_unavailable` event and keeps telemetry disabled without stopping the application.
Disabled telemetry does not register a context manager. No global tracer or meter provider is installed.
HTTP spans start from `ROOT_CONTEXT`; library spans can inherit their active context, while incoming
HTTP trace headers and baggage are ignored. Trace/log correlation follows an active library child span
and restores the parent after its asynchronous completion or error.

All four pg-boss workers pass explicit `openTelemetry` options to pinned pg-boss 12.36.
The SDK exposes this named adapter, not the underlying SDK providers, and never replaces global tracer
or meter providers. Disabled/invalid runtime configuration explicitly disables pg-boss telemetry too.
Their existing startup `send`, scheduling and handlers are the real producer/consumer paths.
Each process owns one SDK, with only its canonical `jobQueues` values admitted; billing includes
its conditional community-delivery queue without changing when that queue is registered.
No queue name, business payload, retention, retry, singleton or job identity options change.
SDK shutdown follows `runWorker` draining and closing the application, including startup failure.

pg-boss owns the existing persisted `trace_context` column and retry semantics; this change adds no
queue migration or parallel propagation mechanism. The explicit propagator uses the official W3C
parser/formatter and allows only `traceparent`, excluding baggage and opaque `tracestate` both on
injection and extraction. Single-job attempts continue their producer trace with distinct consumer
span IDs; batch consumers start a root trace and link producers. Links are bounded to 32 per span.
An interrupted process cannot export its unfinished span; durable retries can still retain the
producer trace. This is correlation, not a guarantee that every attempt is retained.

Before the SDK batch retains a completed pg-boss span, it receives a detached snapshot rather than
mutating or retaining the caller's SDK span. The snapshot copies only public fields and captures scalar
trace context, so a large status message cannot remain reachable through an internal field or closure. Only fixed
operation/state/type values, registered queue names, valid UUID job IDs and integer retry/batch counts
survive. Unknown queues/operations become `_OTHER`; errors become `job_error`. Database/schema names,
exception events, status descriptions, link attributes and trace state are excluded. The metric View
applies the queue/value allowlist and fixed error type **before aggregation**, dropping database/schema,
job IDs and attempt counts. Arbitrary error constructor names cannot multiply metric series. Queue
counts/durations remain independent of trace sampling and share the SDK's 128-series overflow marker,
bounded export batches, drop/failure counters and one-second timeout policy.

`pgboss.queue.jobs` is the library's cached state gauge, not a fresh database query, queue age, lag or
proof that a worker is healthy. Existing operational-readiness checks remain authoritative. Job logs
keep the existing job-derived `requestId`, process and queue; enabled handlers gain the current
consumer trace/span plus service/environment/release. Existing log redaction is unchanged; logs are
not exported to OTLP.

The isolated PostgreSQL contract uses separate producer, killed consumer and restarted consumer
processes, a synthetic payload and a loopback OTLP receiver. Each command runs beneath the repository's
independent `spawnOwned` Python supervisor. Protocol-message and command-exit waits have named deadlines;
cleanup requests immediate group termination and awaits the supervisor reaping the tree and closing
its descriptors. Ownership contracts exercise missing-exit timeout and SIGKILL of the Node test owner,
including a signal-resistant fixture and closure of its loopback socket. It proves persisted correlation across
SIGKILL, expiration and two retries, distinct attempt spans, fixed error evidence and absence of
payload/error/baggage sentinels on the actual wire. Fixture-only monitor/supervisor intervals are one
second and expiration two seconds; production timing is unchanged. It also checks the job's unchanged
payload and final completed state, and log request IDs/release. A synthetic HTTP root in that fixture
is an SDK propagation test, not an existing product API-to-queue producer path.

A separate isolated PostgreSQL contract starts the actual profile-avatar, video-deletion and billing
entrypoints against empty synthetic databases. Enabled, disabled and collector-503 cases verify
completed startup jobs, unchanged queue policies/schedules, ready → draining → stopped order,
release identity, final process exit and shutdown exports. No external payment, object-storage,
Telegram or video-provider operation is invoked by those empty-database cases.

## Material publication through durable notifications

The genuine producer is authenticated `PUT /authoring/materials/:materialId` changing a draft to its
first publication. Its existing transaction commits the publication, immutable announcement revision
and Materials outbox together. Only the `materials` lane captures a technical carrier, separately
from the unchanged canonical payload, digest, message ID and idempotency rules. Billing, email and
Telegram callers of the shared transport retain their existing payload-only contracts.

Migrations `0109_materials_notification_trace_context` and
`0110_notifications_notification_trace_context` add nullable `varchar(55)` columns to their owning
Materials outbox and Notifications inbox. They add no default, backfill or index. Local lock and
statement budgets are five and fifteen seconds; refusal rolls back the migration transaction and
ledger. The first insert owns its context: duplicate/replayed writes never replace an original
traceparent **or legacy NULL**. Missing, nonstring, oversized, zero-ID or malformed metadata becomes
absent without rejecting a valid business delivery. Only bounded W3C v00 `traceparent` is admitted;
no baggage, tracestate, Account ID or payload enters technical metadata or metric labels.

Each relay attempt starts from the persisted publication parent and publishes only its own safe
`traceparent` AMQP header after restoring that parent. Required persistent/mandatory properties,
routing, ACLs and publisher confirms are unchanged. Receipt restores that header around durable inbox
admission; ACK still follows the existing successful admission/quarantine boundary. The inbox stores
the first receipt context, which is restored independently for each resumed audience batch. It never
inherits an unrelated sweep trace. A killed unfinished span can be lost, including the receipt span
whose ID was already persisted; later work still correlates with the same trace. This is not a promise
that every crashed attempt is exported.

The notifications process owns one SDK. Startup enters its technical scope, broker callbacks bind
the registered context, and each inbox sweep retains its existing generated requestId. Only the
individual material row creates an audience span. SDK shutdown follows the existing consumer/task
and connection drain, application close and worker lease release. No global tracer/meter provider is
installed. SDK OFF preserves business processing and suppresses capture, headers and export, including
when a previous enabled process had persisted a carrier. Export failure cannot prevent publication,
receipt, audience progress or shutdown; diagnostics contain fixed signal/service values only.

`inside.notification.operations` and `inside.notification.duration` measure the fixed operations
`publish`, `receive`, `audience` and outcomes `completed`, `failed`, independently of trace sampling.
They use the existing bounded reader/exporter/cardinality policy. These metrics do not identify
Accounts, message IDs or individual recipients.

The isolated contract starts a real authenticated loopback API and actual Materials publication,
PostgreSQL and RabbitMQ. It tests confirm failure/retry, SIGKILL after confirm, SIGKILL after durable
receipt before ACK, duplicate delivery and per-batch process restart; 27 synthetic audience Accounts
span a durable checkpoint. Other cases cover authorization, parallel HTTP context isolation,
transaction rollback, NULL/replay/concurrency rules, untrusted AMQP field tables, default-OFF and
collector-503 behavior. The 503 receiver requests immediate retries with a fixed past `Retry-After`
HTTP-date, exercising the pinned OTLP transport within its unchanged one-second export deadline.
Wire requests can repeat a whole export payload. The contract compares complete repeated payloads,
requires retries to occur, and checks four distinct trace/span identities (HTTP publication plus
publish, receipt and audience), their roles and parent chain, and one durable outbox/inbox business
row. Transport attempts must not be counted as additional business operations. No email, Telegram,
bank or external provider is invoked. Migration tests
exercise a populated pre-carrier database, bounded lock refusal, upgrade/replay and legacy field-set
writers with full-registry readiness. A compatible rollback must retain the **full applied migration
registry**; a short old registry remains rejected. This contract does not publish a rollback image or
replace release backup/restore and image verification gates.

The recovery test retains a closed stage name in memory and emits `notification_recovery_failure`
only through Vitest's failure hook, including body timeouts and cleanup failures. The snapshot contains
only the current stage and first failed stage, with no request, connection or payload data. Test broker
administration bounds CLI startup and RPC to five seconds with a one-second kill grace; the owned
container is always stopped afterward. A real indefinitely blocked Erlang command checks this guard
and a subsequent command confirms that the broker remains available. This guard does not establish
the cause of the historical uninstrumented 240-second recovery-test timeout.

This remains a bounded slice of #1566. Material publication now reaches resumed audience processing;
email command/result carriers, the external provider boundary, Telegram propagation, other business
HTTP producers, dependency spans and collector retention/capacity acceptance remain separate work.
The API still does not enqueue the recurring pg-boss maintenance jobs. Queue-age/lag metrics and
full business delivery chains are not proven by this slice.

SDK configuration follows the [official JavaScript exporter documentation](https://opentelemetry.io/docs/languages/js/exporters/).
The [pg-boss telemetry contract](https://pgboss.io/opentelemetry) documents provider injection and durable
propagation; implementation is verified against installed pinned 12.36.0 source, rather than assuming
the current website version. Dependencies remain pinned in `apps/backend/package.json` and `pnpm-lock.yaml`.
