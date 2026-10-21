# Isolated native Caddy observation

This opt-in pilot observes native Caddy HTTP metrics through the current disposable Core Alloy
and VictoriaMetrics, using both a canonical HTTP reader and the pinned VictoriaMetrics MCP.
It does not change Core defaults or production configuration. Production Caddy remains
`NOT_COVERED`. Source preparation and protocol fixtures do not establish native acceptance.
Until exact-source hosted evidence is attached, Linux adaptation, collection, MCP, outages and
native resource cleanup are `NOTRUN`.

## Owned execution

[The separate workflow](../../.github/workflows/observability-caddy-storage.yml) creates a fresh
Linux project for each of `baseline`, `failure`, `timeout` and `interruption`. Each project uses
the existing seven containers, four volumes and two networks. Images and native MCP archives
come from the current [input lock](../../infra/observability/pilot/inputs.lock.json).
No additional service, host publication, credential, capability or host access is introduced.
The workflow needs Node.js and Python standard libraries; it installs no application workspace
dependencies and builds no application runtime.

The CLI owner is [caddy_storage.py](../../scripts/observability-caddy-storage/caddy_storage.py).
Its `admission`, `run`, `worker` and `recover` actions require Linux. The workflow owns executable
commands, exact arguments, toolchain/action pins, provider metadata and always-recovery. Do not
run this native scope on the owner's Mac. Existing Compose ownership, disk admission, storage
monitor, 600-second worker and 90-second cleanup limits still apply.

`overlay.py` derives private Caddy and Alloy files from current committed Core sources. It changes
only the gateway/Alloy config binds and gateway logging. Exact private config, Compose and auth
bytes are verified before acquisition. Core's image, mount, network and project registry is
extended with live logging, port, capability and host-authority checks before native operations.
Unexpected authority or a changed registered container refuses the operation.

## Native source and partition

The overlay enables global Caddy metrics and an unpublished `:9091` registry listener. Admin
stays off. The registry is reachable by trusted peers of **both** owned project networks; this
ephemeral boundary is not tenant or network memory isolation. Gateway Docker logging is `none`
before private/error traffic. Access logging stays disabled. Existing Alloy and VictoriaTraces
logging suppression remains in force. Raw configuration, adaptation, module listings, registry
text, HTTP/MCP bodies and stderr never enter public artifacts.

The already registered digest-pinned Linux gateway must execute bounded `caddy version`,
`caddy list-modules --versions` and `caddy adapt`. No helper container or `--validate` is used.
The whole normalized adaptation must match the independently recorded official Caddy 2.11.4
Mac adaptation hash and exact route structure in the primary fixture. The Mac witness alone
does not prove the Linux image's behavior.

The retained partition is exactly `server="srv0",handler="subroute"`. Its two top-level routes
share one exclusive group, including an unconditional catchall. Nested `request_body` and
`static_response` handlers would double-count traffic and are excluded. The registry is `srv1`
and is excluded by server identity. This covers routed HTTP requests, including the pilot's
own readiness, canonical and MCP queries. It does not cover TCP, TLS, HTTP/3, pre-route parse
failures, arbitrary aborted connections, or production processes.

The dedicated Alloy block retains only:

| Family | Meaning |
| --- | --- |
| `up` | The scraper's native target availability |
| `caddy_http_requests_total` | Completed routed-handler requests, without method/status labels |
| `caddy_http_request_errors_total` | Middleware errors, **not** a count of all 5xx responses |
| `caddy_http_requests_in_flight` | Currently executing handlers |
| `caddy_http_request_duration_seconds_bucket` | The exact twelve native histogram buckets |
| `caddy_http_request_duration_seconds_sum` | Total observed duration |
| `caddy_http_request_duration_seconds_count` | Method/status-specific duration observations |

Full selected raw native families, including excluded handler/server identities, are checked
before label deletion. Unknown labels, duplicate identities, invalid values and visible partial
histogram contradictions refuse. Unretained vendor families are not claimed covered. Stored
identities use only `__name__,job,instance,server,handler,code,method,le`, with fixed job/instance,
closed method/status/bucket sets and at most 64 duration groups. Empty or lazy groups are not
invented as zero. A non-HandlerError can omit duration observation; incomplete accounting cannot
be promoted to success.

The private bounded request journal includes successful read pairs and each controlled HTTP
response. Comparisons require complete fresh matching cohorts and identities. A sample boundary
inside a request window is ambiguous and cannot prove a request delta. Gaps over ten seconds
produce incomplete comparisons; any visible decreasing counter produces `reset_observed`, with
no negative or fabricated delta. Buckets describe distributions, not exact maximum or p99 latency.

## Readers and native cases

