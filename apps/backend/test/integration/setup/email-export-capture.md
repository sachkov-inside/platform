# Email runtime test capture contract

This fixture replaces the first-32-requests observation buffer with an exact-byte multiset.
It changes test evidence capture, not the SDK, product delivery, retries, exporters or deadlines.
The previous `ab68ee47` sustained-503 attempt remains evidence of the old fixture overflowing:
32 retained bodies, six quota refusals, zero retained worker metric bodies.

## Retention and equality

The capture retains at most 32 distinct bodies, each at most 1 MiB, plus an exact multiplicity
of at most six for each. The pinned OTLP exporter makes an initial send and at most five retries
of the same serialized bytes. A deadline can stop retries earlier; six is an upper bound, not
an assumed measured result. The total request ceiling is 192 (32 times six).

A request uses one fixed 1 MiB assembly buffer, not an unbounded array of chunks. At completion,
fatal UTF-8 decoding preserves BOM codepoints (`ignoreBOM: true`). Re-encoding must equal the
original bytes exactly. Only that validated decoded string is retained. Equality of these strings
is equivalent to byte equality because each has an exact inverse UTF-8 roundtrip. No JSON
normalization, Unicode normalization or hash-only match determines equality. A leading BOM is
preserved and rejected as malformed JSON, never stripped to merge two different byte sequences.
JSON parsing validates the signal envelope only; it never replaces the evidence string.

No distinct body is sampled away. Every retained body passes the original full native identity,
privacy, SQL/email attribute and causal assertions. Repeated requests have the same bytes by the
equality contract, and their exact multiplicities remain evidence. Existing trace retry assertions
still require more than one native attempt and now read that explicit multiplicity. Diagnostic
signal/service counts are weighted by multiplicity, not counts of normalized bodies.

## In-flight and transport bounds

At most one API SDK and one worker SDK are live in each serial scenario. Each has separate trace
and metric exporters with `concurrencyLimit: 1`. The pinned HTTP retry transport waits for response
completion before issuing its next attempt. This gives four admitted body assemblies and at most
4 MiB of owned assembly buffers. Each completion has bounded decode/roundtrip temporaries (at most
2 MiB of string code units and 1 MiB of roundtrip bytes). Completed request buffers are released;
raw and decoded copies are not retained together. Parsed JSON is temporary and body-size bounded.

Keep-alive agents can retain idle sockets, so four body assemblies do not mean four TCP sockets.
The fixture separately caps connections at 192, derived from its total request ceiling. Saturation
is an explicit test failure. HTTP headers retain Node's pinned 16 KiB default ceiling, and stream
high-water marks are explicitly 16 KiB. A high-water mark is backpressure, not a hard process RSS
quota; these bounds do not claim a measured total including framework, garbage collector or OS
buffers. All sockets belong to the disposable collector and are closed through existing cleanup.

## Accounting and refusal

Independent HTTP observers count request starts and finished responses by fixed signal category.
The capture ledger reconciles starts with accepted completions, refusals and aborts; accepted
completions must equal the sum of retained multiplicities for each signal. Final assertions also
require finished-response counts to match request counts. All completed responses in the failure
scenario remain 503 with the original past `Retry-After`; there is no recovery-to-200 phase.

The test fails explicitly on an oversized body, a 33rd unique body, a seventh identical body,
a 193rd request, a fifth in-flight assembly, socket saturation, an unknown route, malformed JSON
or UTF-8, roundtrip mismatch, double completion, incomplete/aborted requests, HTTP errors, unfinished
responses or any accounting mismatch. Refusals never count as successful retained evidence.

Diagnostics contain only fixed signal names, numeric counts, multiplicities and closed violation
codes. They contain no payload, URL, header, exception text, resource identity or provider reply.
The existing private-wire corpus stays in memory and is never written to proof files. Any future
external diagnostic parser must validate this new closed shape before retaining its counters.

## Evidence status

Host unit tests exercise the capture boundary, including byte differences, late sentinels, quota
races, UTF-8/BOM handling and refusal accounting. They do not prove the full HTTP/PG/Rabbit/SMTP
scenarios. This contract requires actual classification and independent Standards, Spec and targeted
Security review before a new coordinator-owned runtime lease. Earlier whole-scenario outcomes are
retained with their original source and capture semantics.
