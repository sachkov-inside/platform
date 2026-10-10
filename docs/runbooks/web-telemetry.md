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

The completeness flag describes the storage quota. Existing minute ceilings and transport/database
failures remain visible in structured logs; their losses cannot be reconstructed from database
counters alone. The stored sample is therefore operational telemetry, not a visitor census.

## Retention, maintenance and signals

The existing `billing-worker` registers `web-telemetry.retention`, schedules it daily at 03:00 UTC,
and requests cleanup at worker startup. Cleanup deletes samples older than 30 days in batches of
5,000 through time indexes. Daily counters expire when their entire UTC day is older than the
cutoff. Ordinary autovacuum uses table-local scale factors 0.01 (vacuum) and 0.02 (analyze) for sample
and error tables; global PostgreSQL settings stay unchanged. Vital samples reference a shared route-template dictionary. A covering group index includes time
and value, so summary reads can avoid fetching heap rows after ordinary vacuum. A BRIN time index
serves retention without one index entry per sample.

The read-only SQL view `web_telemetry.health` feeds the existing watchdog:

- Error growth: at least 10 stored errors in the last 10 minutes, at least three times the preceding
  10-minute window.
- New digest/route: a nonempty digest in the last 10 minutes with no older retained sample for that
  digest and route. History is bounded by retention.
- Schema size: at least 480,000,000 bytes, 80% of the 600,000,000-byte budget.
- Quota loss: dropped samples/errors in the current UTC day.

These checks read only, use the watchdog's existing statement timeout, and clear through its
existing recovery path. Quota loss clears after the UTC day ends. Watchdog installation must follow
the migration that creates its view.

## Verification and delivery

`pnpm telemetry:measure` owns an isolated PostgreSQL 18.4 container limited to two CPUs and 1 GiB.
It fills 600,000 vital samples and 150,000 errors using diverse 500-code-point, four-byte messages,
then runs 32 daily insertion/30-day-cleanup cycles through the actual quota/coverage routines.
Initial bulk preparation uses ordinary vacuum for sample visibility. Query adapters initialize
against an empty date window before timed queries; that preparation does not read the corpus. It measures before cleanup, after cleanup
and after ordinary vacuum. No VACUUM FULL, REINDEX or global setting change resets the measurement.
Ordinary vacuum and checkpoints model maintenance during a real day; it retains file high-water
marks and reusable pages. The command checks the 600 MB budget, p75 query time and daily cleanup
budget, and removes its database in `finally`. The final Issue/PR records measured values and
machine conditions. The [resource proof](../verification/web-telemetry-707.md) records the accepted
corpus, all 32 cycles, timings and API memory method.

Migration `0087_web_telemetry` only adds its own schema. Existing application tables and query
contracts stay unchanged. The release contract nevertheless compares exact schema identities;
this migration changes that identity. Rollback to the previous application release is therefore
not allowed by the current release contract, even with compatible old queries. Failure after
migration requires repair forward. The production Compose smoke owns fresh, prefix-upgrade and
frozen N-1 query proofs.

API RSS relative to the previous application and production available memory belong to resource
verification. After the orchestrator announces deployment, check available server memory remains
at least 1 GiB, telemetry ingestion, retention completion and read-only MCP output. Merge and release
remain with the orchestrator for this task.
