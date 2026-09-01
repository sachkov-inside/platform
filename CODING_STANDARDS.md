# Coding standards

This file is normative for every backend change and backend code review. ADRs record why durable
decisions were made; [`apps/backend/AGENTS.md`](apps/backend/AGENTS.md) owns task routing and
verification. The architectural rationale for these rules lives in
[`ADR 0004`](docs/adr/0004-feature-first-backend-modules.md) and
[`ADR 0005`](docs/adr/0005-prisma-in-use-cases.md).

## Backend module structure

Backend code uses feature-first vertical slices inside each capability module. NestJS does not
prescribe this directory layout; it is the Platform convention for keeping one use case easy to
navigate and change.

```text
apps/backend/src/modules/<module>/
├── features/
│   └── <use-case>/
│       ├── <use-case>.ts
│       ├── <use-case>.contract.ts   # only when the contract belongs to this slice
│       └── <use-case>.controller.ts # only when this use case has an HTTP adapter
├── facets/
│   └── <public-facet>/              # deep interface used across module seams
├── domain/                          # rules shared by multiple use cases
├── infrastructure/                  # persistence and third-party adapters shared by slices
├── ports/                           # required external capabilities
├── shared/                          # application helpers with at least two slice consumers
├── <module>.module.ts               # Nest composition
└── index.ts                         # public module interface
```

Place every new operation in `features/<use-case>/`. The `features/` directory is organizational,
not another abstraction or runtime seam: callers still use the capability `index.ts`. Do not add an
`application/` directory or empty layer directories. A controller, its transport mapping, and its
operation belong to the same slice even when the controller is registered by a process entrypoint.

Move code to `domain`, `infrastructure`, `ports`, or `shared` only after multiple slices use it.
Name shared files after the behaviour they provide; `shared` is not a destination for unrelated
helpers. State-owning module infrastructure remains private and other modules import its `index.ts`
interface.

A public facet may group several related operations behind one deep interface. Put it under
`facets/`, not `features/`; its transport adapters stay under `adapters/` unless one endpoint owns a
real standalone operation that can be colocated as a vertical slice.

## Naming

- Use kebab-case for folders and files.
- Name a use-case folder with an action and subject: `create-draft`, `read-published-material`.
- Give Nest adapters the standard suffixes `*.controller.ts` and `*.module.ts`.
- Use `*.contract.ts` for a slice-owned transport/application contract. Do not use the suffix for
  an internal helper type.
- Name a function for the action it executes: `listPublishedMaterials(...)`.
- Prefix dependency-binding factories with `assemble`: `assembleMaterialAuthoring(...)`.
- Reserve `create` for a product action or value creation, not dependency wiring.
- Avoid `Service`, `Manager`, `Helper`, and `Implementation` when a domain or use-case name is
  available.

## Nest dependency injection

Nest DI belongs at process and inter-module seams:

- Export a provider token only when another production module consumes that interface.
- Use a `Symbol` token for an exported TypeScript interface because interfaces do not exist at
  runtime.
- Prefer a plain function or concrete class for a use case consumed only inside its slice. Do not
  create a token solely to replace it in a test.
- Register only providers that add behaviour or own lifecycle. Remove pass-through providers that
  merely unwrap another provider.
- Export only providers with a current external consumer.
- Keep the default singleton scope for stateless operations and shared resource pools. Introduce a
  narrower scope only for request-specific state with a documented need.
- Keep controllers thin: parse transport input, call one use case or public facet, map its result to
  HTTP, and set transport headers.

Framework-agnostic assembly may exist for seeds, tests, or non-Nest entrypoints. Nest composition
binds public facets directly instead of assembling an aggregate provider and immediately splitting
it into more tokens.

## Module interfaces and imports

Each capability exposes one deliberate interface through `index.ts`. Cross-module callers import
that interface rather than domain, persistence, or slice internals. Internal slices may import the
owning module's domain and infrastructure directly; application functions must not import Nest,
`pg`, Prisma packages, or the generated Prisma client. They receive the capability-scoped Prisma
client type from `infrastructure/prisma`. Oxlint enforces these framework and persistence rules.

Keep a seam when behaviour really varies or when it is the stable interface between capability
modules. One production implementation with no module consumer is not enough reason for an
interface-token-factory chain.

## Prisma and PostgreSQL

- A use case may call its injected, capability-scoped Prisma client directly. Do not add a generic
  repository, Unit of Work, or pass-through persistence service around Prisma.
- Keep feature-specific reads and writes in the vertical slice that owns the behaviour. Extract a
  named persistence function only when at least two slices share the same non-trivial operation or
  when one cohesive query is clearer as a deep private module.
