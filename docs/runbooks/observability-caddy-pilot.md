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

The pinned scrape parser canonicalizes the integer histogram bounds `1`, `5` and `10` to
`1.0`, `5.0` and `10.0`. The Caddy keep rule and stored readers admit exactly these three
additional spellings alongside the original twelve bounds. Value/timestamp rows must retain
identical raw labels before pairing. Only the joined distribution groups aliases as the same
logical bound; two spellings of one bound in the same method/status group refuse, even with
equal values and timestamps. A spelling change across snapshots leaves comparison incomplete.
Direct native text validation keeps the original producer spellings. Focused source contracts
exercise the generated keep rule and complete stored-vector oracle using a public pinned-parser
fixture. They establish this policy compatibility, not the cause of prior native failures or a
successful Linux observation. Query, time, row, privacy, profile and cleanup limits are unchanged.

MCP sends one four-response stdio sequence: initialize, discovery, values and original timestamps
at the same fixed evaluation time. Strict Caddy decoding runs before shared id/filter/extraction;
old callers retain their default decoder. Complete envelopes, discovery schemas, embedded VM
JSON and every stored row are checked before projection. Canonical and MCP full identity/value/
original-timestamp maps must agree. A bounded typed tool-error frame remains a query refusal;
malformed protocol metadata cannot substitute for the gateway-outage fact. The existing 1 MiB
framing and 15-second RPC limits remain unchanged.

A task-owned reproduction with the digest-verified native v1.20.2 executable reproduced
canonical-observed followed by MCP-stale on the same original samples: initialization alone
took 5.57–7.15 seconds, crossing the ten-second source age. Both actual HTTP queries retained
the same fixed evaluation time and `nocache=1`; no upstream cache/time rewrite was observed.
The Caddy phase now completes native initialize/discovery before selecting its canonical
acquisition and before opening the held-body request. Each phase owns one ready child and one
values/timestamps pair. No process/session spans partition, held, outage or reset phases.
The existing helper's sixty-second lifetime and cleanup are unchanged. The actual query pair,
whole-vector validation and final oracle share one ten-second budget; completion freshness
remains ten seconds and held-body lifetime remains eight. A ready session still rejects old
samples and cannot be reused. The local HTTP/native-MCP reproduction is a timing/transport
regression proof, not Linux Caddy/VictoriaMetrics acceptance.

The pinned MCP v1.20.2 producer supplies optional initialize `instructions` metadata. The Caddy
reader accepts only a string at that field, within the existing 1024 UTF-8 byte metadata limit
and privacy checks. It does not execute, display or publish the contents. Unknown fields,
duplicate keys and invalid protocol, capability or server metadata remain refusals. The owned
protocol fixture verifies this public producer contract; it does not establish the cause of the
historical native initialize failure, whose actual response was not retained.

The same pinned producer's default single-instance discovery catalog contains 16 tools. Schema
property names accept the four source-fixed spellings `topN`, `maxLifetime`, `focusLabel` and
`extraLabel` alongside the existing lowercase names. Their spelling and required entries stay
intact. Tool names retain the lowercase rule, and the complete catalog still passes schema,
privacy and size checks before selecting the fixed six-property `query` contract. The owned
fixture includes the complete public source-derived catalog; it is neither an SDK-generated nor
a captured native response and does not establish the historical discovery failure's cause.

The pinned MCP vendor uses `io.ReadAll` upstream, which is **not an allocation cap**. This scope
accepts that limit only for the fresh owned digest-pinned VM, fixed instant selectors/time and
controlled finite corpus, without foreign ingestion. It must not be extended to arbitrary queries,
upstreams, tenants, remote endpoints or ambient credentials. Do not claim memory isolation.

The native corpus includes GET/POST query success, rejected auth, fallback, body limit, controlled
owned-vmauth outage, sentinel-bearing headers/path/query/body, exact partition reconciliation,
both query transports, gateway outage, Alloy staleness and a deliberately visible counter reset.
No provider, business message or production application call is made.

The privacy POST places its body sentinel in a MetricsQL comment on the constant `1` query,
using only the admitted `query` form key. Its sentinel Host, Cookie, trace and other private
headers remain present. The case still requires HTTP200 and the complete validated query-one
response through the closed query guard and native VictoriaMetrics. Unknown form keys remain
refused before storage. The local native guard/vendor replay establishes this request contract;
exact-source Linux Caddy acceptance remains a separate requirement.


