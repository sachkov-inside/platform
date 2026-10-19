# Backend HTTP technical telemetry

The API has opt-in manual OpenTelemetry instrumentation. It exports registered route templates,
HTTP methods, response statuses and durations. HTTP counters and duration histograms include
successful health requests and failed requests independently of trace sampling. Unmatched routes
use `unmatched`; arbitrary HTTP methods use `_OTHER`.

The API runtime reads these settings:

| Variable | Meaning |
| --- | --- |
| `INSIDE_OTEL_ENABLED` | Only the literal `true` enables export. The default is disabled. |
| `INSIDE_OTEL_ENDPOINT` | Collector HTTP(S) base URL, without credentials, query or fragment. The SDK appends `/v1/traces` and `/v1/metrics`. |
| `INSIDE_OTEL_SAMPLE_RATIO` | Trace ratio between 0 and 1; default 1 for the initial pilot. It does not sample HTTP metrics. |

The existing runtime identity supplies the release, and Platform mode supplies the environment.
Service identity is `platform-api`. Invalid telemetry configuration emits a fixed warning and
leaves the application running with export disabled. No production configuration is enabled by
this change.

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
HTTP outcomes. Shutdown flushes the SDK through the Fastify close lifecycle.

This is one implementation slice of #1566. MCP, workers, durable propagation, dependency spans,
Telegram and collector-side privacy controls are not covered by this API instrumentation. The
owned loopback test proves actual SDK OTLP traces and metrics reach its receiver; it does not prove
production collector retention, resource capacity, or full business trace chains.

SDK configuration follows the [official JavaScript exporter documentation](https://opentelemetry.io/docs/languages/js/exporters/).
Dependencies are pinned in `apps/backend/package.json` and `pnpm-lock.yaml`.
