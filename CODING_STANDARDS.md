# Coding Standards

These rules capture recurring review findings that are specific to Platform. Keep a finding here
only when it generalizes beyond one diff. Prefer an executable constraint—a type, schema, test,
linter, guardrail, or CI check—when one can enforce the rule reliably.

## Validation owns external shapes

- Treat cookie payloads, HTTP responses, token claims, persisted JSON, and other boundary values as
  `unknown` until the owning adapter validates them.
- Reuse the repository's schema library and built-in formats such as `z.uuid()` and
  `z.iso.datetime()` instead of maintaining handwritten format regular expressions.
- When a schema owns a wire shape, infer its TypeScript type from that schema. Keep a separate
  domain type only when it adds domain meaning that the wire schema cannot express.

## Name time in domain units

- Name protocol, token, cookie, retry, and session lifetimes at the owning module boundary.
- Keep unit conversion and expiry calculation inside the owning factory or a small named helper.
  Call sites should express the policy name, not arithmetic such as minutes multiplied into
  milliseconds.

## Keep authentication adapters narrow

- Follow [`docs/specifications/idp-application-flow-v1.md`](docs/specifications/idp-application-flow-v1.md)
  when changing Logto, BFF, callback, token, cookie, or logout behaviour.
- Compatibility code around the official provider SDK must address a demonstrated upstream gap,
  name that gap in a local comment, and have a focused contract test.

## Preserve layout during transient interaction

- Hover, focus, loading, and hydration transitions should preserve the footprint of surrounding
  content. Use a definite reserved size or an overlay when a transient surface expands.
- Treat an explicit user action such as pinning or resizing as the boundary where changing sibling
  layout is allowed.
- Lock down interaction-driven layout regressions with geometry assertions or the Layout Shift API
  when visual snapshots cannot prove stability.

## Poll live HTTP state from one response

- When polling an endpoint expected to become successful, capture one successful `curl --fail`
  response and inspect that captured body. Network and HTTP failures continue polling until the
  deadline.
- When a non-success HTTP status is an expected state, capture the status and body from the same
  request and compare them with the explicitly accepted states.
- Keep readiness, expected-state, and restored-state checks explicit. A polling success must prove
  the live response, not only that a process exists or a file was copied.
