# Backend coding standards

This file is normative for backend changes and reviews. ADR 0004 owns the feature-first rationale;
ADR 0005 owns direct Prisma use in application use cases.

## Capability layout

Use feature-first vertical slices inside each capability:

```text
src/modules/<module>/
├── features/<use-case>/             # operation, contract, and optional transport adapter
├── facets/<public-facet>/            # deep interface consumed across module seams
├── domain/                           # rules shared by multiple use cases
├── infrastructure/                   # shared persistence and provider adapters
├── ports/                            # required external capabilities
├── shared/                           # helpers with at least two slice consumers
├── <module>.module.ts                # Nest composition
└── index.ts                          # public module interface
```

`features/` is navigation, not a runtime seam. Put a new standalone operation in
`features/<action-subject>/`; keep a deep multi-operation interface under `facets/`. Move code to a
horizontal folder only after multiple slices use it. Do not add empty layers or an `application/`
mirror.

Use kebab-case for files and folders, action-subject names for use cases, standard `*.controller.ts`
and `*.module.ts` suffixes, and `*.contract.ts` only for a slice-owned contract. Prefix dependency
composition with `assemble`. Avoid `Service`, `Manager`, `Helper`, and `Implementation` when a
domain or operation name is available. Reserve `create` for a product action or value construction,
not dependency wiring.

## Interfaces and Nest composition

- Export a provider token only for a current production inter-module or process consumer. Use a
  `Symbol` for exported TypeScript interfaces.
- `index.ts` exports only what code outside the Module imports, a Module imports its own files
  directly, and the Module dependency graph stays acyclic; `scripts/check-backend-architecture.mjs`
  holds all three. ADR 0029 names the three ways to invert an edge that closes a cycle.
- Keep locally consumed operations as plain functions or concrete providers. Do not create a DI
  token solely to substitute a test double.
- Register providers that add behaviour or own lifecycle; remove pass-through providers. Use the
  default singleton scope unless request-owned state proves a narrower scope.
- Controllers parse transport input, call one operation or facet, and map its result. Application
  results stay transport-neutral and use the operation's actual discriminated error union; adapter
  mapping is exhaustive.
- Public DTOs keep serializable string IDs. Boundary codecs convert them to checked domain IDs.
  `MaterialBody` acceptance, versioning, rendering, and extraction remain inside Materials. The
  description of a block — node type, fields, field rules, rendered shape, search text and headings
  — belongs to `@inside/material-blocks`; the backend builds its document schema, addressable block
  list and wire block enumeration from that registry and declares no Tiptap node of its own.
- Framework-agnostic assembly may serve tests, seeds, and non-Nest entrypoints. Nest binds real
  facets directly rather than assembling and immediately splitting an aggregate.
- Application functions receive the capability-scoped Prisma type from their infrastructure
  boundary; Oxlint and the architecture check keep Nest, `pg`, Prisma packages and the generated
  Prisma client out of them.

## Prisma, PostgreSQL, and migrations

- A use case may call its injected capability-scoped Prisma client directly. Do not wrap Prisma in
  a generic repository, Unit of Work, or pass-through persistence service.
- An operation that changes another Module's state passes its own transaction to that Module's
  function, as Save does with `requestVideoDeletion` and `markUnreferencedMaterialAssets`. The
  callee never opens a transaction of its own: a rollback must undo the whole operation, and a
  second pooled connection held under locks can exhaust the pool. For that handoff alone the
  caller's capability-scoped type lists the callee's delegates, as `MaterialsPrisma` lists the Videos
  and Assets delegates; the caller's own code reaches them only through that function, which
  `scripts/check-backend-architecture.mjs` enforces. Opening no transaction in the callee stays a
  review rule: a nested `$transaction` is also the correct shape for a standalone operation.
  Reading Activity carries `product`, `material` and `publishedMaterialProductMembership` only to
  pass its transaction to Materials. The guardrail rejects a named Prisma operation on those
  foreign delegates, including Product. It does not follow aliases or prove every indirect access;
  review still checks ownership and transaction handoff.
- An operation never awaits another pooled connection while its transaction is open: as many such
  operations as the pool has connections hold all of it and wait for each other. A read of another
  Module that the caller's locks guard takes the caller's transaction, as Save does with
  `inspectReferences`; the
  delegate handoff above applies. The transaction comes first when every caller holds one; a read
  that also serves callers without one takes it as a last optional parameter, and a caller holding
  a transaction always passes it. A read those locks do not guard moves before the transaction and
  is judged inside it, as `recordMaterialOpen` does with its access decision and `authorizeDispatch`
  with the source and recipient binding. The client of `test/integration/setup/test-database.ts`
  checks the rule: inside its own `$transaction` callback a query through the root client fails
  with `SecondConnectionInTransactionError`, and `dispose()` reports a refusal that a facade turned
  into a failed result. A process started from the database URL uses the production client and is
  not checked; its operations keep a test on the test database client.
  `known-transaction-violations.ts` beside it lists the production code that still breaks the rule,
  each entry with its issue; new code never gets an entry.
  A new operation's test needs no exhausted pool; `test/integration/setup/exhausted-pool.ts` stays
  for a test of pool exhaustion itself and for the operations whose tests already run on it.
