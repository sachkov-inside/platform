# Web telemetry in Platform PostgreSQL

[Issue #707](https://github.com/sachkov-inside/platform/issues/707) owns this intermediate self-hosted
scope. The separate monitoring stack is #1289.

## Collection and privacy

The existing browser payloads and `/api/web-vitals` and `/api/render-errors` addresses stay unchanged.
The web process keeps its structured log and forwards an explicit telemetry projection after the
response through Next `after`. Server request errors keep their log and forward through the same
internal transport. A failed or timed-out forward records `web-telemetry-unavailable`; it does not
throw into the collection handler. The transport timeout is two seconds.

API accepts reports on `/internal/web-telemetry` inside the Compose network. Caddy refuses that
address publicly. This is a private network boundary, not a public authenticated endpoint. No
browser headers, IP, User-Agent, account/session identifiers, metric IDs or navigation metadata are
forwarded or stored. The web server derives `mobile` from `Sec-CH-UA-Mobile` (`?1`/`?0`), with `Mobi`
in User-Agent as fallback. Neither header is persisted. No cookie or browser storage is added.

The API maps the page path to a template derived from `apps/web/app`; an unknown path becomes
`other`. Static siblings take precedence over dynamic routes. `scripts/web-telemetry-routes.test.mjs`
checks the template list against the current page tree. Query strings and fragments are discarded.

`web_telemetry` stores vital samples, errors, daily quota and route/device/metric coverage. Error
messages retain at most 500 Unicode code points (`char_length`), with no byte cap or LZ4. Error names
and digests retain at most 128 code points. Client and server errors share a group by digest and
route template. The existing browser report length validation is unchanged.

## Storage quota and summary

Each UTC day admits at most 20,000 vital samples and 5,000 errors. Database routines update the daily
quota, insert an admitted sample, and update coverage in one transaction. The UPSERT locks the daily
quota row, so concurrent writes cannot exceed it. Over quota, the routine changes counters only.
Coverage retains saved/dropped counts even for a route/device/metric with no admitted samples.

The read-only `web_telemetry_summary` MCP tool requires `platform:admin`. It reads 1–30 UTC calendar
days, including the current partial day. It returns p75 LCP/INP/CLS by route and device, saved/dropped
sample counts and an `incomplete` flag when quota dropped any sample in that group. Error groups
include client/server counts; the list returns the 100 largest groups with stable tie ordering.
Coverage includes all admitted metric kinds and errors. It counts individual metrics, not HTTP
requests or visits. There is no visitor counter or account page in this scope.

The p75 query uses exact order statistics, not a sampled/approximate percentile. Atomic coverage
counts completed UTC days; the current partial day is counted from samples in the same SQL snapshot.
The value/day index stores the network bytes of each nonnegative finite float, canonicalizing signed
zero; this preserves numeric order and permits B-tree deduplication of equal keys. It selects the two
neighbouring ranks from the descending upper quarter. Its UTC day is generated from the retained
timestamp; the current-day branch still checks that exact timestamp. PostgreSQL `percentile_cont`
interpolates the original floats. Singleton, integral rank, ties, subnormal/large finite values,
dropped-only groups, date boundaries and future records retain the full-query result.

The completeness flag describes the storage quota. Existing minute ceilings and transport/database
failures remain visible in structured logs; their losses cannot be reconstructed from database
counters alone. The stored sample is therefore operational telemetry, not a visitor census.

## Retention, maintenance and signals

The existing `billing-worker` registers `web-telemetry.retention`, schedules it daily at 03:00 UTC,
and requests cleanup at worker startup. Cleanup deletes samples older than 30 days in batches of
5,000 through time indexes. Daily counters expire when their entire UTC day is older than the
cutoff. Ordinary autovacuum uses table-local scale factors 0.01 (vacuum) and 0.02 (analyze) for sample
and error tables; global PostgreSQL settings stay unchanged. Vital samples reference a shared
route-template dictionary. After ordinary vacuum the value/day index supports an index-only scan
for the rank neighbours. The bounded current-day sample is materialized once; separate lookups read
the one or two original floats per group and check their exact timestamp before interpolation.
A BRIN time index serves retention without one index entry per sample.

The read-only SQL view `web_telemetry.health` feeds the existing watchdog:

- Error growth: at least 10 stored errors in the last 10 minutes, at least three times the preceding
  10-minute window.
- New digest/route: a nonempty digest in the last 10 minutes with no older retained sample for that
  digest and route. History is bounded by retention.
- Schema size: at least 480,000,000 bytes, 80% of the 600,000,000-byte budget.
- Quota loss: dropped samples/errors in the current UTC day.

Watchdog also checks successful `web-telemetry.retention` completion within 26 hours in pg-boss.
The queue retains completed receipts for two days, across daily runs. Missing completion signals
an overdue cleanup; a later successful run clears it. Forwarding failures and minute report ceilings
raise a separate signal from the Web log's five-minute window. Its recovery means no new losses
in that window; it does not reconstruct dropped reports. If reading the log or database fails,
watchdog holds existing signals rather than announcing recovery.

These checks read only, use the watchdog's existing statement timeout, and clear through its
existing recovery path. Quota loss clears after the UTC day ends. Watchdog installation must follow
the migration that creates its view.

## Verification and delivery

`pnpm telemetry:measure` owns an isolated PostgreSQL 18.4 container limited to two CPUs and 1 GiB.
The image uses the canonical immutable ECR digest. The command verifies the effective Docker CPU
and memory limits and includes the actual checkout SHA, image ID and Node version in its raw JSON.
Integration CI runs it without changing the corpus or thresholds, and retains both successful and
failed raw logs in `telemetry-resource-*`. `source-sha.txt` records the actual checkout: on a PR it
can be a synthetic merge SHA. Only evidence matching the release SHA can satisfy release preflight.
It fills 600,000 vital samples and 150,000 errors using diverse 500-code-point, four-byte messages,
then runs 32 daily insertion/30-day-cleanup cycles through the actual quota/coverage routines.
Initial bulk preparation uses ordinary vacuum for sample visibility. Query adapters initialize
against an empty date window before timed queries; that preparation does not read the corpus. It measures before cleanup, after cleanup
and after ordinary vacuum. No VACUUM FULL, REINDEX or global setting change resets the measurement.
Ordinary vacuum and checkpoints model maintenance during a real day; it retains file high-water
marks and reusable pages. A checkpoint completes initial bulk preparation and each day's maintenance
before timing the p75 query. It adds no query that warms the sample corpus; existing cache misses
remain part of the measurement. Deferred writes from fixture preparation finish outside that read
measurement. This measures reads after maintenance, not a production latency guarantee under
concurrent writes.
The command checks the 600 MB budget, p75 query time and daily cleanup
budget, and removes its database in `finally`. The final Issue/PR records measured values and
machine conditions. The [resource proof](../verification/web-telemetry-707.md) records the accepted
corpus, all 32 cycles, timings and API memory method.

Migration `0087_web_telemetry` adds its own schema; `0088_web_telemetry_percentile_index` derives
the stored UTC day and binary value key, then replaces its summary index with the compact value/day
index. It backfills both derived fields in one table rewrite; allow for that rewrite and index build
in maintenance.
Apply both through the ordered
migration entrypoint. Existing application tables and query contracts stay unchanged.
The release contract nevertheless compares exact schema identities; both migrations change that
identity. Rollback to the previous application release is therefore
not allowed by the current release contract, even with compatible old queries. Failure after
migration requires repair forward. The production Compose smoke owns fresh, prefix-upgrade and
frozen N-1 query proofs.

API RSS relative to the previous application and production available memory belong to resource
verification. After the orchestrator announces deployment, check available server memory remains
at least 1 GiB, telemetry ingestion, retention completion and read-only MCP output. Merge and release
remain with the orchestrator for this task.
