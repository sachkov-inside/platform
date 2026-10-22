---
status: accepted
---

# One definition per same-origin browser mutation

The owner decided on 2026-10-22 (#1679) that each same-origin browser mutation has one operation
definition. This amends [ADR 0012](0012-browser-owned-interactive-mutations.md): its browser-owned
path, named operations and literal routes remain; its rule that each feature owns form parsing is
replaced.

Before this decision one mutation crossed five handwritten places: a browser adapter that encoded
FormData and repeated the route, the route file, a handler that decoded the same fields again, the
server wrapper of the generated client and the generated Service. The contract appeared three times
plus its form encoding, so one new boolean in #1619 needed five Web edits.

`defineMutationOperation` in the owning slice's `*.operation.ts` module now declares the literal
`path` and `method`, the `input` schema of the JSON body, the `result` schema and the outcome for a
failed request or a malformed answer. Both sides derive from that definition:

- The browser adapter is the definition's `send`. It sends the fields the input schema declares as
  JSON to the literal route and validates the answer with the result schema. A `useMutation` calls
  it as its mutation function.
- The Route Handler serves the definition with `handleMutationOperation`. The shared boundary still
  owns Origin, the body limit, the session, private no-store and catalog expiry. It parses the body
  with the same input schema and then calls the feature's `execute`, which calls Nest and maps its
  answer to the result. The feature names the outcome for input outside the schema.

An operation a guest may also send, such as a video playback session or a waitlist intent, is
served by `handleOptionalMutationOperation`: the same Origin, body-size and input boundary, an
optional session, and an answer whose status the feature chooses. Its result schema is therefore
held by the feature's tests rather than by the compiler.

Operations remain named and their routes literal. There is no generic dispatcher, universal proxy
or `operation`/`mode` selector, and the backend keeps authorization, idempotency, concurrency and
domain invariants.

JSON replaces FormData because one schema can then describe the request on both sides. A JSON
request from another site also needs a CORS preflight, which a form post does not; the Origin
check remains the boundary. The definition module is shared by browser and server, so its schemas
reach the browser bundle. Checks that need server-only data stay in `execute`.

Binary uploads keep their streaming handler with a named limit, delivery reports keep
`sendBeacon`, and native authentication forms remain ordinary HTTP forms; none of them is a JSON
operation body.

`scripts/check-web-architecture.mjs` holds the rule. An operation lives in a `*.operation.ts`
module with a literal `/api/` path and method, and its route file exports that method. Modules
awaiting migration are listed with their number of FormData helper calls; a count may only fall,
so a new FormData mutation fails even inside a listed module. In browser code a `fetch` whose
literal init names a write method is allowed only in the upload and report modules and in the two
shared adapters that send operations and the remaining form mutations. The check reads syntax: a
write through an `init` held in a variable, `globalThis.fetch`, or a handler that reads
`request.formData()` itself remains a review question.