- Keep Prisma out of `domain/`, public contracts, and module `index.ts` exports. Convert database
  rows to domain values before they cross those boundaries.
- Prefer Prisma model operations for ordinary reads and writes. Use parameterized `Prisma.sql`
  with `$queryRaw` or `$executeRaw` for PostgreSQL behaviour Prisma cannot express clearly, such as
  row locks, tuple cursors, and aggregate projections.
- Never use `$queryRawUnsafe`, `$executeRawUnsafe`, interpolated identifiers, or unqualified table
  names. Raw SQL stays inside the owning capability schema.
- `prisma/schema.prisma` maps the checked-in SQL migration authority. Regenerate the ignored client
  during install, build, and typecheck; never edit generated client files.
- Prisma is the only application ORM. Do not introduce Kysely, another ORM, a generic repository,
  or a parallel persistence lifecycle. The `pg` package is reserved for the central migration
  runner and isolated test-database administration.
- Treat every raw-query result as `unknown` and validate its exact row shape before use. A generic
  argument such as `$queryRaw<Row[]>` is only a TypeScript assertion and is not runtime validation.
- Checked-in migrations are append-only. The applied ledger must be an exact ordered prefix of the
  running registry and every checksum must match. Add a new migration for every schema/index change
  instead of modifying a migration that may already have run.

## Enforcement

Oxlint and the backend architecture guardrails enforce framework, persistence, and module-boundary
rules. Keep the positive repository scan and its negative fixtures aligned whenever a boundary
changes. Follow the verification matrix in `apps/backend/AGENTS.md` for each backend handoff.

Structural refactors preserve behaviour: update import paths and composition tests, then prove the
same unit, adapter, integration, and HTTP outcomes before changing product behaviour.

## REST API contracts

- Every public Nest endpoint has one stable `operationId`, explicit path/query/header/body schemas,
  concrete success and error response schemas, and the applicable security scheme. A description
  without a schema is not a consumable OpenAPI contract.
- Controllers derive actor identity from the trusted authentication adapter. Never accept an
  `actor`, Principal ID, permission or Membership decision from a request body.
- Express cache intent with the shared semantic cache-policy decorators. Controllers do not write
  `Cache-Control` values or success/error media types directly; the API interceptor and exception
  filters own those protocol details.

## Nest-Web transport seam

- Nest owns the HTTP wire contract. Commit the deterministic schema and generated Web transport
  types, and run `pnpm api:generate` after changing an operation. `pnpm api:check` is the drift
  fitness function used by CI.
- `apps/web/src/shared/config` owns server-only runtime environment parsing and validation,
  including the backend URL. `apps/web/src/shared/api/backend` owns direct Nest requests, the
  generated client, its local HTTP adapter and request timeouts, and consumes the typed runtime
  config. Other application code imports these modules' interfaces; it does not read application
  environment variables, duplicate Nest URLs, or import the codegen runtime or generated artifacts
  directly.
- Treat generated response types as compile-time guidance, not runtime proof. Feature adapters keep
  external response bodies as `unknown`, validate focused wire schemas with Zod, and then map known
  Problem Details into feature outcomes and success bodies into presentation models.
- React Server Components may call Nest directly through the server-only transport. Browser code
  calls same-origin, feature-owned Next BFF routes. Do not add a universal proxy, generated TanStack
  hooks, generated Zod schemas or generated UI models without a concrete consumer and a new owner
  decision.
- Interactive Web writes use TanStack `useMutation`, a browser adapter and a capability-owned Route
  Handler. The shared BFF helper owns Origin, session, private no-store and the 2 MiB transport
  boundary; the feature owns input parsing and outcome mapping. Server Actions are outside the
  current mutation contract; ADR 0012 owns that trade-off.
- Each server-state surface has one runtime cache owner. A browser-owned live or infinite surface
  renders only its shell in RSC and does not prefetch or dehydrate the same query. A surface that
  requires server-rendered initial results uses request-isolated TanStack prefetch and hydration as
  one coherent path.
- `pnpm --filter @inside/web guardrails` owns environment ownership, browser bypass, FSD direction,
  Server Action and lightweight authoring bundle fitness functions, including negative fixtures.
  Focused Web tests own runtime config validation, transport error mapping and the selected TanStack
  client or hydration behaviour.
- Keep editor and explicit CLI checks on a committed TypeScript project that excludes stale
  `.next/dev` artifacts. Next route generation uses its managed project and the project-local
  TypeScript 7 CLI; do not re-enable the removed JavaScript compiler API checker.

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
