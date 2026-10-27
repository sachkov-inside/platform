# Event-time query guard (#1566)

This private read-only process is a mandatory boundary behind vmauth, before the pinned metrics and
Jaeger stores. It owns no credentials, ingestion routes, arbitrary upstream URLs, storage or public
port. Production entrypoint uses only fixed Docker service origins. vmauth still authenticates each
human/agent key and owns the finite external route map. Logs use their separate mandatory native
`extra_filters=_time:14d` enforcement.

Metrics use official `metricsql v0.87.5`, identical to VM `v1.154.0`'s module pin. The parser expands
WITH. A checked-in Inside security patch adds mandatory `ParseBounded`; it is not upstream
behavior. Acquisition verifies the exact upstream parser and patch digests before patching a finite private copy of that checksum-verified module. A temporary
`-modfile` supplies one fixed local replacement; the copied module and build caches are removed. Both query and selector paths require that symbol, so an unpatched build fails.
The official lexer admits at most64KiB/4,096 tokens/64 delimiter levels before recursive parsing.
A per-call budget then stops expansion before allocation at4,096 work units,128 recursive levels
and1MiB cumulative charged copies (strings, scopes, arguments and label-template merges).
A separate bounded tree check precedes the vendor cleanup/constant/function passes. These are
admission limits, not a measured RSS claim. Ordinary WITH expressions and vendor default macros
remain supported; inputs exceeding the budget are refused with a closed error. The retention
proof visits every resulting expression. A conservative lower bound covers raw rollup
lookbehind, explicit windows/offsets, implicit and explicit subqueries, and alignment. Dynamic @
expressions whose evaluation time cannot be proven are refused. Literal @, start()/end(), fixed
historical evaluation time, timestamp_with_name and keep_metric_names remain supported. Requests
whose earliest possible raw sample can cross the current90-day horizon are refused, never rewritten
into sampled subqueries or partial aggregates. Error responses are closed and contain no input.

The proof is tied to pinned VM evaluator semantics: raw fetch begins at E-max(window,step), with
up to5m silence history; subqueries extend start by window+step+5m before step alignment. Every
function conservatively receives additional alignment/history margin. Both lookback options are
fixed to300s; nocache1 prevents pre-expiry result reuse and range-cache time alignment. Query evaluation time is frozen from one clock reading. After the bounded upstream read, the
raw-window proof is repeated against one final response-clock cutoff. A query that became unsafe
in flight is refused as a whole. There is no artificial10-second reduction of the retention window.
Conservative evaluator lookbehind can refuse an otherwise valid query near the90-day boundary;
it cannot return an apparently complete aggregate with hidden expired contributions.

Native labels/series indexes are coarse and metadata descriptors have no row time. Discovery
therefore enumerates bounded exact-window tlast_over_time raw selectors, preserving original
metric/label names; it refuses overflow beyond10,000 series rather than silently truncating the
prerequisite set. Caller limit applies only after that complete bounded set is known. Metadata
remains a timeless type/help/unit descriptor but is emitted only for families proven present in
that raw sample horizon. Upstream index name membership never establishes retention compliance.

Jaeger list start/end and dependency lookback are clamped before any aggregation request. Trace
lists and byID responses additionally remove each span whose startTime is before the14-day lower
bound. This matters for mixed-age traces: native VT can return an expired span beside a retained
span. Empty traces and process entries used only by removed spans are excluded. Remaining span
facts are unchanged. Totals/warnings are recomputed/projected for the returned trace collection;
this is a windowed trace view, not proof that a trace is complete. Service/operation discovery uses
the pinned native3-day stream-field window; caller overrides are refused.

All requests have a64KiB form budget,16KiB header budget, two in-flight queries,8MiB upstream JSON
response cap and8s deadline. Raw discovery timestamps and returned span start times are checked
against the final response-clock horizon; dependency aggregates that became unsafe in flight are
refused as a whole. Only GET and read POST forms are accepted; duplicate singleton
parameters across URL/body are refused. No raw request, response, query or vendor error is logged.

Pinned source evidence:

- [VM module/parser pin](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/v1.154.0/go.mod).
- [VM raw/subquery evaluation](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/v1.154.0/app/vmselect/promql/eval.go).
- [VM rollup window semantics](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/v1.154.0/app/vmselect/promql/rollup.go).
- [VT query and discovery](https://github.com/VictoriaMetrics/VictoriaTraces/blob/v0.12.0/app/vtselect/traces/query/query.go).
- [VT Jaeger parameter units](https://github.com/VictoriaMetrics/VictoriaTraces/blob/v0.12.0/app/vtselect/traces/jaeger/jaeger.go).

Runtime composition, source-bound acquisition, native vendor proof and resource measurement are
required separately; module tests alone do not establish deployment readiness or capacity.
