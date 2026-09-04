# Workshop wire contracts

This directory is the canonical source for the public Workshop JSON contracts. Schema identifiers
and Case/evaluator versions are opaque exact values; consumers must not apply SemVer compatibility
rules.

| Contract | Schema |
|---|---|
| Published case snapshot | `inside.workshop.case-spec.v1.schema.json` |
| Assignment repository manifest | `inside.workshop.assignment-manifest.v1.schema.json` |
| Local evaluator report | `inside.workshop.evaluation-report.v1.schema.json` |
| Independently captured source evidence | `inside.workshop.source-snapshot.v1.schema.json` |
| Device authorization request | `inside.workshop.evaluator-device-authorization-request.v1.schema.json` |
| Device authorization response | `inside.workshop.evaluator-device-authorization-response.v1.schema.json` |
| Device token request | `inside.workshop.evaluator-device-token-request.v1.schema.json` |
| Device token response | `inside.workshop.evaluator-device-token-response.v1.schema.json` |
| Report acceptance response | `inside.workshop.evaluator-report-acceptance.v1.schema.json` |

All contracts reference canonical scalar definitions from
`inside.workshop.primitives.v1.schema.json`; it is a supporting schema, not a wire document.

`conformance/index.json` is the shared positive/negative corpus. The backend TypeScript test and
the Go evaluator load those same files and must agree on every result and diagnostic code.

Run the complete contract checks from the repository root:

```bash
pnpm workshop:contracts:check
```

The schemas also own contract byte limits through `x-inside-byte-limits`; TypeScript and Go read
those annotations instead of copying the values. The Go binary embeds generated copies of the
schemas and schema-inferred wire types. Regenerate them after a schema change:

Device authorization binds the checked-out manifest through `inside.workshop.canonical-json.v1`:
parse and validate the manifest, recursively sort object property names, preserve array order,
encode integers in base 10 and emit compact UTF-8 JSON using Go `encoding/json` string escaping,
then compute lowercase SHA-256. Insignificant whitespace and checkout line endings therefore do
not affect the binding.

```bash
pnpm workshop:evaluator:generate
```

Generated copies are verified for drift by the normal repository check.
