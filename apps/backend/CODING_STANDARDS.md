# Backend coding standards

This file is normative for backend changes and reviews. ADR 0004 owns the feature-first rationale;
ADR 0005 owns direct Prisma use in application use cases; the nearest `AGENTS.md` owns verification.

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
mirror. State-owning infrastructure stays private and cross-module callers import `index.ts`.

Use kebab-case for files and folders, action-subject names for use cases, standard `*.controller.ts`
and `*.module.ts` suffixes, and `*.contract.ts` only for a slice-owned contract. Prefix dependency
composition with `assemble`. Avoid `Service`, `Manager`, `Helper`, and `Implementation` when a
domain or operation name is available. Reserve `create` for a product action or value construction,
not dependency wiring.

## Interfaces and Nest composition

- Export a provider token only for a current production inter-module or process consumer. Use a
  `Symbol` for exported TypeScript interfaces.
- Keep locally consumed operations as plain functions or concrete providers. Do not create a DI
  token solely to substitute a test double.
- Register providers that add behaviour or own lifecycle; remove pass-through providers. Use the
  default singleton scope unless request-owned state proves a narrower scope.
- Controllers parse transport input, call one operation or facet, and map its result. Application
  results stay transport-neutral and use the operation's actual discriminated error union; adapter
  mapping is exhaustive.
- Public DTOs keep serializable string IDs. Boundary codecs convert them to checked domain IDs.
  `MaterialBody` validation, versioning, rendering, and extraction remain inside Materials until an
  independent caller proves another seam.
- Framework-agnostic assembly may serve tests, seeds, and non-Nest entrypoints. Nest binds real
  facets directly rather than assembling and immediately splitting an aggregate.
- Application functions do not import Nest, `pg`, Prisma packages, or the generated Prisma client.
  They receive the capability-scoped Prisma type from their infrastructure boundary.

## Prisma, PostgreSQL, and migrations

- A use case may call its injected capability-scoped Prisma client directly. Do not wrap Prisma in
  a generic repository, Unit of Work, or pass-through persistence service.
- Keep feature-specific data access with its slice. Extract a named private persistence operation
  only for multiple consumers or one cohesive query that becomes a deeper interface.
- Convert rows to domain values before crossing `domain/`, public contracts, or `index.ts`.
- Prefer Prisma model operations. For PostgreSQL behaviour it cannot express clearly, use
  parameterized `Prisma.sql` with `$queryRaw`/`$executeRaw`; never use unsafe variants,
  interpolated identifiers, or unqualified tables.
- Treat raw-query results as `unknown` and validate their row shape. A TypeScript generic is not
  runtime validation.
- Prisma is the application ORM. `pg` is limited to the migration runner and isolated test database
  administration.
- Checked-in migrations are append-only and self-contained. The applied ledger is an exact ordered
  prefix and checksums must match. Change the schema with a new migration; never edit generated
  Prisma client files or commit them.

## REST and authentication

- Every public endpoint declares a stable `operationId`, concrete input/success/error schemas, and
  its security scheme. A prose response description is not an OpenAPI contract.
- Derive actor identity from the trusted authentication adapter. Never accept actor/account IDs,
  permissions, or Membership decisions from a request body.
- Use shared semantic cache policies. Interceptors and exception filters own wire headers and media
  types; controllers do not duplicate protocol strings.
- Keep authentication adapters narrow. Provider-SDK compatibility code must name a demonstrated
  upstream gap and have a focused contract test.
- Follow the local
  [`IdP flow specification`](../../docs/specifications/idp-application-flow-v1.md) for Logto, BFF,
  callback, token, cookie, and logout behaviour.

## Enforcement

Keep Oxlint and architecture guardrails aligned with every changed boundary, including negative
fixtures. Structural refactors preserve behaviour and prove the same domain, adapter, integration,
and HTTP outcomes. Run the matrix in `AGENTS.md` before handoff.