For in-flight observation, a child sends the existing POST query's declared seven-byte body
`query=1`, withholding its final byte. Its total monotonic eight-second deadline covers connect,
prefix send, wait, response headers/body and parsing. The child owns one outbound socket and
remains in the existing worker group. Private `R/F/D` protocol, EOF and extra-byte checks, parent
finally and outer group ownership cover success, failure, timeout and interruption.

Only this private Caddy overlay buffers query request bodies within the same existing `64KB`
body limit before forwarding them to vmauth. The held native gauge therefore witnesses Caddy
receiving the incomplete body, rather than an already active upstream request. F completes that
body, then the real vmauth, horizon guard and VictoriaMetrics must return the validated HTTP200
response inside the unchanged eight-second child deadline. Without buffering, native vmauth can
return HTTP408 while waiting for the withheld byte across a five-second scrape and the integer
boundary. No upstream timeout, body limit, Core or production Caddy configuration is changed.

Before this child, a quiescent raw9091 snapshot must show retained in-flight zero. After `R`,
**before any8080 canonical/MCP query**, full raw9091 must show exactly one while the final body
byte remains withheld. After the proved native scrape, F must produce validated finite HTTP200/D
completion and close the child inside its eight-second deadline. Only afterward may stored
canonical/MCP original cohorts establish the historical case. Every source timestamp must lie
strictly inside the conservative `R`-received to `F`-sent interval. A canonical self-query's
in-flight value is insufficient. Missing native visibility within eight seconds fails/incompletes
the case; no deadline is increased. Stored publication has its separate ten-second deadline,
and every final source observation still requires age at most ten seconds. The source predicate
and protocol fixtures do not replace actual Linux Caddy evidence.

