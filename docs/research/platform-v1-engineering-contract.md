# Platform v1 engineering contract research

Статус: исторический snapshot, repository-owned evidence, comparison и rationale для canonical
[Platform v1 application specification](../specifications/platform-v1.md) и
[Platform #27](https://github.com/sachkov-inside/platform/issues/27), 2026-08-22.

> Этот документ сохраняет исходное сравнение Kysely/revision-based вариантов и не является
> текущим implementation contract. Текущие backend и Materials решения задают
> [ADR 0004](../adr/0004-feature-first-backend-modules.md),
> [ADR 0005](../adr/0005-prisma-in-use-cases.md),
> [ADR 0009](../adr/0009-one-mutable-material.md) и canonical specification выше.

Документ отделяет repository-owned decisions от проверенных ограничений выбранного stack и
фиксирует согласованные frontend organization, backend module/interface seams, validation, write
flow, errors, concurrency, transactions, DI, tests и будущие local guardrails. Владелец принял
решения отдельным [issue comment](https://github.com/sachkov-inside/platform/issues/27#issuecomment-5378336463).
Canonical implementation decisions принадлежат application specification; этот artifact не
создаёт параллельный contract. Это не ADR и не разрешение менять production code, harness, lint
или architecture checks в #27.

## 1. Authority, результат и граница исследования

### Repository-owned authority

- [MVP brief](../product/platform-mvp-brief.md) владеет product scope: Platform является canonical
  home Materials; admin и MCP используют один application interface и одни domain rules; autonomous
  publish запрещён.
- [Platform v1 application specification](../specifications/platform-v1.md) уже выбирает
  production baseline и задаёт capability names, logical invariants, process responsibilities, NFR и
  порядок foundations. #27 не переоткрывает technology comparison.
- [`CONTEXT.md`](../../CONTEXT.md) владеет терминами `Material`, `MaterialRevision`, `Topic`,
  `Format`, `Tag`, `Series`, `Principal`, `MembershipEvidence`, `MembershipEntitlement` и
  `ReadingState`.
- [ADR 0001](../adr/0001-one-backend-multiple-entrypoints.md) уже принят: один NestJS backend
  codebase имеет thin `api`, `worker` и `mcp` entrypoints поверх общих application modules.
- [Platform #30](https://github.com/sachkov-inside/platform/issues/30) — Stage 1: create/load/revise
  draft через PostgreSQL/Kysely и versioned ProseMirror/Tiptap document path.
- [Platform #31](https://github.com/sachkov-inside/platform/issues/31) — Stage 2:
  validate/preview/publish/read, safe renderer и atomic projections.

### Уже подтверждённые constraints, которые #27 не должен менять

1. Backend остаётся modular monolith; FSD не переносится на backend.
2. `api`, `worker` и `mcp` являются transport/process adapters, а не параллельными write paths.
3. Application use case владеет transaction.
4. `ContentAuthoring` и `ContentSchema` являются отдельными capabilities с малыми interfaces;
   transport не владеет business rules.
5. PostgreSQL constraints, migrations, transactions и FTS доказываются на real PostgreSQL, не
   fake repository.
6. Material revisions immutable; stale `baseRevisionId` даёт conflict, а last-write-wins запрещён.
7. Versioned ProseMirror JSON — canonical document; Tiptap — adapter, а renderer — отдельная
   exhaustive safe server concern.
8. Durable job/outbox появляется только вместе с первым реальным consumer.
9. Separate deployable возникает только при доказанной operational/domain seam, а не из-за
   размера folder или предположения о будущем.

### Implementation details, которые #27 намеренно не выдумывает

- exact dependency versions для ещё не установленных packages, runtime-schema implementation,
  конкретный SQL/constraint names, Testcontainers isolation mechanics и lint exceptions;
- выбор версий ещё не добавленных Stage 1–2 dependencies;
- ADR, production code, migration, dependency installation, lint/architecture rule или harness
  change;
- identity, Telegram application, Kinescope implementation, UI design и release infrastructure.

## 2. Exact checkout context

Exact versions ниже взяты из committed [`.node-version`](../../.node-version),
[`package.json`](../../package.json), app manifests, [`pnpm-lock.yaml`](../../pnpm-lock.yaml) и
[`compose.yaml`](../../compose.yaml), а не из floating documentation examples.

| Concern | Exact checkout state | Lock status | Evidence consequence |
|---|---:|---|---|
| Node.js | `24.19.0` | pinned in `.node-version` | Node 24 remains LTS; Node recommends production use of Active/Maintenance LTS releases ([release schedule](https://nodejs.org/en/about/previous-releases)). |
| pnpm | `11.22.0` | pinned by root `packageManager` | `pnpm install --frozen-lockfile` must fail rather than rewrite an out-of-sync lockfile ([pnpm install](https://pnpm.io/cli/install#--frozen-lockfile)). |
| TypeScript | `6.0.3` | direct, exact | Both apps explicitly use `strict`; backend additionally uses `noUncheckedIndexedAccess`. TS types are erased at runtime, so transport/document input still needs runtime validation ([TypeScript erased types](https://www.typescriptlang.org/docs/handbook/typescript-from-scratch#erased-types)). |
| Next.js | `16.3.1` | direct, exact | App Router is the selected web runtime; Next 16 requires Node `>=20.9.0`, satisfied by the declared Node pin ([Next 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16#nodejs-runtime-and-browser-support)). |
| React / React DOM | `19.2.8` / `19.2.8` | direct, exact | React recommends pinning a specific React version for framework RSC integrations because underlying bundler APIs do not follow React semver ([React Server Components](https://react.dev/reference/rsc/server-components)). The checkout does so. |
| NestJS common/core | `11.2.1` / `11.2.1` | direct, exact | Nest 11 requires Node 20+ and supports Fastify 5 ([Nest 11 migration guide](https://docs.nestjs.com/migration-guide)). |
| Nest Fastify adapter | `11.2.1` | direct, exact | Current `api` entrypoint explicitly constructs `FastifyAdapter`; the adapter is the HTTP platform seam, not an application interface. |
| Nest Swagger | `11.4.7` | direct, exact | OpenAPI generation is already in the `api` entrypoint. It does not itself select runtime/domain validation. |
| Fastify | `5.12.1` | direct, exact | Fastify 5 requires Node 20+ and full JSON Schema for request/response schemas when its default schema path is used ([Fastify v5 migration](https://fastify.dev/docs/v5.0.x/Guides/Migration-Guide-V5/)). |
| `pg` / `@types/pg` | `8.23.0` / `8.23.1` | direct, exact | Already used by readiness. A transaction must use one checked-out client, not `pool.query` calls ([node-postgres transactions](https://node-postgres.com/features/transactions)). |
| `pg-boss` | `12.27.0` | direct, exact | Present for worker lifecycle only; ADR 0001 says product jobs are absent until a real job exists. |
| PostgreSQL | image tag `postgres:18.4-alpine` | exact version tag, no digest | This is the real local database target. The tag is version-pinned but not content-addressed by digest; image digest policy is outside #27. |
| Vitest | `4.1.11` | direct, exact | Vitest 4 requires Node 20+ and Vite 6+; the lock resolves Vite `8.2.2`, compatible with the declared Node pin ([Vitest 4 migration](https://vitest.dev/guide/migration#prerequisites)). |
| Kysely | **absent** | not in manifest or lock | Specification selects Kysely, but no exact version exists in this checkout. Version/peer/runtime compatibility must be verified in the Stage 1 implementation PR, not invented here. |
| ProseMirror packages | **absent** | not in manifest or lock | The canonical JSON model is selected, but the exact package set/version must be verified in the Stage 1 implementation PR. |
| Tiptap packages | **absent** | not in manifest or lock | The exact `@tiptap/core`/`@tiptap/pm`/extension set is not yet selected or locked. UI-only `@tiptap/react` is not automatically required by the headless Stage 1 adapter. |
| Runtime validation library | **no direct dependency** | not selected | Fastify brings AJV transitively (`ajv@8.20.0` through `@fastify/ajv-compiler@4.0.6`), but application code must not import an undeclared transitive dependency. One explicit validation-seam/schema path remains to be selected. |
| DB type generator | **absent** | not selected | Kysely requires a database type and recommends generated definitions for production; generators are third-party integrations ([Kysely generating types](https://www.kysely.dev/docs/generating-types)). The Stage 1 implementation brief must select a deterministic tool and the same PR must verify it. |
| PostgreSQL test harness | Compose only | no test-specific dependency | A real database is available via Compose, but schema isolation, cleanup and test parallelism are not yet contracted. |
| Testcontainers for Node | **absent** | not in manifest or lock | `@testcontainers/postgresql` is only a proposed test dependency; any adopted version must be selected and locked explicitly. The proposed container image remains the checkout's `postgres:18.4-alpine`. |

The base evidence shell exposed Node `v22.23.1` without a `pnpm` shim. Final verification used
`fnm` plus a temporary Corepack shim and ran the literal `pnpm check` successfully under the
declared Node `24.19.0` and pnpm `11.22.0`; no repository toolchain file was changed.

## 3. Current implementation facts

- [`apps/web/app`](../../apps/web/app/page.tsx) currently contains
  [`layout.tsx`](../../apps/web/app/layout.tsx), [`page.tsx`](../../apps/web/app/page.tsx),
  [`globals.css`](../../apps/web/app/globals.css) and [`icon.svg`](../../apps/web/app/icon.svg). There is no
  feature organization to migrate and therefore no measured reuse/coupling evidence that requires
  full FSD now.
- `apps/backend/src/entrypoints` already separates
  [`api`](../../apps/backend/src/entrypoints/api.ts),
  [`worker`](../../apps/backend/src/entrypoints/worker.ts) and
  [`mcp`](../../apps/backend/src/entrypoints/mcp.ts) bootstraps. `api` imports
  `ReadinessModule`; worker/MCP create `RuntimeModule`; no application capability is duplicated.
- [`ReadinessModule`](../../apps/backend/src/modules/readiness/readiness.module.ts) is a useful local precedent: it owns a small [`DatabaseProbe`](../../apps/backend/src/modules/readiness/database-probe.ts) interface, exports
  only `ReadinessService`, binds the port through a `Symbol`, and gives `PostgresProbe` shutdown
  ownership.
- Current focused test seams are deliberate and distinct:
  [`readiness.service.test.ts`](../../apps/backend/test/readiness.service.test.ts) substitutes the
  actual `DatabaseProbe` external seam, while
  [`health.smoke.test.ts`](../../apps/backend/test/health.smoke.test.ts) boots the Fastify adapter
  and reaches real PostgreSQL. This does not yet prove migrations, constraints or transactions.
- No production content module, migration runner, generated DB type, document schema, validation
  error, transaction abstraction or application test adapter exists yet.

## 4. Frontend evidence: App Router/RSC owns the runtime topology

### Framework constraints

1. App Router is file-system based and uses Server Components, Suspense and Server Functions
   ([Next App Router](https://nextjs.org/docs/app)). Its special `page`, `layout`, `loading`,
   `error`, `not-found` and `route` files are runtime entrypoints, not ordinary architecture layer
   names.
2. Layouts and pages are Server Components by default. Client Components are needed for state,
   event handlers, effects and browser APIs
   ([Next server/client components](https://nextjs.org/docs/app/getting-started/server-and-client-components)).
3. `'use client'` creates the boundary of a client module graph; everything imported beneath that
   entrypoint can enter the client bundle, and props crossing the boundary must be serializable
   ([Next `use client`](https://nextjs.org/docs/app/api-reference/directives/use-client)).
4. Server Function arguments are fully client-controlled and must be validated and authorized;
   `'use server'` does not make a function trusted
   ([React `use server`](https://react.dev/reference/rsc/use-server#security-considerations)).
5. Next supports safe colocation in `app`, route groups, private folders, top-level organization,
   and route/feature splitting; it intentionally does not mandate one project layout
   ([Next project structure](https://nextjs.org/docs/app/getting-started/project-structure#organizing-your-project)).
6. A Server Component should call the backend/data source directly through a server-only client,
   not call its own Route Handler and incur another HTTP hop
   ([Next production checklist](https://nextjs.org/docs/app/guides/production-checklist#data-fetching-and-caching)).
7. Tiptap's React editor integration is a Client Component; its official Next guide uses
   `'use client'` and `immediatelyRender: false` to avoid SSR hydration mismatches
   ([Tiptap Next.js guide](https://tiptap.dev/docs/editor/getting-started/install/nextjs#integrate-tiptap)).

These constraints mean any organization option must preserve `app` ownership of routes and keep
server-only modules out of client public interfaces. Folder symmetry is subordinate to the RSC graph.

### Option A evidence: FSD adapted to App Router/RSC

FSD defines layers by responsibility and dependency depth. Its import rule allows a slice to import
other slices only from lower layers; slices should be cohesive, isolated and expose a public interface
([FSD layers](https://feature-sliced.design/docs/reference/layers#import-rule-on-layers),
[FSD slices](https://feature-sliced.design/docs/reference/slices-segments#public-api-rule-on-slices)).

The FSD project's own Next.js guide documents three concrete adaptation costs:

- Next's `app` conflicts with FSD's `app` layer, so the FSD layers become `_app` and `_pages`;
- Next route files remain in `app` and re-export page code from `src/_pages`;
- a slice that mixes server-only and client-usable modules may need a separate `index.server.ts` to
  prevent server-only side effects entering the client graph
  ([FSD with Next.js](https://feature-sliced.design/docs/guides/tech/with-nextjs#app-router)).

FSD itself says not every interaction should become a Feature: reuse across several pages is a
useful threshold, and unused layers should be omitted
([FSD Feature layer](https://feature-sliced.design/docs/reference/layers#features)). Its guide also
states that FSD is primarily for frontends, supporting the repository constraint against backend
FSD ([FSD Route Handlers](https://feature-sliced.design/docs/guides/tech/with-nextjs#route-handlers-api-routes)).

This evidence informed the accepted layer-on-demand interpretation below: full FSD names the
available dependency layers, but the current one-page checkout does not justify empty seven-layer
scaffolding. The implementation must demonstrate that `_pages` re-exports and separate
server/client public interfaces preserve App Router/RSC behavior for real Platform routes.

### Option B evidence: route/capability organization

Next's official organization options permit route-specific files next to the segment and shared
code outside `app`. Route groups can organize public/member/admin surfaces without changing URLs,
and private folders can explicitly mark implementation details
([Next project structure](https://nextjs.org/docs/app/getting-started/project-structure#examples)).

A bounded route/capability shape can therefore keep:

- Next runtime files and route-owned loading/error boundaries in `app`;
- reusable UI and server-only backend clients in explicitly named top-level capabilities/libraries;
- editor interactivity in a narrow Client Component subtree;
- data loading in Server Components and mutations in server-only functions that delegate to the
  backend application interface.

Evidence implication, not a decision: this option has lower initial migration cost because it is
native to the existing checkout, but it has no standardized cross-slice import rule. If selected,
the owner must decide whether a small local import contract is necessary once a second real route
reuses a capability.

### Accepted frontend organization — full FSD adapted to App Router

The [owner decision](https://github.com/sachkov-inside/platform/issues/27#issuecomment-5378336463) selected full FSD with the following concrete interpretation:

- framework-owned `app/` remains the only App Router route/runtime tree;
- FSD lives under `src/_app`, `src/_pages`, `src/widgets`, `src/features`, `src/entities` and
  `src/shared`;
- these are available architecture layers, but a layer/slice is created only when it carries real
  code; empty speculative scaffolding is not required;
- FSD layer import direction and slice public-interface rules are part of the conceptual contract;
- server-only and client-safe exports are separate, so a Client Component cannot pull a server-only
  dependency into its module graph;
- FSD is frontend-only and must not be ported to backend;
- #27 does not implement lint, harness or architecture-test enforcement.

Later delivery decisions did not change this accepted organization, but the owner correction in
[#44](https://github.com/sachkov-inside/platform/issues/44) changed frontend sequencing by adding a
development-only UI laboratory inside the same `apps/web`. This does not change App Router/FSD or
server/client organization; exact stories, typed fixtures, runtime boundaries and production
integration belong to the canonical application specification, not this research artifact.
Delivery still verifies these implementation details without reopening the organization unless it
finds a material contradiction:

- the existing `apps/web` maps real route/page composition and a server-only backend seam to the
  accepted App Router/FSD layers;
- no server-only import reachable from a `'use client'` entry;
- data loading has one visible path to the Nest application interface and later mutations extend
  that seam instead of creating a second data path;
- a rule for when route/page code is promoted to Widget, Feature, Entity or Shared instead of
  creating those slices speculatively.

## 5. Backend evidence: modular monolith through capability modules

Nest modules already provide an enforceable composition seam: providers are encapsulated by
default, and the explicitly exported providers form the module's public interface
([Nest modules](https://docs.nestjs.com/modules#modules)). Nest recommends feature modules for a
closely related capability and warns against making everything global
([Nest feature/global modules](https://docs.nestjs.com/modules#feature-modules)).

For TypeScript interfaces, Nest DI needs a runtime token because interfaces are erased. Official
Nest guidance supports a `Symbol` or abstract class token and factory providers with explicit
`inject` dependencies
([Nest custom providers](https://docs.nestjs.com/fundamentals/custom-providers#interfaces-and-abstract-classes)).
The existing `DATABASE_PROBE` binding already follows the `Symbol` pattern.

The specification's starting capability map is therefore compatible with Nest without requiring
separate packages or deployables:

| Capability | Small interface already named by specification | Stage 1–2 relevance |
|---|---|---|
| `ContentAuthoring` | create, revise, validate, preview, publish, restore | owner of semantic commands and orchestration |
| `ContentSchema` | validate, migrate, safely render, extract projection | canonical versioned document rules and fixture corpus |
| `ContentAccess` | `authorize(Subject, Resource, Action) -> AccessDecision` | Stage 2 preview/public/closed seam; provider-neutral by existing decision |
| `ContentLibrary` | read projections/search/navigation | projection write in Stage 2; query behavior belongs later |
| `Assets` / `Videos` | resource readiness and local references | Stage 1 typed references only; provider delivery is out of scope |
| `IdentityPrincipals` | trusted identity to local Principal/permissions | test/author principal seam until identity integration |

The map does not prove exact Nest imports or folder names. In particular, a Nest module class is
composition infrastructure; the application interface should remain callable without an HTTP
request and without exposing controllers, Kysely queries or internal providers.

### Accepted dependency direction and ownership edges

```text
api / worker / mcp adapters
            |
            v
  ContentAuthoring interface
       |         |             |
       v         v             v
ContentSchema  capability   transaction-scoped persistence
               interfaces              |
          (identity/resources/          v
             projection)       Kysely / pg / PostgreSQL
```

Entrypoints map authenticated external identity to a trusted `PrincipalId`; `ContentAuthoring`, not
the entrypoint, owns author permission checks through the author-policy/`IdentityPrincipals` seam.
`ContentAuthoring` coordinates reference preconditions through `Assets`/`Videos` public interfaces
when those capabilities exist. `ContentLibrary` owns public/search projection rules and its write
contract; `ContentAuthoring.publishRevision` owns the transaction that coordinates that contract.

### Accepted backend organization — capability modules in one backend package

The [owner decision](https://github.com/sachkov-inside/platform/issues/27#issuecomment-5378336463) accepted this module organization:

- `api`, `worker` and `mcp` entrypoints remain thin composition/transport adapters;
- `modules/content-authoring` and `modules/content-schema` each expose a public interface and hide
  their implementation;
- later capabilities are added only with their consuming vertical slice;
- `infrastructure/postgres` owns Kysely/`pg` composition, generated DB types and ordered migrations;
- cross-module imports use public interfaces only;
- PostgreSQL behavior is tested on real PostgreSQL; fake repository is not acceptance evidence;
- all of this remains inside the single `apps/backend` package and modular-monolith deployable.

The application interface and error/result sections below fix the exported contract. `ContentAuthoring` coordinates permissions
and reference preconditions through capability public interfaces; entrypoints provide only a
trusted `PrincipalId`, never a pre-authorized business decision. Stage 1 may use a retained test
author-policy adapter until `IdentityPrincipals` has a real implementation. `Assets`/`Videos` own
resource readiness when those capabilities exist. In Stage 2, `ContentLibrary` owns projection
rules and its write contract, while `ContentAuthoring.publishRevision` still owns and coordinates
the atomic transaction. Exact transaction-scoped TypeScript plumbing belongs in the #31 brief.

### Existing extraction gate, not a new decision

ADR 0001 defers separate backend packages/deployables until a module has its own interface and at
least two real consumers. The application specification adds the stronger deployable gate: a real
independent operational/domain seam. Evidence required for extraction therefore includes separate
scaling/failure/deployment or data-ownership needs and measured distribution benefit; folder size,
a future Telegram idea, or a second caller alone is insufficient.

## 6. Full write-flow evidence for Stage 1

The following is the minimum flow shape required by #27/#30. It is not an approved class or file
design.

```text
untrusted REST/admin/MCP payload
  -> transport shape/protocol parsing
  -> semantic application command
  -> permission + application preconditions
  -> ContentSchema parse/validate/migrate
  -> application-owned PostgreSQL transaction
       -> enforce idempotency record/key
       -> verify baseRevisionId/current draft
       -> insert immutable MaterialRevision
       -> write required metadata/memberships
       -> atomically advance current draft pointer
       -> database constraints arbitrate races
  -> structured application result
  -> transport-specific HTTP/OpenAPI/MCP mapping
```

Primary-source constraints behind this shape:

- TypeScript types disappear at runtime, so a typed controller parameter is not validation
  ([TypeScript erased types](https://www.typescriptlang.org/docs/handbook/typescript-from-scratch#erased-types)).
- Nest pipes run before a controller method and are specifically intended to validate external
  input at the system seam ([Nest pipes](https://docs.nestjs.com/pipes#pipes)).
- Fastify's schema validation is synchronous seam work; its docs warn against database access
  in initial validation because async validation can enable denial of service
  ([Fastify validation](https://fastify.dev/docs/v5.0.x/Reference/Validation-and-Serialization/#validation-and-serialization)).
- Tiptap/ProseMirror schemas constrain node types, attributes and nesting. `getSchema` can build the
  ProseMirror schema without an editor instance
  ([Tiptap schemas](https://tiptap.dev/docs/editor/core-concepts/schema#get-the-underlying-prosemirror-schema)).
- Tiptap JSON is the recommended persistence shape, but Tiptap explicitly says malicious JSON or
  HTML must still be validated by the application
  ([Tiptap content security](https://tiptap.dev/docs/guides/output-json-html#security)).
- Kysely's callback transaction commits on normal return and rolls back/rethrows on exception;
  queries started through the callback's transaction object use that transaction
  ([Kysely transaction API](https://kysely-org.github.io/kysely-apidoc/classes/Kysely.html#transaction)).
- PostgreSQL raises on violated constraints; cross-row/cross-table integrity should use
  `UNIQUE`/`EXCLUDE`/`FOREIGN KEY`, not a `CHECK` that reads other rows
  ([PostgreSQL constraints](https://www.postgresql.org/docs/18/ddl-constraints.html)).

### Accepted application interface — explicit capability methods and stable results

The [owner decision](https://github.com/sachkov-inside/platform/issues/27#issuecomment-5378336463) requires `ContentAuthoring` to expose named operations rather than a generic command bus. The following shape
is the stable application contract; exact branded-ID helpers and readonly collection spelling may
be refined by #30 without changing the interface semantics:

```ts
type ApplicationResult<Value, Error> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: Error };

interface ContentAuthoring {
  createDraft(command: CreateDraftCommand): Promise<CreateDraftResult>;
  loadDraft(query: LoadDraftQuery): Promise<LoadDraftResult>;
  reviseDraft(command: ReviseDraftCommand): Promise<ReviseDraftResult>;
}

interface CreateDraftCommand {
  readonly actor: PrincipalId;
  readonly idempotencyKey: IdempotencyKey;
  readonly metadata: DraftMetadataInput;
  readonly body: unknown;
}

interface ReviseDraftCommand {
  readonly actor: PrincipalId;
  readonly idempotencyKey: IdempotencyKey;
  readonly materialId: MaterialId;
  readonly baseRevisionId: MaterialRevisionId;
  readonly changes: DraftChanges;
}

interface LoadDraftQuery {
  readonly actor: PrincipalId;
  readonly materialId: MaterialId;
}
```

`DraftMetadataInput` names title, summary, slug, Topic, Format, Tags and ordered Series
memberships. `DraftChanges` is a semantic partial replacement of those fields and/or `body`; it is
not JSON Patch and never exposes database columns or ProseMirror JSON paths as a generic mutation
surface. `body` remains `unknown` until `ContentSchema` validates and migrates it.

Successful writes return stable Material/revision identifiers and the accepted draft snapshot.
Failures use the application error union below. Independent validation issues are accumulated
in deterministic order up to a fixed implementation limit; authentication/permission, missing
aggregate and conflict results short-circuit. REST, MCP and tests call these same methods. Stage 2
adds explicit `validateRevision`, `previewRevision`, `publishRevision`, `unpublishMaterial` and
`restoreRevision` operations only when #31 consumes them; it does not add a dispatcher registry.

## 7. Validation and business-rule placement evidence

### Responsibility matrix constrained by the specification

| Rule class | Owner module/seam | Examples | Must not become |
|---|---|---|---|
| Shape/protocol | transport adapter | JSON object shape, required command fields, string/UUID syntax, payload byte limit | database query or route-local business policy |
| Application precondition | `ContentAuthoring` use case | trusted author permission, Material exists, base revision is current, referenced Topic/Format/Asset exists and is usable | duplicated independently in REST and MCP |
| Document/domain invariant | `ContentSchema` plus semantic command model | known `schemaVersion`, node/mark allowlist, nesting, stable `nodeId`, URL/reference kind, depth/node/text limits | Tiptap's silent normalization alone |
| Database integrity | PostgreSQL schema | PK/FK/NOT NULL, slug/tag uniqueness, one current pointer, unique Series/Material and Series ordinal, idempotency arbitration | preflight-only `SELECT` assumed race-free |
| Safe rendering | `ContentSchema` Stage 2 output adapter | exhaustive node rendering, URL allowlist, no raw HTML/MDX, deterministic plain text | trusting stored JSON because it once passed transport validation |

ProseMirror can deserialize JSON against a schema, serialize it back, and recursively check schema
conformance ([ProseMirror reference](https://prosemirror.net/docs/ref/#model.Node.check)). Tiptap's
`setContent` can be configured to throw on invalid content, but its default compatibility behavior
may normalize/drop unsupported content; `errorOnInvalidContent: true` is therefore relevant to the
round-trip verification
([Tiptap `setContent`](https://tiptap.dev/docs/editor/api/commands/content/set-content)).

Evidence implication: one versioned extension/schema definition should drive server validation and
the Tiptap round-trip fixture. This alone does not cover application reference existence, URL
policy, size/depth limits or renderer safety.

### Accepted validation ownership — one owner per rule class

The [owner decision](https://github.com/sachkov-inside/platform/issues/27#issuecomment-5378336463) accepted the responsibility matrix above as the contract:

- transport adapters parse protocol/shape input from `unknown` and own request-size/shape errors;
- `ContentAuthoring` application use cases own authorization, workflow preconditions and reference
  coordination;
- `ContentSchema` owns versioned document/domain invariants, migration, safe rendering and
  deterministic extraction;
- PostgreSQL constraints own durable integrity and race arbitration;
- business rules have one authoritative owner and are not independently reimplemented by REST,
  MCP and persistence adapters.

The implementation still has to select and lock one direct runtime schema dependency path for
transport/OpenAPI, decide whether the document envelope shares that engine, and preserve stable
machine codes/JSON pointers without leaking validation-library internals. The transitive Fastify
AJV copy is adapter evidence, not permission to import a hidden dependency. These mechanics do not
reopen the ownership split unless implementation shows a material contradiction.

## 8. Structured errors, concurrency and idempotency evidence

### Error facts

- RFC 9457 defines `application/problem+json` with stable `type`, `title`, HTTP `status`, occurrence
  `detail`/`instance`, and extension members. It warns that problem details are not an internal
  debugging dump ([RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html)).
- PostgreSQL exposes stable SQLSTATE codes such as `23503` foreign-key violation, `23505` unique
  violation and `40001` serialization failure
  ([PostgreSQL error codes](https://www.postgresql.org/docs/18/errcodes-appendix.html)). Mapping
  should key from codes/known constraint names, not localized error strings.
- Repository specification already fixes stale `baseRevisionId` as HTTP `409`; the accepted mapping below fixes the
  remaining mapping. Application results do not contain HTTP exception classes because MCP and
  future adapters consume the same interface.

### Concurrency/idempotency facts

- PostgreSQL `ON CONFLICT DO UPDATE` guarantees an atomic insert-or-update outcome under high
  concurrency, subject to independent errors
  ([PostgreSQL `INSERT`](https://www.postgresql.org/docs/18/sql-insert.html#SQL-ON-CONFLICT)). This
  can arbitrate an idempotency record but does not by itself define replay semantics.
- The current IETF Idempotency-Key document says a key identifies retries and must not be reused
  with a different payload, but it is an expired Internet-Draft rather than an RFC; use it as design
  input, not normative authority
  ([IETF draft status](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/history/),
  [draft semantics](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header)).
- Under Serializable isolation, applications must retry the complete transaction logic after
  `40001`; PostgreSQL does not perform a correct automatic application retry
  ([serialization failure handling](https://www.postgresql.org/docs/18/mvcc-serialization-failure-handling.html)).
- An optimistic stale-write check and an idempotency replay are different facts: a retry of the
  same accepted command should return the original structured result, while a new command based on
  an old revision must conflict.

### Accepted error taxonomy

| Application result class | Stable code | REST mapping |
|---|---|---|
| malformed transport input | `invalid_request_shape` | `400` Problem Details |
| document/domain validation | `invalid_content`, `invalid_reference` | `422` Problem Details with bounded `issues` |
| permission/access | `forbidden` / coarse access reason | `403`; public closed reads use the separate teaser contract |
| missing authoring resource | `material_not_found` | `404` for trusted author callers |
| optimistic conflict | `stale_revision` with current revision ID | `409` |
| idempotency misuse | `idempotency_key_reused` | `409` |
| integrity race | stable domain conflict derived from a known constraint | `409` or `422` according to the same semantic class above |
| transient dependency | `dependency_unavailable` with retryable flag | `503` without internal details |
| unexpected infrastructure/bug | `internal_error` + correlation ID | `500` without SQL/library details |

### Accepted error contract — stable application results and adapter mappings

The [owner decision](https://github.com/sachkov-inside/platform/issues/27#issuecomment-5378336463) requires application modules to return the discriminated result above and never throw Nest/HTTP exception types as
expected control flow. Errors contain a stable machine `code`, optional bounded `issues` with
machine `code` and JSON Pointer-like `path`, and only code-specific safe fields such as
`currentRevisionId`. Validation-library messages, SQL text, constraint internals and stack traces do
not cross the public interface.

REST maps these results to RFC 9457 Problem Details with the statuses above. Missing/invalid
authentication remains a transport concern and maps to `401`. MCP maps the same application codes
and safe fields without HTTP vocabulary. Known PostgreSQL SQLSTATE plus an allowlist of owned
constraint names map back to the corresponding semantic error; an unknown constraint failure is an
`internal_error`, not a guessed caller mistake.

Idempotency is scoped by Principal, operation and caller-supplied key. The same transaction stores a
canonical payload fingerprint and effect/result reference. Same key plus same fingerprint returns
the original accepted result even if the Material later advances; same key plus another fingerprint
returns `idempotency_key_reused`. Stage 1 does not automatically expire records: authoring volume is
bounded, while an invented TTL would weaken replay semantics. Retention can change later only with a
documented client retry window and safe pruning rule.

Stage 1 performs no blind automatic transaction retries. A temporary infrastructure failure returns
an opaque retryable result, and the caller retries the whole operation with the same idempotency key.
Measured serialization/deadlock failures may justify a bounded internal full-transaction retry later;
partial statement retries are forbidden.

## 9. Transaction ownership and DI evidence

### Transaction ownership facts

- A `pg` transaction is connection-local; all statements must use the same client
  ([node-postgres transactions](https://node-postgres.com/features/transactions)).
- A Kysely callback transaction supplies a transaction-scoped `Kysely` object and rolls back if the
  callback throws ([Kysely transaction API](https://kysely-org.github.io/kysely-apidoc/classes/Kysely.html#transaction)).
- Kysely migrations should be frozen in time and not depend on current application code; its
  migrator enforces ordering and uses database-level locking
  ([Kysely migrations](https://www.kysely.dev/docs/migrations)).
- Repository specification requires the application use case to own the transaction. Therefore a
  repository method that opens/commits its own hidden transaction cannot implement a multi-write
  create/revise/publish invariant.

Stage-specific atomic sets already constrained by tickets:

- Stage 1 create/revise: idempotency effect, immutable revision, metadata/memberships and current
  draft pointer succeed or roll back together.
- Stage 2 publish: published pointer, public/search projection and only a required durable job fact
  succeed or roll back together.

No external HTTP/provider operation should be assumed transactional with PostgreSQL. If Stage 2
finds a real asynchronous consumer, the durable fact is written inside PostgreSQL and delivery is
handled after commit; the exact outbox/job mechanism remains pending and must not be speculative.

### DI seams

Nest modules expose only exported providers, and interface bindings require runtime tokens. A
candidate contract should therefore inject narrow ports at composition roots and keep singleton
pool lifecycle in infrastructure. Application commands should receive an explicit transaction
capability or be invoked by a transaction-owning application module implementation; business rules must not
reach a global `Kysely`/`Pool` singleton directly.

### Accepted transaction and concurrency contract — application-owned atomicity

The [owner decision](https://github.com/sachkov-inside/platform/issues/27#issuecomment-5378336463) accepted this minimum contract:

- the `ContentAuthoring` application/use-case layer owns the transaction;
- `baseRevisionId` is an optimistic compare-and-set precondition, and a stale base cannot insert or
  advance a new current revision;
- a unique idempotency record is arbitrated and persisted in the same transaction as the command's
  revision/pointer/metadata effects;
- a replay of the same accepted command returns its original structured result, while reuse of the
  key for a conflicting payload is rejected;
- transaction-scoped persistence capabilities prevent queries from escaping to a global
  `Kysely`/`Pool` during the use case;
- Kysely/`pg`, pool/migrator lifecycle and generated DB types remain infrastructure details; real
  PostgreSQL tests invoke the same public application interface as transports.

DI is explicit and singleton by default: `PostgresModule` owns one pool/Kysely lifecycle provider
but is not `@Global`; `ContentAuthoringModule` imports it and exports only the `ContentAuthoring`
token/interface. The stateless application implementation starts Kysely's callback transaction and
passes its transaction object explicitly to module-internal persistence functions. Business-rule
functions do not import Kysely, and request-scoped providers, AsyncLocalStorage/CLS transaction
propagation and controller interceptors do not own transactions.

The exact CAS SQL and owned constraint names are #30 implementation-brief details. They must
implement the accepted rule—zero rows advanced for a stale `baseRevisionId` rolls back every
revision/metadata/idempotency effect—without moving transaction ownership into a repository or
transport.

## 10. Testing evidence and verification matrix

The application specification makes the application interface the primary test surface and rejects
fake repository as evidence for PostgreSQL semantics. Vitest supports reusable scoped fixtures with
automatic cleanup and explicit fixture dependencies
([Vitest test context](https://vitest.dev/guide/test-context)). It runs test files in parallel by
default, so a shared database/schema requires an explicit isolation strategy
([Vitest parallelism](https://vitest.dev/guide/parallelism)). Multiple configurations should use
Vitest `projects`; the old workspace option is deprecated
([Vitest projects](https://vitest.dev/guide/projects)).

| Surface | Required verification | Real dependency |
|---|---|---|
| application acceptance | create/load/revise and Stage 2 lifecycle through retained application interface | real `ContentSchema` + real persistence |
| clean migrations | empty PostgreSQL reaches exact schema; replay/order/drift behavior | PostgreSQL 18.4 + checked-in migrations |
| constraints/concurrency | duplicate slug/tag/ordinal, stale base, idempotent replay, racing writes, rollback | independent real DB sessions |
| document contract | positive/negative versioned JSON fixtures, `nodeId`, depth/size, deterministic/idempotent migration | exact ProseMirror/Tiptap extension set |
| Tiptap adapter | load JSON -> editor/schema -> JSON preserves semantics and stable IDs | selected Tiptap adapter; browser/DOM only if truly required |
| renderer/extractor | exhaustive safe output and deterministic plain text; no raw HTML/credentials | ContentSchema fixture corpus |
| REST adapter | shape parse, result/status/Problem Details mapping, OpenAPI contract | Fastify injection; application may be a narrow test adapter |
| process wiring | `api`/worker/MCP resolve the same exported application provider | Nest application contexts |
| external ports | timeout/failure/retry semantics only at real provider seams | narrow test adapters for identity/assets/video/jobs |

The current `DatabaseProbe` fake remains valid for a readiness-module unit test because database
reachability is the module's real external seam. An in-memory Material repository would not prove
the Stage 1 acceptance criteria.

### Accepted testing strategy — application interface plus real PostgreSQL

The [owner decision](https://github.com/sachkov-inside/platform/issues/27#issuecomment-5378336463) accepted the following testing contract:

1. Unit tests cover pure domain and `ContentSchema` validation/migration/render/extraction logic.
2. Integration/application tests call the public application interface with real PostgreSQL.
3. Migration, constraint, transaction, rollback, idempotency and concurrency tests exercise real
   PostgreSQL, including independent connections where races matter.
4. Thin transport and composition tests cover REST/MCP result mapping, Fastify/Nest wiring and
   OpenAPI behavior without treating adapter mocks as application acceptance evidence.
5. End-to-end tests are added later for real user journeys rather than manufactured for Stage 1.

Test substitutes remain appropriate for true external ports such as identity/provider delivery,
but an in-memory/fake Material repository is not the primary integration surface.

### Accepted testing infrastructure direction — Testcontainers lifecycle and isolation

The bounded recommendation is to add the currently absent `@testcontainers/postgresql` as an
explicit dev dependency and start `PostgreSqlContainer("postgres:18.4-alpine")` once per test run
([Testcontainers PostgreSQL module](https://node.testcontainers.org/modules/postgresql/)). Apply
the single checked-in migration path, expose connection details to Vitest, and stop the container
cleanly; Testcontainers documents explicit start/stop and automatic cleanup behavior
([container lifecycle](https://node.testcontainers.org/features/containers/)).

Isolation must preserve the semantics under test: do not wrap every application test in an outer
rollback that hides real commits/rollbacks or prevents independent sessions. Concurrency tests need
multiple real connections. Per-worker database/schema isolation or explicit cleanup are candidates.
The [owner decision](https://github.com/sachkov-inside/platform/issues/27#issuecomment-5378336463) accepted Testcontainers as the future Platform integration-test direction; the exact
package version and isolation model remain compatibility/performance work in the Stage 1
implementation brief, not a reopened architecture choice. No dependency or test-harness
implementation belongs in #27.

## 11. Illustrative topology sketches and retained comparison

These non-normative trees visualize the accepted organization and are not a filename contract.
Canonical decisions are in the application specification; exact filenames and internal
implementation remain Stage 1 implementation work.

### Illustrative frontend structure: adapted FSD

```text
apps/web/
  app/                         # Next framework-owned route/runtime entrypoints only
    (public)/materials/[slug]/page.tsx
    (author)/admin/materials/[materialId]/page.tsx
  src/
    _app/                      # framework/app composition
    _pages/
      material-read/           # page UI/data composition exported to the public route
      material-edit/           # page UI/data composition exported to the author route
    widgets/                   # only demonstrated reusable/independent UI blocks
    features/
      revise-material/         # only after the edit action has a real UI consumer
    entities/
      material/                # reusable Material presentation/types, not backend domain rules
    shared/
      api/                     # server-only Nest client plus transport DTO mapping
      ui/                      # bounded components from the UI laboratory or production consumers
```

The exact file names are illustrative. The implementation must preserve the accepted layer-on-demand,
server/client-interface and import-direction rules from the canonical specification. This tree does
not prescribe UI laboratory placement or public interfaces.

### Considered but not selected: route/capability

```text
apps/web/
  app/
    (public)/...
    (author)/...
    _components/               # only route-local UI
  src/
    content/                   # demonstrated shared content capability
    api/                       # server-only backend client + transport DTO mapping
    ui/                        # accepted shared primitives only
```

This remained a viable lower-ceremony option in the evidence, but the owner selected adapted full
FSD. It is retained only as comparison provenance and is not a second supported organization path.

### Illustrative backend structure for Stage 1–2

```text
apps/backend/
  src/
    entrypoints/                         # existing thin api/worker/mcp composition
    infrastructure/postgres/
      postgres.module.ts                 # pool/Kysely/migrator lifecycle; not global
      platform-database.ts               # runtime token and owned database capability
      generated/database.ts              # deterministic generated Kysely DB types
      migrations/                        # one ordered, checked-in migration authority
    modules/content-authoring/
      index.ts                            # only cross-module import path
      content-authoring.interface.ts      # accepted commands/results and runtime token
      content-authoring.module.ts         # Nest composition/export
      internal/
        content-authoring.implementation.ts # application orchestration + transaction owner
        material-rules.ts                 # pure Material/domain rules
        content-authoring.persistence.ts  # Kysely queries taking explicit transaction
        idempotency.ts                    # fingerprint/replay mapping
    modules/content-schema/
      index.ts
      content-schema.interface.ts         # validate/migrate; Stage 2 render/extract
      content-schema.module.ts
      internal/
        schema-v1.ts                      # exact extension/schema definition
        validate-document.ts
        migrate-document.ts
        render-document.ts                # added by Stage 2
        extract-document.ts               # added by Stage 2
    modules/content-access/               # add when Stage 2 consumes preview/read policy
    modules/content-library/              # add with Stage 2 public projection/read consumer
  test/
    unit/                                 # pure Material and ContentSchema behavior
    integration/
      setup/postgres.global.ts            # one Testcontainers lifecycle per run
      content-authoring.test.ts            # public interface + real PostgreSQL
      migrations.test.ts
      constraints-concurrency.test.ts
    fixtures/content-schema/               # positive/negative versioned corpus
```

The exact directories and filenames are illustrative. Stage 1–2 remain headless and follow the
capability ownership, public-interface and no-speculative-extraction rules in the canonical
specification. Frontend sequencing belongs to that later canonical contract; this research sketch
does not create a gate or parallel delivery authority.

## 12. Bounded future checks — do not implement in #27

| Possible rule/check | Local/shared | Evidence | Automatable verification |
|---|---|---|---|
| App Router client graph cannot import `server-only` application modules | Platform-local | Next/FSD server-client seam | ESLint/import graph or Next build negative fixture |
| Backend entrypoints import only capability public interfaces, not persistence internals | Platform-local | Nest exported-provider seam + ADR 0001 | import-seam architecture test |
| Capability-to-capability dependencies use declared public interfaces | Platform-local | #27 module map after approval | import graph allowlist |
| Application/domain code cannot import Nest HTTP exceptions/controllers | Platform-local | shared REST/MCP application results | restricted-import lint |
| `pg`/Kysely raw access stays in approved persistence/migration paths | Platform-local | transaction ownership | restricted-import lint plus review |
| One checked-in migration runner; clean migration + generated DB type drift check | Platform-local | #30 acceptance + Kysely docs | CI scripts against clean PostgreSQL |
| Versioned document fixtures pass validate/migrate/round-trip/render/extract | Platform-local | #30/#31 acceptance | focused Vitest corpus |
| No durable queue/outbox without a registered consumer | Platform-local | ADR 0001/spec | small architecture assertion or issue checklist |
| Generic guidance to avoid machine-local runtime dependencies | already shared | existing managed harness contract | existing harness `health`/`diff`; no new rule proposed here |

None of the Platform-specific rules is proven shared across repositories. They should not enter the
shared harness unless another repository presents the same stable requirement and the canonical
harness lifecycle accepts it.

## 13. Accepted local enforcement direction — strict TypeScript and typed lint

The [owner decision](https://github.com/sachkov-inside/platform/issues/27#issuecomment-5378336463)
accepts this future enforcement direction; it is not permission to change configuration in #27.
Keep it repository-local and do not modify the shared harness in #27:

- derive both app configs from one Platform-owned TypeScript base, with explicit compatibility
  overrides only where the runtime requires them;
- enable `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch` and
  `noUncheckedSideEffectImports` where the exact Next/Nest/test toolchain proves compatibility;
- use typescript-eslint's `strictTypeChecked` and `stylisticTypeChecked` shared configs with
  `parserOptions.projectService: true`, which is the documented typed-linting path
  ([typed linting](https://typescript-eslint.io/getting-started/typed-linting/),
  [shared configs](https://typescript-eslint.io/users/configs/));
- reject explicit `any`, non-null assertions and unsafe assignment/argument/call/member-access/
  return/type-assertion paths at owned application seams, while avoiding duplicate overrides
  already supplied by the selected configs
  ([`no-explicit-any`](https://typescript-eslint.io/rules/no-explicit-any/),
  [`no-non-null-assertion`](https://typescript-eslint.io/rules/no-non-null-assertion/),
  [rule index](https://typescript-eslint.io/rules/));
- encode the already accepted FSD server/client public-interface direction and backend
  capability-public-interface imports with Platform-local restricted-import/seam rules.

TypeScript documents that indexed reads and optional properties become materially safer under
`noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
([indexed access](https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html),
[exact optional properties](https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html)).
Typed linting also has configuration and performance costs, especially for files outside the
project service. The exact ESLint/plugin versions, exceptions, config-file handling and CI budget
must be verified against the locked checkout in the Stage 1 implementation brief. Enabling the rules,
adding dependencies or changing CI remains a separate implementation mutation.

## 14. Hard-to-reverse ADR inputs versus reversible choices

Potential ADR inputs already named by the application specification and sharpened by this evidence:

- migration/data authority plus transaction capability if Stage 1 proves a non-obvious,
  hard-to-reverse seam;
- canonical document schema/version migration/immutable revision/safe renderer contract;
- `ContentAccess` placement and conformance surface when protected delivery begins;
- identity BFF/provider mapping, asset delivery and Kinescope mechanics only in their owning implementations.

Normally reversible and not ADR-worthy by themselves:

- `src` versus root folder;
- FSD layer/folder spelling;
- filename suffixes such as `.server.ts` except where they enforce a selected seam;
- test file colocation;
- barrel-file preference;
- a lint rule that only automates an already accepted local contract.

### Accepted ADR timing — no ADR in #27 and no separate proof tickets

The canonical application specification and the
[owner decision](https://github.com/sachkov-inside/platform/issues/27#issuecomment-5378336463) are
the durable decision record for #27; this research artifact supplies evidence and rationale. No ADR is
created now: FSD/layout/enforcement choices are reversible, while the exact transaction/data and
document migration seams have not yet produced a non-obvious implementation trade-off beyond this
contract.

#30 proceeds through its required implementation brief and then the retained production vertical
slice; it does not create separate Kysely, ProseMirror, Testcontainers or architecture prototype
tickets. The implementation, compile/check and acceptance tests supply the verification. If that same PR
crystallizes a hard-to-reverse, surprising trade-off, it may add one focused ADR there. Otherwise no
ADR is required. The later UI laboratory #45 is a bounded mergeable frontend delivery lane with an
explicit production adoption path, not a retroactive #27 proof or a backend prerequisite.

## 15. Concrete implementation inputs left to #30/#31

1. Exact Kysely version and exact generated-DB-type tool are absent from the lockfile; #30 selects
   them in its implementation brief and verifies compatibility in the same vertical PR.
2. Exact Tiptap/ProseMirror package and extension set is absent. The smallest v1 fixture corpus and
   whether the headless round-trip needs DOM emulation are not yet demonstrated.
3. No direct runtime validation dependency is selected. #30 chooses one explicit path for
   Fastify/OpenAPI and stable structured errors without changing the accepted validation ownership.
4. Testcontainers is accepted as the integration-test direction, but no package version or
   real-PostgreSQL isolation strategy is locked; Vitest's default file parallelism makes the exact
   setup part of the #30 implementation brief and acceptance tests, not a separate experiment.
5. The frontend organization is accepted; the first real frontend delivery maps real route/page
   code and one backend seam to the accepted `_pages` and server/client public-interface rules,
   adding layers only with real consumers. Exact slice scope belongs to the canonical specification.
6. Canonical payload serialization/hash representation and the exact stored effect reference remain
   to be named; the accepted error contract already fixes scope, replay, mismatch and no-expiry semantics.
7. Exact optimistic concurrency SQL/constraint names remain to be written; the accepted transaction/error contracts fix the isolation
   behavior and prohibit blind partial retries.
8. Ownership of metadata/reference checks and Stage 2 projection writes is fixed above; #30/#31
   only need to bind exact public method names and transaction-scoped TypeScript plumbing.
9. The strict TypeScript/typescript-eslint direction is accepted, but exact locked compatibility,
   exceptions and performance have not been measured.
10. The declared Node/pnpm toolchain is available through `fnm`/Corepack and final #27 verification
   passed; #30 should retain the same pinned invocation in CI/agent handoffs.

## 16. Accepted decision handoff

The architecture recorded canonically in the application specification is traceable to these
evidence and decision sections:

- [frontend organization](#accepted-frontend-organization--full-fsd-adapted-to-app-router);
- [backend organization](#accepted-backend-organization--capability-modules-in-one-backend-package);
- [application interface](#accepted-application-interface--explicit-capability-methods-and-stable-results);
- [validation ownership](#accepted-validation-ownership--one-owner-per-rule-class);
- [error contract](#accepted-error-contract--stable-application-results-and-adapter-mappings);
- [transaction and concurrency](#accepted-transaction-and-concurrency-contract--application-owned-atomicity);
- [testing strategy](#accepted-testing-strategy--application-interface-plus-real-postgresql);
- [testing infrastructure](#accepted-testing-infrastructure-direction--testcontainers-lifecycle-and-isolation);
- [local enforcement](#13-accepted-local-enforcement-direction--strict-typescript-and-typed-lint);
- [ADR timing](#accepted-adr-timing--no-adr-in-27-and-no-separate-proof-tickets).

These evidence-backed decisions are sufficient for the #30 implementation brief. That brief binds exact dependency
versions, TypeScript declarations, SQL/constraint names and test isolation before production code;
it does not reopen the architecture unless implementation evidence shows a material contradiction.

## 17. Verification

Executed in the #27 task worktree on 2026-08-22:

- `pnpm install --frozen-lockfile` with Node `24.19.0` and pnpm `11.22.0` — passed;
- literal `pnpm check` through a temporary Corepack shim — lint, typecheck, 3 tests and both builds
  passed;
- `git diff --check` — passed;
- Markdown fence/local-link sanity — passed;
- version-matched `inside-engineering-v0.3.3` harness `health` — healthy;
- version-matched harness `diff` — no managed drift;
- task diff contains this research artifact and canonical specification updates only; no
  production or managed harness file changed.

The newer Workspace canonical package source differs from installed 0.3.3 in `WORKFLOW.md` and the
managed `research/SKILL.md`, so a latest-source verifier reports a future rollout delta. The 0.3.3
release tag matches this repository's installed state. #27 neither updates nor repairs harness.
