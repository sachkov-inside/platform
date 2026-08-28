---
status: accepted
---

# Generate the Web transport contract from Nest OpenAPI

Nest owns Platform's HTTP wire contract. The repository commits a deterministic OpenAPI document
and generates an immutable TypeScript client from it. Web keeps that client and its local HTTP
adapter behind the local `src/shared/api/backend` module; feature adapters receive response
bodies as `unknown`, validate the external JSON with focused Zod schemas, and map it into their own
presentation models and known UI outcomes.

This keeps URL, parameter, success and Problem Details types synchronized without letting generated
code own feature policy. `openapi-typescript-codegen` is used because its template generator does
not load the removed TypeScript compiler API and the generated client compiles under TypeScript 7.
TanStack Query options, hooks, Zod schemas and UI models therefore remain
handwritten. Generating those layers would enlarge the transport interface and couple product
behaviour to the generator. Keeping all requests handwritten was rejected because it duplicated the
same wire facts in Nest and Web and could drift without failing CI.

React Server Components call the private Nest address directly through this server-only transport.
Browser continuations call a same-origin, feature-owned Next Route Handler; they never receive the
Nest address. A universal proxy remains deferred until several real one-to-one authoring operations
need the same policy. API versioning is likewise deferred while Web and Nest ship atomically and no
external consumer exists.

Nest endpoints declare cache intent through named policies: public catalog responses may be cached,
published Material responses select public or private policy from their validated result, and
Account/health plus every error use `private, no-store`. Interceptors and exception filters own the
wire headers so feature controllers do not duplicate protocol strings.

`pnpm api:check` is the contract drift fitness function. Web transport guardrails keep the codegen
runtime, generated types and manual Nest operation paths inside their owning module. The negative
fixture proves that a plain helper reachable from a `"use client"` entry cannot import the transport,
read a public Nest address or issue an absolute backend request. Focused adapter tests remain
responsible for runtime validation, Problem Details mapping and SSR hydration behaviour.