Both transports use the existing bearer and fixed loopback gateway path. The canonical reader
has one ten-second deadline for two fixed instant queries, HTTP headers/body, full raw validation
and completion-age calculation. Each body is capped at 1 MiB; server timeout is two seconds.
Original sample timestamps determine age. Fresh validated `up=0` can mean `down`; an unreachable
gateway means only `query_unavailable`. Stopping Alloy while queries remain reachable must
produce stale/missing observations, followed by genuine fresh recovery.

MCP sends one four-response stdio sequence: initialize, discovery, values and original timestamps
at the same fixed evaluation time. Strict Caddy decoding runs before shared id/filter/extraction;
old callers retain their default decoder. Complete envelopes, discovery schemas, embedded VM
JSON and every stored row are checked before projection. Canonical and MCP full identity/value/
original-timestamp maps must agree. A bounded typed tool-error frame remains a query refusal;
malformed protocol metadata cannot substitute for the gateway-outage fact. The existing 1 MiB
framing and 15-second RPC limits remain unchanged.

The pinned MCP vendor uses `io.ReadAll` upstream, which is **not an allocation cap**. This scope
accepts that limit only for the fresh owned digest-pinned VM, fixed instant selectors/time and
controlled finite corpus, without foreign ingestion. It must not be extended to arbitrary queries,
upstreams, tenants, remote endpoints or ambient credentials. Do not claim memory isolation.

The native corpus includes GET/POST query success, rejected auth, fallback, body limit, controlled
owned-vmauth outage, sentinel-bearing headers/path/query/body, exact partition reconciliation,
both query transports, gateway outage, Alloy staleness and a deliberately visible counter reset.
No provider, business message or production application call is made.

For in-flight observation, a child sends the existing POST query's declared seven-byte body
`query=1`, withholding its final byte. Its total monotonic eight-second deadline covers connect,
prefix send, wait, response headers/body and parsing. The child owns one outbound socket and
remains in the existing worker group. Private `R/F/D` protocol, EOF and extra-byte checks, parent
finally and outer group ownership cover success, failure, timeout and interruption.

Before this child, a quiescent raw9091 snapshot must show retained in-flight zero. After `R`,
**before any8080 canonical/MCP query**, full raw9091 must show exactly one while the final body
byte remains withheld. Only then may stored canonical/MCP original cohorts strictly inside the
conservative `R`-received to `F`-sent interval establish the case, followed by validated finite
HTTP200 completion. A canonical self-query's in-flight value is insufficient. Missing native
visibility within eight seconds fails/incompletes the case; no deadline is increased. The source
predicate and protocol fixtures do not replace actual Linux Caddy evidence.

## Outcomes and cleanup

Only baseline can establish native observation acceptance. Other matrix jobs inject a closed
failure, the unchanged 600-second outer timeout, or interruption of the verified owning
supervisor after native identity acquisition. They require exact expected exits, matching phase
and progress, no positive observation, no monitor failure, and typed absence of all seven
containers, four volumes and two networks. An arbitrary nonzero exit cannot pass a fault job.
Failure before a full registry leaves typed cleanup unproved and cannot become a native success.
No daemon pause lease is created.

The public collector allows only existing `source.json`, `admission.json`, `evidence.json`,
`cleanup.json`, `worker-outcome.json`, `recovery.json`, plus the exact closed
`caddy-observation.json` and `caddy-run.json` schemas. New records use bounded anchored reads and
0600 atomic commits. Invalid present records refuse **before** destination creation. Missing
records do not imply success; pre-acquisition admission failure can still retain its metadata.
The first functional failure stays separate from cleanup/recovery results.

`source_inputs()` binds the full conservative repository source/helper/config/workflow closure.
Hosted source metadata records checkout SHA/tree, provider execution SHA, PR parents, run/attempt
and per-file hashes. Assess each matrix member on its actual source and cleanup artifacts.
Protocol fixtures, source checks and a green application CI job do not prove this native slice.
The pilot provides no production deployment, server sizing, cost saving, seven-day or capacity
acceptance, and performs no #1579 experiment.

## Closed ownership diagnostics

The first native run can fail before `logging` is marked passed. That checkpoint follows the
whole ownership constructor, including Core registration and the overlay's live authority checks.
A failed acquisition can leave no complete private witness, so generic `down`/`residue` results
still cannot establish typed resource absence. The pilot retains that refusal.

`caddy-run.json` keeps its exact six top-level fields and 8192-byte limit. Its phase allowlist
adds 139 fixed ownership values: six global operations and nineteen gates for each of the seven
source roles. Lookup read, empty/noncanonical/duplicate ID, inspect decode/shape/identity, mounts,
networks, registry checks, witness commit and live authority can be distinguished without
publishing any observed value. Role tokens come only from the fixed source list. No Docker IDs,
images, project names, paths, raw fields, errors, stderr or arbitrary labels are added.

