# PostgreSQL data access for Platform v1

> Историческое исследование на указанную в документе дату. Оно не задаёт текущие правила.
> Источник: [Workspace](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/platform-postgresql-data-access.md); текущие правила — [документы Platform](../../README.md).

**Status:** research recommendation for owner decision

**Snapshot:** 2026-08-21
**Scope:** NestJS/Fastify modular monolith, PostgreSQL transactional store and first search engine; no production implementation or hosting choice

## Decision in one page

Choose **Kysely + `pg`**, with the **Kysely Migrator/official `kysely-ctl` as the only migration runner**, for the v1 spike. Treat checked-in migrations as the database authority and generate Kysely database types from a database rebuilt from those migrations. Do not introduce a Unit of Work or identity map merely because another platform used one.

Why this fits Inside:

- The domain needs explicit atomic use cases—publish a revision, update its search projection and append an outbox event—not transparent entity change tracking. Kysely exposes a transaction-bound database value that can be passed through those repositories, and callback transactions roll back on an exception ([transactions](https://www.kysely.dev/docs/examples/transactions/simple-transaction)).
- Its API is deliberately SQL-shaped, compiles predictably to SQL and exposes a parameterized `sql` tag wherever the builder is insufficient ([project overview](https://www.kysely.dev/), [raw SQL](https://www.kysely.dev/docs/recipes/raw-sql)). That is a strong match for PostgreSQL FTS and an agent-first repository.
- It has no runtime entity graph or hidden flush phase. Generated SQL, parameters and duration are directly available to a custom logger ([logging](https://www.kysely.dev/docs/recipes/logging)).
- It does less for us than a full ORM. That is intentional, but it creates two gates: prove the database-first type-generation loop and prove the migration/drift compensations in the spike.

**Fallback:** **Drizzle ORM + `pg` + Drizzle Kit**, pinned to one tested version line. It is the better fallback if the team values one TypeScript schema for mappings and generated SQL migrations more than Kysely's database-first explicitness. Do not adopt the v1 release candidate before the spike: the official v1 upgrade changes migration-folder representation and relational-query APIs, and the current stable package remains 0.x ([v1 upgrade](https://orm.drizzle.team/docs/upgrade-v1), [releases](https://github.com/drizzle-team/drizzle-orm/releases)).

**Do not choose yet:** Prisma, MikroORM, TypeORM or raw `pg`. They remain credible, but each pays for capabilities that do not currently solve the dominant v1 problem. The bounded spike below can reverse this recommendation.

## Four different questions, four answers

| Question | Answer at this snapshot | Interpretation |
|---|---|---|
| Most popular | **Prisma overall** | It has the largest GitHub audience in this set (~47.6k stars) and ~64–66m monthly client/CLI downloads. Drizzle's ORM package led the sampled npm month (~73.6m), but package downloads include CI, transitive installs and bots; they are not unique projects. See the [official Prisma repository](https://github.com/prisma/prisma), [official Drizzle repository](https://github.com/drizzle-team/drizzle-orm), [unscoped npm downloads](https://api.npmjs.org/downloads/point/2026-07-21:2026-08-20/prisma,drizzle-orm,kysely,typeorm) and [MikroORM downloads](https://api.npmjs.org/downloads/point/2026-07-21:2026-08-20/%40mikro-orm%2Fcore). |
| Most mature/stable | **TypeORM for Nest ORM longevity; Prisma for migration/drift tooling** | Nest calls TypeORM its most mature TypeScript ORM and provides first-party module integration ([Nest database guide](https://docs.nestjs.com/techniques/database)). Prisma has the clearest documented shadow-database drift workflow ([shadow database](https://docs.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate/shadow-database)). Neither fact makes either the best fit. |
| Lowest overhead | **raw `pg`; Kysely among typed candidates** | No cross-library synthetic benchmark is decision-grade. `pg` is the control. Kysely describes itself as a thin, predictable 1:1 SQL layer with no dependencies; Drizzle makes a similar thin-layer claim ([Kysely overview](https://www.kysely.dev/), [Drizzle overview](https://orm.drizzle.team/docs/overview)). The representative spike must measure our queries. |
| Best fit for Inside v1 | **Kysely** | Explicit SQL and transaction capability, strong custom-query path, no lifecycle state, good API/worker/MCP symmetry. Its weaker schema diff/drift story is bounded by policy and a go/no-go gate rather than ignored. |

Popularity, age, a 1.0 version and runtime speed are separate signals. This report does not turn any one of them into a composite score.

## Decision criteria

The important correctness model is product-specific:

1. An application use case owns the transaction boundary.
2. Every repository participating in that use case receives the same transaction capability explicitly.
3. Database constraints remain the last line of defence for uniqueness, referential integrity and idempotency.
4. Search projection and outbox writes commit with the domain state they describe.
5. HTTP, worker and MCP adapters invoke the same application use cases; none owns a parallel persistence model.
6. SQL must remain inspectable and PostgreSQL-specific features must not require a second runtime stack.

No criterion requires EF-style change tracking, an identity map or an implicit Unit of Work. Those are candidate features to justify, not a baseline to imitate.

## Comparison matrix

Ratings are relative to this v1, not universal library quality.

| Candidate | Correctness and transactions | PostgreSQL, FTS, custom SQL | Migrations and drift | Contexts / observability / tests | Overhead and agent explicitness | Inside fit |
|---|---|---|---|---|---|---|
| **Kysely + `pg`** | Strong callback/controlled transactions and savepoints; transaction object is explicit ([docs](https://www.kysely.dev/docs/category/transactions)) | Excellent SQL-shaped builder; parameterized `sql` works nearly everywhere ([docs](https://www.kysely.dev/docs/recipes/raw-sql)) | Ordered, frozen-in-time up/down migrations; no native schema diff or live drift detector ([migrations](https://www.kysely.dev/docs/migrations)) | Framework-agnostic; compiled SQL/params/duration logger; integration tests use real Postgres | Thin, no dependencies or entity lifecycle; schema types must be generated or maintained | **1 — target** |
| **Drizzle + `pg`** | Strong explicit callback transactions, isolation settings and nested savepoints ([docs](https://orm.drizzle.team/docs/transactions)) | Strong SQL-like API/tag; official FTS recipe, but `tsvector` still not native ([FTS guide](https://orm.drizzle.team/docs/guides/postgresql-full-text-search)) | TS schema → editable SQL; custom SQL migrations. `check` checks migration-history consistency, not Prisma-like live drift ([generate](https://orm.drizzle.team/docs/drizzle-kit-generate), [check](https://orm.drizzle.team/docs/drizzle-kit-check)) | Framework-agnostic; driver/ORM logger can be wrapped; real-DB tests | Thin and explicit, but stable 0.x and v1 RC is changing migrations/RQB | **2 — fallback** |
| **Prisma + TypedSQL/raw** | Strong callback and batch transactions with isolation/timeouts ([docs](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)) | CRUD excellent; FTS requires TypedSQL/raw for the serious path. TypedSQL is still a preview feature and cannot express dynamic columns/clauses ([TypedSQL](https://docs.prisma.io/docs/orm/prisma-client/using-raw-sql/typedsql), [raw queries](https://docs.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries)) | Best-in-set schema diff/drift workflow; generated SQL is editable; unsupported DDL goes in custom migrations ([Migrate](https://docs.prisma.io/docs/orm/prisma-migrate), [unsupported features](https://docs.prisma.io/docs/orm/prisma-migrate/workflows/unsupported-database-features)) | Official Nest guide, query logs and OTel traces ([Nest](https://docs.prisma.io/docs/guides/frameworks/nestjs), [tracing](https://docs.prisma.io/docs/orm/prisma-client/observability-and-logging/opentelemetry-tracing)) | More generation and a bifurcated Client/TypedSQL query model; Prisma 7 is Rust-free and uses JS driver adapters ([engines](https://docs.prisma.io/docs/orm/v6/more/internals/engines)) | **3** |
| **MikroORM 7 + integrated Kysely** | Rich transactions plus identity map/UoW/flush semantics ([UoW](https://mikro-orm.io/docs/unit-of-work), [transactions](https://mikro-orm.io/docs/transactions)) | Entity operations plus first-class `em.getKysely()` for lower-level SQL | Strong schema diff/migrations, transactional by default ([migrations](https://mikro-orm.io/docs/migrations)) | First-party Nest integration requires per-request/worker `RequestContext`; good logger hooks ([Nest](https://mikro-orm.io/docs/usage-with-nestjs)) | Highest conceptual surface: entities, UoW, loading strategy, EM context and Kysely plugin | **4** |
| **TypeORM 1** | Correct when every operation uses the supplied transactional `EntityManager`; global manager in a transaction is explicitly forbidden ([transactions](https://typeorm.io/docs/transactions/)) | QueryBuilder, raw results and raw SQL are capable; custom FTS stays string-heavy ([QueryBuilder](https://typeorm.io/docs/query-builder/select-query-builder/)) | Generated/manual migrations; configurable all/each/none transaction modes, including concurrent indexes ([migration transactions](https://typeorm.io/docs/migrations/faking/)) | Tightest Nest integration; configurable query/error/slow-query logging ([Nest](https://docs.nestjs.com/techniques/database), [logging](https://typeorm.io/docs/logging/)) | Entity/decorator and manager APIs create more routes to the DB; official docs warn about N+1 and entity-processing overhead ([performance](https://typeorm.io/docs/advanced-topics/performance-optimizing/)) | **5** |
| **raw `pg` + SQL migrations** | Correct if one checked-out client is used for the whole transaction; library provides no higher-level guard ([transactions](https://node-postgres.com/features/transactions)) | Maximum PostgreSQL control; parameterized/prepared queries ([queries](https://node-postgres.com/features/queries)) | Depends entirely on the chosen runner; `node-pg-migrate` is mature but adds its own DSL/runner ([official docs](https://salsita.github.io/node-pg-migrate/)) | Driver events plus app instrumentation; more fixtures/mapping/type work | Lowest abstraction and likely lower overhead, but greatest volume of manual contracts | **Control, not target** |

## Candidate findings

### 1. Kysely: recommended target

Kysely models database tables as TypeScript interfaces and infers selected result shapes. It does not define domain entities, relations or cascade behaviour. This is an advantage here: a `Material` aggregate need not be a mutable object graph, while `SearchLibrary` can be an explicit projection query.

Use two modes deliberately:

- SQL-shaped query builder for ordinary reads/writes;
- parameterized `sql<T>` snippets or full statements for `tsvector`, `websearch_to_tsquery`, ranking, locking and unusual PostgreSQL DDL.

Queries can be compiled without execution into SQL and parameters, which supports golden SQL tests and `EXPLAIN` tooling ([compile/execute recipe](https://github.com/kysely-org/kysely/blob/master/site/docs/recipes/0004-splitting-query-building-and-execution.md)). Type correctness is not database correctness: generated-column expressions, isolation behaviour, indexes, collation and plans still need PostgreSQL integration tests.

The main cost is schema ownership. Kysely's migration guide explicitly says migrations must be frozen and must not depend on current application code. Adopt database-first types:

```text
checked-in migrations → temporary PostgreSQL → generated DB types → Kysely queries
             │                                      │
             └──────────── CI replay + diff ─────────┘
```

The Kysely site endorses `kysely-codegen` as the database-to-types path ([overview](https://www.kysely.dev/)); it is a separate MIT package, not core Kysely ([registry metadata](https://registry.npmjs.org/kysely-codegen)). Pin it exactly and treat its output as generated. If that dependency or its handling of `tsvector`, arrays, numeric and timestamps fails the spike, either maintain a small reviewed `Database` interface or switch to Drizzle; do not silently cast to `any`.

Kysely has substantial current use signals (~54.4m downloads in the sampled month, ~14.1k GitHub stars and active August 2026 updates), but remains 0.x. Pin the exact version, use isolated upgrade PRs later, and make migration replay/typecheck/query snapshots the upgrade gate ([repository](https://github.com/kysely-org/kysely), [registry](https://registry.npmjs.org/kysely)).

### 2. Drizzle: fallback

Drizzle combines typed table definitions, SQL-like/relational query APIs and Drizzle Kit. Its code-first flow generates reviewable SQL from TypeScript schema snapshots, while custom empty migrations cover unsupported DDL ([migration fundamentals](https://orm.drizzle.team/docs/migrations), [custom migrations](https://orm.drizzle.team/docs/kit-custom-migrations)). This removes Kysely's external type-generation step.

For Inside, use only its SQL-like builder in repositories at first. Do not let the relational query API become an implicit aggregate loader, and never use `drizzle-kit push` in shared or production databases. Its official FTS guide relies on the `sql` escape hatch and says `tsvector` is not natively supported; that is workable but must be tested.

The reason it is fallback rather than target is timing: stable is 0.45.x while v1 is an RC; the official upgrade changes migration storage and relational APIs. A green spike on a pinned stable version is meaningful, but adopting immediately before that transition adds avoidable migration-tool churn.

### 3. Prisma: strongest operational tooling, weaker query-model fit

Prisma 7 uses a generated Client with JavaScript driver adapters and a TypeScript query compiler. It offers the strongest documented developer drift detection here: a shadow database replays migration history and compares the resulting schema with the development database. Generated SQL can be edited for data migrations and unsupported database features.

The cost is two query languages. Ordinary work uses Prisma Client; FTS and advanced projection queries use `.sql` files through TypedSQL or tagged raw calls. TypedSQL is still behind a preview flag and dynamic columns/clauses require raw SQL. PostgreSQL FTS through the old Client feature remains preview and Prisma itself recommends TypedSQL for PostgreSQL functions ([FTS](https://www.prisma.io/docs/orm/v6/prisma-client/queries/full-text-search)).

Choose Prisma instead if the spike shows that drift/schema tooling dominates day-to-day work and the team accepts this explicit policy: Client for simple CRUD, TypedSQL for named static projections, `$queryRaw` only for reviewed dynamic cases, all through the same Prisma transaction.

### 4. MikroORM with its integrated Kysely

MikroORM 7's integration is technically coherent, not an accidental two-library hack. `em.getKysely()` derives types/mappings from MikroORM metadata and automatically binds queries to the current `EntityManager` transaction ([integration](https://mikro-orm.io/docs/kysely)). That is the only entity-ORM + Kysely mix worth a PoC.

It still introduces two mental models. Entity writes participate in an identity map/UoW and flush lifecycle; projections use Kysely. Each HTTP request, queue handler and scheduled job needs a correctly scoped/forked EntityManager. That can be valuable for genuinely complex aggregate graphs, but Inside has not established that need. Do not pay this state-management cost speculatively.

### 5. TypeORM

TypeORM is the safest answer to “which ORM is conventional in Nest?” and not to “which data model best exposes Inside's invariants?” It has repositories, entities, QueryBuilder, migrations and the most direct Nest module. It also has several legitimate access paths—global repositories, manager, transactional manager, QueryRunner, raw queries—which make transaction escape easier unless the project builds its own narrow seam anyway.

Its migration runner is notably able to opt a concurrent-index migration out of transactions. That feature belongs in the spike whichever target we use, because PostgreSQL forbids `CREATE INDEX CONCURRENTLY` inside a transaction ([PostgreSQL `CREATE INDEX`](https://www.postgresql.org/docs/current/sql-createindex.html)). Longevity is not enough to outweigh the less explicit query surface for this project.

### 6. Why raw `pg` is only the control

Raw `pg` closes the “what does the abstraction cost?” gap, so include it in the benchmark for one FTS read and one publish transaction. It should not be the default v1 stack: hand-written row/result types, mapping, transaction propagation, migration runner integration and test helpers would become platform code. Kysely preserves almost all of the SQL control without making Inside own those mechanics.

## Target topology

```text
HTTP controller / queue consumer / MCP tool
                    │
                    ▼
             application use case
                    │
           transaction.run(tx => ...)
             ┌──────┼─────────┐
             ▼      ▼         ▼
        Material  Search    Outbox
        repository library  repository
             └──────┴─────────┘
               same Kysely tx
                    │
                 pg.Pool
                    │
                PostgreSQL
```

Concrete rules:

- Each process—API, worker, MCP—owns one `pg.Pool` and one root `Kysely<Database>`; size each pool against the total PostgreSQL connection budget.
- A `DatabaseExecutor` structural type is the common subset accepted by repositories; both root Kysely and `Transaction<Database>` satisfy it. Only the application transaction runner may create a transaction.
- The runner passes `tx` into repository methods. Do not hide the active transaction in request-local storage in v1. An explicit value is easier to review, test and reuse outside HTTP.
- Do not perform email, HTTP, Telegram or other unbounded I/O inside a database transaction. Insert an outbox record atomically and deliver after commit.
- Use database unique constraints for inbox provider/event id, slug, `(material_id, revision_no)`, read state and outbox deduplication keys.
- Retry only the complete top-level use case for explicitly classified serialization/deadlock failures; never retry an arbitrary repository fragment.
- Repository interfaces expose product operations and projections, not Kysely builders or table types. Adapters/controllers never receive the root database.

## Migration and drift policy

There is exactly one migration history and runner.

1. **Authority:** checked-in, immutable Kysely migrations. Never edit a migration applied outside a disposable developer database; append a corrective migration.
2. **Runner:** Kysely `Migrator`, invoked through pinned `kysely-ctl`; production deploy runs a dedicated migration job before new application instances. Application startup never auto-migrates.
3. **Contents:** migration files import only pinned Kysely migration primitives and local migration-only helpers. Non-trivial PostgreSQL DDL and backfills use explicit parameter-free SQL blocks. They never import current entities, generated DB types or application services, following Kysely's frozen-in-time rule.
4. **Transactions:** ordinary migrations run one-by-one transactionally. A documented non-transactional lane is required for `CREATE INDEX CONCURRENTLY`; its failure/retry/invalid-index cleanup must be tested. If the official runner cannot express this cleanly, that is a Kysely no-go and Drizzle/Prisma migration tooling is reevaluated.
5. **Types:** CI creates empty PostgreSQL, applies all migrations, runs pinned `kysely-codegen`, and fails if generated types differ from the checked-in file. Generated types are never hand-edited.
6. **Drift:** CI replays from zero and verifies expected migration history. A scheduled/pre-deploy audit compares normalized `pg_dump --schema-only` output from a migrated empty database with the target schema, excluding owners, privileges, extension-owned objects and migration metadata. Tool-native drift is weaker than Prisma; the first false positive or missed material difference is a go/no-go failure, not accepted noise.
7. **Production:** no `schema:push`, `synchronize`, ad-hoc console DDL or second migration table. Emergency DDL is immediately captured as an idempotent/faked migration through a reviewed incident procedure.

### Mixing policy

- **Allowed:** Kysely builder and Kysely's parameterized `sql` tag, using the same `db`/`tx`; both are one runtime stack.
- **Allowed if target changes:** Prisma Client + TypedSQL/`$queryRaw` through the same Prisma transaction; MikroORM + `em.getKysely()` through its documented transaction binding.
- **Forbidden by default:** standalone Kysely beside Drizzle/Prisma/TypeORM, two pools hidden behind repositories, or two migration runners. This duplicates schema types, logging, retry semantics and migration authority.
- **Exception process:** add a second runtime query stack only after a measured production query cannot meet a written requirement with the target's safe raw-SQL path. The exception must share the existing connection/transaction, have an owner and removal trigger, and must not own migrations.

## Representative Material + SearchLibrary spike

Timebox: **four engineering days**, then a written go/no-go review. Implement the same vertical slice with Kysely; implement only the hot publish and FTS queries with raw `pg` as the overhead/control case. If Kysely fails a hard gate, repeat the slice with Drizzle, not all candidates.

### Schema and operations

Create migrations for:

- `material(id, slug, status, current_revision_id, published_at, version)`;
- `material_revision(id, material_id, revision_no, title, body, summary, created_at)` with unique `(material_id, revision_no)`;
- `material_search(material_id, title, body, search_vector, published_at)` as a disposable read projection;
- `outbox_event(id, topic, aggregate_id, deduplication_key, payload, occurred_at, delivered_at)`;
- a stored generated weighted `tsvector` and GIN index. PostgreSQL documents stored generated `tsvector` columns and says GIN is the preferred FTS index ([tables/indexes](https://www.postgresql.org/docs/current/textsearch-tables.html), [index types](https://www.postgresql.org/docs/current/textsearch-indexes.html)).

Implement:

1. `createRevision` with optimistic material `version` and revision uniqueness.
2. `publishMaterial`: lock/compare the material, set current revision/status, upsert `material_search`, append deduplicated outbox event—one transaction.
3. `SearchLibrary(query, cursor, limit)`: `websearch_to_tsquery('russian', ...)`, weighted rank and stable `(rank, published_at, material_id)` pagination. PostgreSQL describes `websearch_to_tsquery` as the forgiving web-style parser ([text search controls](https://www.postgresql.org/docs/current/textsearch-controls.html)).
4. Outbox claim with `FOR UPDATE SKIP LOCKED`, failure release and idempotent delivery bookkeeping.
5. One HTTP route, one worker handler and one MCP tool invoking the same application use cases.

Do not benchmark toy single-row CRUD. Seed a fixed, disclosed corpus large enough to exercise GIN and joins; start with 50k materials, five revisions each and 100k outbox rows, then increase only if the plan stays memory-resident. Compare identical PostgreSQL settings and pool sizes.

### Evidence to capture

- compiled SQL and parameterization snapshots for every representative query;
- `EXPLAIN (ANALYZE, BUFFERS)` for search, publish lock/update and outbox claim;
- query count, p50/p95/p99, throughput, process RSS and startup time for Kysely and raw `pg` control;
- pool wait, query duration/error logs with parameters redacted; correlate with PostgreSQL `pg_stat_statements`, which tracks planning/execution statistics ([official module](https://www.postgresql.org/docs/current/pgstatstatements.html));
- two concurrent publishes, duplicate webhook/outbox keys, deadlock/serialization retry and forced mid-transaction failure;
- migrate from zero, upgrade an old fixture, rollback a reversible migration, recover a failed non-transactional concurrent index, and detect deliberate live drift;
- codegen correctness for `timestamptz`, `numeric`, JSONB, arrays, enums, generated `tsvector` and nullable columns;
- repository test using a transaction and real PostgreSQL, plus a unit test against a narrow repository fake—not a mock of Kysely internals.

### Go / no-go gates

Proceed with Kysely only if all are true:

- publish/projection/outbox atomicity and concurrency tests are deterministic;
- no repository can accidentally fall back to the root pool while given `tx`;
- FTS query uses the expected GIN plan and cursor order is stable;
- every query is parameterized, inspectable and has no hidden N+1 round trips;
- type generation is deterministic and has no unsafe `any`/incorrect material types;
- migration replay, concurrent-index recovery and deliberate drift detection work in CI;
- logging exposes operation, duration, SQL fingerprint and trace correlation without leaking content/credentials;
- Kysely overhead relative to raw `pg` is immaterial at the measured workload; agree the numeric budget before running the test rather than choosing it after seeing results;
- a second agent can make one schema/query change from the repository instructions and pass the same checks without undocumented tribal knowledge.

Switch to **Drizzle** if Kysely fails type-generation/dual-authority ergonomics but explicit transactions, FTS SQL and Drizzle Kit replay pass. Switch to **Prisma** if reliable built-in drift/schema tooling is the hard requirement and the team accepts TypedSQL preview plus the dual Client/SQL query model. Reconsider **MikroORM** only after concrete aggregate workflows demonstrate that identity map/UoW removes more complexity than it adds.

## Recommendation boundaries

This recommendation changes when any of these becomes true:

- v1 requires large mutable entity graphs and cascade/change tracking across many aggregates → spike MikroORM.
- database drift across many environments becomes a dominant operational risk → prefer Prisma or add a separately approved schema-management decision.
- Drizzle v1 reaches stable and its new migration/commutativity workflow proves materially simpler in the representative slice → rerun target/fallback comparison.
- Kysely codegen cannot faithfully represent the PostgreSQL types in the schema or its 0.x upgrade surface causes repeated breakage → move to Drizzle.
- measured Kysely overhead is unacceptable and raw `pg` materially fixes the real bottleneck → approve raw SQL for that bounded repository before replacing the whole stack.

## Version and activity snapshot

Registry and repository numbers are only ecosystem-risk signals. They are not product-fit scores.

| Package | Stable npm version | First npm publish | Sample-month downloads | GitHub signal |
|---|---:|---:|---:|---:|
| Prisma CLI / Client | 7.9.1 / 7.9.1 | 2016 | 66.3m / 64.4m | 47.6k stars |
| Drizzle ORM / Kit | 0.45.2 / 0.31.10 | 2021 | 73.6m / 61.7m | 35.5k stars; v1 RC active |
| Kysely | 0.29.5 | 2021 | 54.4m | 14.1k stars |
| MikroORM core | 7.1.13 | 2020 | 3.8m | 9.2k stars |
| TypeORM | 1.1.0 | 2016 | 19.7m | 36.6k stars |
| `pg` | 8.23.0 | 2010 | 181.8m | 13.2k stars |

Sources: official [npm registry package metadata](https://registry.npmjs.org/kysely), [unscoped npm downloads](https://api.npmjs.org/downloads/point/2026-07-21:2026-08-20/prisma,drizzle-orm,drizzle-kit,kysely,typeorm,pg), [Prisma Client downloads](https://api.npmjs.org/downloads/point/2026-07-21:2026-08-20/%40prisma%2Fclient), [MikroORM downloads](https://api.npmjs.org/downloads/point/2026-07-21:2026-08-20/%40mikro-orm%2Fcore), and the official repositories for [Prisma](https://github.com/prisma/prisma), [Drizzle](https://github.com/drizzle-team/drizzle-orm), [Kysely](https://github.com/kysely-org/kysely), [MikroORM](https://github.com/mikro-orm/mikro-orm), [TypeORM](https://github.com/typeorm/typeorm) and [`pg`](https://github.com/brianc/node-postgres). Values were read on 2026-08-21 and rounded. npm counts are requests, not installations or unique users.

## Owner decision requested

Approve the four-day **Kysely target / Drizzle fallback** spike and the migration/mixing policies above. A final ADR should be written only after the spike records its SQL, concurrency, migration, drift and overhead evidence.