The held socket proves native collection separately from asynchronous storage visibility.
After the independent public gauge witness, the worker reads the validated private
`srv1/subroute` registry. Pinned Caddy instruments the outer compiled route rather than
the nested `metrics` handler. It first waits for that role's in-flight gauge to be exactly one
(the worker's own read), excluding an already running pre-R scrape. Only Alloy and this worker
read this registry in the owned topology. Each subsequent native read accounts for its preceding
completed owned read; a completed-request counter increase beyond that exact count proves an
Alloy scrape. Own reads, missing roles, private labels, a counter reset or a busy baseline cannot
substitute for it. Polling is every 250ms, within the unchanged eight-second socket deadline.

After that scrape, the worker waits only until the next integer evaluation boundary that can
include it, sends F, validates HTTP200/D and closes the child. It freezes `E=floor(F)` and then
queries the stored history at that same E through both canonical HTTP and MCP. Publication may
settle for at most ten seconds after release; every paired query retains its ten-second budget.
Every original sample timestamp must still satisfy `R < timestamp < F`, all original maps must
match, and source age must be at most ten seconds at each transport's final completion. A query
may complete after F; a later or stale source sample cannot replace the held witness. No flush,
scrape acceleration, held deadline, freshness tolerance or 128-acquisition cap is introduced.

The 2026-10-27 owned HTTP/native-MCP replay reproduced the previous storage-coupled timeout at
7.999 seconds even though scrapes occurred. The corrected sequence closed the held request in
0.893 seconds and read the same historical cohort after 7.159 seconds of post-release export
latency. The peer kept the five-second scrape cadence and both native MCP queries at fixed E.
This proves sequencing and transport, not Linux Caddy/VictoriaMetrics acceptance. Earlier local
replay of forty prior acquisitions plus a 6.8-second visibility delay also proved why 50ms
polling exhausted the shared128 cap; that separate polling defect was fixed before this
sequencing change. Linux native acceptance remains pending.

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

The source wrapper runs three separately owned contract groups: 72 source methods, 12 HTTP/MCP
transport and held-body methods, and three process-lifecycle methods that acquire real launchers
and listeners. The transport fixtures retain their real failure and cleanup paths. The 72-source aggregate
has a `30000ms` guard; transport and process-lifecycle groups retain `15000ms`, with fixture and cleanup budgets unchanged. Complete discovery must match the
87-method inventory, retaining all original methods, before selection in every process. The checked group union has
no missing or repeated method; every method executes once across the three invocations.
Best-effort start/completed markers identify only fixed inventoried source test IDs in
its private captured stderr. The parent validates the complete ordered marker prefix before
showing the last started/completed source method and completed count within that group. A
successful group also requires its complete marker sequence, independently of exit status.
Missing, malformed or
oversized markers give `unknown`. Both timeout and nonzero-exit assertions omit raw captured
output. `completed` records that a method stopped; it does not report a pass or replace the
original exit/timeout/interruption result. Inventory checks retain every original source test
exactly once, along with explicitly added progress controls.

These source contracts do not establish native Caddy acceptance. The native cases, workload,
production configuration and their acceptance deadlines are unchanged.

### Native-only incomplete detail

The existing native scenario opts into nine fixed reasons in the existing
`caddy-observation.json` reason field: `partial_missing_total`, `partial_missing_errors`,
`partial_missing_flight`, `partial_no_duration_groups`, `partial_missing_bucket`,
`partial_missing_sum`, `partial_missing_count`, `partial_count_sum` and `partial_timestamps`.
They refine only an already rejected fresh incomplete observation after the whole original
vector and histogram checks. Missing simple counters take total/errors/in-flight order;
incomplete histograms take bucket/sum/count order. A later malformed group still refuses
the whole observation. Unequal stamps are identified only when the observation is otherwise
complete. The reasons retain no raw labels, counters, timestamps or exception details.

Ordinary query/MCP callers keep legacy `partial` and `unseeded` reasons. Only the internal
native scenario supplies `diagnose=True`; other values keep default behavior. New reasons
are accepted only for incomplete reports with null observation/comparison, a fresh sample
age and canonical-passed/MCP-unrun transport. Legacy reports remain valid; an older reader
may refuse the new vocabulary, so collection must use its source-bound current reader.
No reason establishes a native cause, successful comparison or readiness. Queries, caps,
process ownership and persistence points are unchanged.

### Native-only stale up-age window

For the first stale up-sample branch only, the native `diagnose=True` path may add
`up_age_window` to the existing observation. `over_at_evaluation` means the admitted
sample was already older than the unchanged 10-second limit at the fixed query
evaluation instant. `crossed_by_completion` means its age was at most 10 seconds
then and exceeded that limit by final completion. Integer evaluation rounding,
request, decoding and scheduling time are not distinguished. Neither value identifies
a native cause or turns a stale observation into success.

The field uses only already validated operands and adds no query, clock read,
poll, numeric timestamp, counter, raw label or exception detail. It is absent from
default and MCP results and from every other observation branch. The current reader
accepts exactly these two tokens only with stale/none, a persisted numeric age of at least
10 seconds, null
observation/comparison and canonical-passed/MCP-unrun transport. Legacy reports without
the field remain valid; an older reader may reject it, so use the source-bound reader.
The saved final age alone cannot reconstruct this witness or its historical arithmetic.
Controlled source tests qualify the discriminator, not a causal native reproduction.
Original acquisition, query, scenario and output limits and failure priority remain.

The native freshness decision still uses the original strict Decimal age above
10 seconds. Its unchanged float projection can round an age such as
`10.0000000000000001` to the persisted value `10.0`; both window tokens can occur
at that serialized boundary. The reader compares the already validated original
numeric age against 10 rather than using its rounded float projection, so a persisted
Decimal strictly below 10 is refused. A saved age of 10 alone cannot establish the original
stale decision or token arithmetic. Legacy stale reports without the token retain
their existing behavior. This serialization compatibility rule changes no native
freshness tolerance, success predicate, query, clock, process owner or limit.

`caddy-run.json` distinguishes the held baseline, child opening, independent held read, quiet registry, native scrape
witness, integer boundary, release/HTTP response, stored history and final cohort validation using only
fixed `inflight_*` stages. Checkpoints update memory and are persisted on terminal failure; polling does
not add disk writes or publish native response bodies. A `contract` failure identifies its owning stage
without implying that a controlled HTTP/MCP fixture established native Caddy acceptance.

Gateway readiness uses its existing bounded loop for an exact refused connection, an empty
HTTP EOF or an exact TCP reset on the first buffered read before any HTTP response prefix was
observed. The recovery-only response class peeks without consuming bytes, then delegates to
the unchanged standard status/header parser. Once any prefix, including HTTP100, was seen,
reset/EOF remains fatal. Request-side resets, broken pipes, aborted connections, timeouts,
protocol/header/body failures and unknown subclasses are not promoted to readiness retries.
Default non-recovery responses retain their original parser.

Only the exact owned `ReadinessUnavailable` marker admits another attempt. The existing HTTP
and total readiness deadlines, size checks and whole query-one validation are unchanged.
HTTP502 responses remain journalled; readiness succeeds only after a whole validated HTTP200.
An attempt without an observed whole response adds no invented journal response. Its server-side
request/counter admission is unknown, not zero. Startup and gateway-recovery readiness precede
their seed/cut/baseline. Seed-internal readiness keeps the original accounting interval; any
unexplained native admission there still fails the unchanged exact partition comparison.
Real TCP reset, empty EOF, partial status/header/body, HTTP100, malformed protocol and deadline
controls exercise this boundary on the host and Linux Python3.12. These controls reproduce the
transport pattern; a prior hosted `gateway_recovery_reset` stage identifies an exact reset type
but does not establish why the peer reset or whether that historical response had a prefix.

Nine fixed `gateway_recovery_*` phases distinguish restart, readiness, refused connection,
response-free EOF, reset, timeout, contract, other failure and the fresh acquisition after seed.
They update memory only; existing progress/terminal persistence writes the same six-field
`caddy-run.json`. Readiness failure categories use exact exception types without reading their
text, arguments or provider bodies. Optional checkpoint failures cannot replace the experiment's
active failure, including when the callback raises an operator interrupt. Without an active
failure, an operator interrupt still propagates; the mandatory restart runs in either case.
These phases do not prove a historical unknown failure's cause. Collection requires the current source-bound
reader; no positive case, query oracle, freshness tolerance or acquisition budget is changed.

Eight fixed `reset_*` checkpoints distinguish the64-request corpus, old-source acquisition,
gateway stop/start, readiness, native MCP entry, new-source acquisition and reset predicate.
They update memory only, outside request journal windows. Existing seed and MCP progress
still identify their own inner operations. A failure escaping this reset caller additionally
uses an exact-type category: `command_exit`, `command_timeout`, `authority_refusal`, `http_eof`,
`http_reset`, `http_body`, `http_status`, `host_io` or `runtime`; other failures retain the
existing categories. Subclasses do not inherit a new category, and classifications outside
this caller are unchanged. No exception text, arguments, command, identity or provider body
is inspected or published. The existing six-field run schema and8192-byte bound remain.
Optional metadata errors cannot replace a primary failure; an operator interrupt at the
marker after a successful stop still executes the mandatory start before propagating.
These diagnostics add no retry, traffic, acquisition, deadline or oracle change. A historical
`reset/unknown` result remains unattributed until new source-bound runtime evidence identifies it.

Source-cohort polling leaves five quiet seconds after an unsuccessful fresh/partition/stale
acquisition completes, before starting its next query. This matches the native five-second
scrape interval. A shorter pause can repeatedly acquire the same frame or align slow query
windows with every new sample, consuming the shared128 cap. The pause is outside the recorded
query window; it does not invent request traffic. The first acquisition remains immediate;
initial baseline publication confirmation has the bounded follow-up described below.
Readiness and the frozen held-frame publication keep their existing quarter-second cadence.
The sixty-second wait, ten-second query,600-second scenario,128 acquisitions and all whole
source/privacy, freshness, accounting and reset/MCP comparisons remain unchanged. A rejected
sample is never promoted; exhaustion or expiry still fails before acceptance.

Partition prepares its initial baseline after native MCP is ready, using the later of the
original cut and that preparation's current clock. Its source timestamp must actually pass
that cut and the unchanged clear-boundary test. A new quiet preparation advances the cut past
the preceding read's completion and quiet interval, while the substantive seed has not started.
The last whole observed frame's clock may schedule the next query at an integer evaluation time
strictly after a projected five-second frame. A valid older frame can still arrive before the
projected frame is published. For at most one five-second interval after that scheduled query,
quarter-second follow-ups keep the same preparation cut and confirm the actual published frame.
No follow-up query starts at or after expiry, including after an OS sleep overrun; expiry
starts a new quiet preparation. A query started before expiry may finish under its existing
ten-second request and sixty-second stage deadlines. The128 global cap still bounds every attempt. The hint never supplies evidence: the returned whole vector, actual
source timestamp, freshness and journal checks still decide. Missing/stale/incomplete frames
use the ordinary quiet wait. The existing
rollover remains available only after the whole journal comparison passes and the source stamp
has not yet passed the batch cut. No new rollover across an unverified business interval is
added; no request window, counter or cohort-gap rule is reset.


For the partition comparison, the unchanged seed corpus starts at an integer wall clock after
its baseline's projected next five-second scrape. This is a scheduling hint, not a new source
admission rule. It keeps the long invalid-token request in a quiet interval: pinned vmauth1.154.0
[intentionally delays invalid-token responses by2-3 seconds](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/v1.154.0/app/vmauth/main.go#L914)
as brute-force protection. That behavior and the original HTTP corpus/order remain unchanged.

After seed, canonical reads use historical fixed evaluation times to verify consecutive source
intervals. For a validated baseline stamp S, the next query uses E=floor(S+10) and starts no earlier
than E+1. It can therefore select the real intermediate scrape around S+5 after publication,
without placing its own read window over the following scrape. Each returned whole vector must
still be observed, have actual completion age at most10 seconds, match the exact journal and
retain a source gap at most10 seconds. Only a successful whole journal comparison advances the
baseline. Adjacent verified intervals must continue until the source stamp passes the original
whole seed cut; no request, invalid-token window or failed comparison is discarded.

All partition comparison intervals share one existing60-second deadline. Query10 seconds,
scenario600 seconds,128 acquisitions and256 journal windows remain bounded. A late read, scrape
crossing a request, missing/reset frame or excessive source gap still refuses; a clock prediction
never supplies a counter, sample or acceptance result. This preparation fixes a reproduced
caller/native window failure. The exact source stamps behind an earlier hosted journal timeout
remain unknown until a new exact-source Linux run confirms the complete scenario.


### Закрытая диагностика запуска native MCP

В `caddy-run.json` запуск MCP различает `mcp_initialize_*` и `mcp_discovery_*`:
`write`, `wait`, `decode`, `eof`, `deadline`. Отдельная фаза `mcp_initialized_write`
обозначает отправку уведомления после принятого initialize. Это последние выполненные
границы чтения и записи, а не установленная причина исторического отказа. Поля, исходный
ответ MCP, аргументы, environment и текст исключения в отчёт не попадают. Для точного
объекта, вышедшего из startup, обычный `RuntimeError` получает категорию `runtime`,
точные ошибки host I/O получают `host_io`; неизвестные подклассы сохраняют прежнюю
классификацию. Сбой необязательного диагностического callback не заменяет протокольную
операцию. После готовности session последующие действия вызывающего кода не считаются
startup. Чтение initialize и discovery сохраняет прежний предел 15 секунд на ответ,
helper живёт не более прежних 60 секунд; новых попыток или расширения сценария нет.

CI на `c957e4a1ca84b69463a7d0156b962087712dfb9b` завершился в фазе
`mcp_initialize` с категорией `unknown`. Эти новые границы не устанавливают причину
того запуска и сами по себе не подтверждают успешный native Caddy proof.

### Исключение документации из фиксированного MCP fixture

Только `observability-caddy-storage/mcp_snapshot.py` задаёт `MCP_DISABLED_TOOLS` для
своего чтения двух фиксированных векторов метрик. Полное значение:
`export,flags,metric_relabel_debug,downsampling_filters_debug,retention_filters_debug,test_rules,documentation`.
Эта переменная заменяет стандартный список поставщика, поэтому первые шесть отключений
сохраняются целиком, а `documentation` добавляется седьмым. При обновлении бинарного pin
нужно заново сверить стандартные отключения в
[config v1.20.2](https://github.com/VictoriaMetrics/mcp-victoriametrics/blob/v1.20.2/cmd/mcp-victoriametrics/config/config.go).
Внешний environment не выбирает инструменты этого fixture.

По [исходному main v1.20.2](https://github.com/VictoriaMetrics/mcp-victoriametrics/blob/v1.20.2/cmd/mcp-victoriametrics/main.go)
регистрация документации предшествует `ServeStdio`. Её отключение исключает построение
встроенного поискового индекса, которое не нужно двум запросам этого fixture.
Это не настройка production MCP, общего pilot или других проверок. Поиск документации
не входит в критерий чтения фиксированных метрик; исходные два запроса, строгий decoder,
сроки 15 секунд на ответ и 60 секунд на helper, проверки свежести и отрицательные сценарии
сохраняются.

Отдельный контроль на Darwin arm64 с тем же pinned v1.20.2 дал initialize 6.89–7.70 секунды
со стандартной документацией и 54–66 миллисекунд без неё. CPU дочернего процесса за весь
жизненный цикл составил 15.94–15.98 и 0.024–0.033 секунды соответственно. Все четыре
фиксированных запроса прошли; обратный порядок сохранил разницу. Это подтверждает цену
пути документации на том Mac, но не воспроизводит Linux-таймаут 15 секунд, не доказывает
готовность стандартной production-конфигурации и не определяет мощность сервера.