The optional Core checkpoint callback defaults to `None`; existing Core callers retain their
read commands, guards, exception arguments and rejection order. Caddy records predicate gates
in memory and persists before existing blocking reads/witness writes and at terminal failure.
Registration callbacks are disabled after the full witness attempt. Later scenario phases stay
unchanged. A secondary metadata-write refusal preserves the original failure and traceback. The worker saves
the active traceback before terminal metadata persistence and restores it through the built-in
`BaseException.with_traceback`, including when that persistence rethrows the same exception object.
Known ownership exception types map to fixed contract/transport/timeout categories; unknown
subclasses remain unknown. No exception text or foreign diagnostic properties are inspected.

These source diagnostics do not identify the earlier native failure's cause or fix a native
runtime. A fixed role/gate in new exact-source hosted evidence is needed before a corresponding
source counterexample or native acceptance can be claimed. All original privacy, authority,
cleanup, query and time budgets remain in force.

## Private configuration readers

The opt-in overlay verifies one owner for its three fixed private files (`config.alloy`,
`Caddyfile`, `auth.json`) before deriving reader identities. The files remain regular, single-link,
owner-only `0600` files in the protected `0700` output directory. Alloy and gateway explicitly use
that numeric UID:GID; vmauth keeps the same owner identity it already requires for its private auth
file. Core defaults remain unchanged. The overlay refreshes protected owner facts before runtime
checks and compares the three configured readers with the required private `.Config.User` fact.
The other four roles retain their pinned-image default users. No user identity enters public
artifacts, and no file permission, capability, port or deadline is widened.

These source checks do not establish the earlier native Alloy exit cause. Exact pinned Linux
file readability, Alloy config parsing, both services' startup and the four native modes still
need hosted CI evidence before runtime acceptance.

### Known acquisition-limit feedback

The existing `Scenario.snapshot` refusal at 128 acquisitions keeps its limit,
position and fixed message. Its exact owning `RuntimeError` subtype now maps to the
already admitted `budget` reason at both scenario and worker boundaries. Ordinary
errors, identical error text and subclasses of this refusal remain `unknown`.
No acquisition counts or exception details are published.

The same six-field, 8192-byte `caddy-run.json` record also admits eight finite
partition checkpoints: `partition_initial_acquire`, `partition_initial_state`,
`partition_initial_after_cut`, `partition_initial_boundary`,
`partition_compare_acquire`, `partition_compare_state`,
`partition_compare_journal` and `partition_compare_after_cut`. The acquire phases
mean no predicate result has been observed in that subphase. Other phases record
the last rejected predicate category before a later failure. The journal category
does not distinguish an incomplete comparison from a request crossing a scrape
boundary. Checkpoints update memory only. The existing terminal failure write
persists the last category; later progress cannot replace that first failure.
Default `fresh_after` callers retain their original behavior without checkpoints.

When an initial partition rejects an already acquired nonobserved canonical status, the scenario
remembers the last such closed report. On a terminal `partition_initial_state` failure, the worker
makes one best-effort write to the existing `caddy-observation.json`. Its original state, reason,
age and canonical-passed/MCP-unrun transport stay intact, with no observation or comparison.
Other failure phases do not write this diagnostic. Validation or persistence failure preserves
the original scenario failure and traceback. The report is not readiness, MCP equivalence or a
partition pass; it identifies neither an earlier run's status nor the cause of a native refusal.

Failure notification retains the original experiment exception and traceback even
when its first persistence attempt fails, including when it raises the same
exception object. This guard covers notification, not unrelated native cleanup
failures. No raw errors, numeric counters, extra reads, polling writes or larger
budgets are introduced.

These changes provide source diagnostic coverage. Earlier native partition
failures remain unattributed. A `budget` result identifies the existing acquisition
guard, but a checkpoint alone does not explain why acquisitions accumulated or
establish native acceptance. Fresh source-bound native evidence is still required.

## Source test progress

The source wrapper retains its single `15000ms` suite deadline and existing fixture/cleanup
budgets. Best-effort start/completed markers identify only fixed inventoried source test IDs in
its private captured stderr. The parent validates the complete ordered marker prefix before
showing the last started/completed source method and completed count. Missing, malformed or
oversized markers give `unknown`. Both timeout and nonzero-exit assertions omit raw captured
output. `completed` records that a method stopped; it does not report a pass or replace the
original exit/timeout/interruption result. Inventory checks retain every original source test
exactly once, along with explicitly added progress controls.

This diagnostic does not explain the earlier baseline source timeout or establish native Caddy
acceptance. No suite splitting, deadline increase or production configuration change is included.