- A test that holds a transaction on purpose and starts inside it a concurrent operation the
  transaction does not await, such as a contender for the same lock, starts that operation through
  `outsideTransaction`. Work that the transaction awaits never goes through it: that work is the
  violation the check refuses.
- Keep feature-specific data access with its slice. Extract a named private persistence operation
  only for multiple consumers or one cohesive query that becomes a deeper interface.
- Convert rows to domain values before crossing `domain/`, public contracts, or `index.ts`.
- Prefer Prisma model operations. For PostgreSQL behaviour it cannot express clearly, use
  parameterized `Prisma.sql` with `$queryRaw`/`$executeRaw`; the architecture check rejects unsafe
  variants, interpolated identifiers and unqualified tables.
- Treat raw-query results as `unknown` and validate their row shape. A TypeScript generic is not
  runtime validation.
- Prisma is the application ORM. `pg` is limited to the migration runner, the dedicated-session
  worker generation lease, the exact-schema worker health probe, isolated test database
  administration, and a test double that stands in for another application's own database, where
  no Prisma schema exists in this repository to describe it. The lease and health probe are
  process lifecycle, not capability data access.
- Checked-in migrations are append-only and self-contained: change the schema with a new
  migration. The migration runner rejects an applied ledger that is not an exact ordered prefix or
  whose checksums differ. Never edit generated Prisma client files or commit them.

## REST and authentication

- Every public endpoint declares a stable `operationId`, concrete input/success/error schemas, and
  its security scheme. A prose response description is not an OpenAPI contract.
- Name the fields of a response body one by one. A spread publishes whatever its source gains next;
  the declared schema and the DTO stay silent, because the excess property check does not apply to
  a spread, and every strict reader then drops the whole body instead of the one key it did not
  expect. That emptied the learning continuation and the buyer-state response on 2026-09-12.
  `test/support/declared-api.ts` reads live responses against the generated OpenAPI document, so
  the leak fails in the test that calls the address.
- Derive actor identity from the trusted authentication adapter. Never accept actor/account IDs,
  permissions, or Membership decisions from a request body.
- Use shared semantic cache policies. Interceptors and exception filters own wire headers and media
  types; controllers do not duplicate protocol strings.
- Build a Problem Details body with `problemException` or `problemDetails` from
  `src/infrastructure/http/problem-details.ts`; `ProblemDetailsFilter` rewrites its `type` to
  `urn:inside:problem:<code>` with the code unchanged, so a handwritten type never reaches the wire.
- Keep authentication adapters narrow. Provider-SDK compatibility code must name a demonstrated
  upstream gap and have a focused contract test.
- Follow the local
  [`IdP flow specification`](../../docs/specifications/idp-application-flow-v1.md) for Logto, BFF,
  callback, token, cookie, and logout behaviour.

## Dependency failures and logging

- A Module turns a failed dependency into a variant of its result union and records the cause
  through `src/infrastructure/observability`: `return dependencyFailure(scope, error, variant)`,
  or `reportDependencyFailure(scope, error)` where the operation carries on. The scope names the
  Module and the operation the caller invoked, not a shared helper; the record adds the unit of
  work (`requestId`) and, when the variant carries an error `code`, that code and its
  `correlationId`.
- A race resolved by an idempotency replay or an existing row is an answer, not a failure: record
  the original error only on the branch that still answers with a dependency failure.
- A `catch` that rejects foreign input rather than a dependency explains itself on its first line
  with `// Not a dependency failure: <reason>`. Prefer a non-throwing parser such as `URL.parse`
  when one exists. `scripts/check-backend-architecture.mjs` rejects a handler in `src/modules` that
  drops what it caught without that marker. A conditional rethrow satisfies the check, which cannot
  tell a race from a failure, so review keeps the replay rule above.
- Backend processes (`api`, `mcp` and the workers) log only through `writeLog` and pass errors
  through `describeError`: it keeps the type, code, stack frames and causes, drops the text of
  Prisma, driver and parser errors that restate the query or input, and redacts credentials,
  tokens and personal data from the rest. Never log a request body, headers, a request URL or a
  raw error. The notification transport keeps its observation `error` as the redacted
  `loggableFailure` string that its inbox rows also store. One-off scripts under `src/development`
  and `src/release` print to their operator.

## Tests against real infrastructure

- Fix the domain clock per case and share it across producers and consumers. Derive expiry and
  "today" from that instant. Use monotonic time for latency and polling budgets, not calendar dates.
- Apply [deterministic test contracts](../../CODING_STANDARDS.md#deterministic-test-contracts-1153).
  Each case owns its rows and double state; put compilation, migrations and large seeds in bounded
  setup hooks. Unit tests supply git/network/process doubles; process and loopback contracts name
  their real boundary and own its cleanup. Poll committed rows with the helper below.

- Poll a durable fact with `test/integration/setup/eventually.ts`; a scenario that must not depend
  on two clock readings landing in one millisecond takes `setup/distinct-clock.ts`.
- Run `rabbitmqctl` and read queue depth through `setup/broker.ts`; a one-off column of its own may
  still be parsed at the call site.
- Each test owns its isolated database and containers. Its barriers therefore read its own rows,
  never a global count another file can move.

## Enforcement

Keep Oxlint and architecture guardrails aligned with every changed boundary, including negative
fixtures. Structural refactors preserve behaviour and prove the same domain, adapter, integration,
and HTTP outcomes.
