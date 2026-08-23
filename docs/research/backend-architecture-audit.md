# Backend architecture audit

Статус: принятое архитектурное направление и research evidence для
[Platform #58](https://github.com/sachkov-inside/platform/issues/58), 2026-08-23.

Владелец подтвердил направление в обсуждении #58. Material-specific implementation и
синхронизация durable contract находятся в
[PR #57](https://github.com/sachkov-inside/platform/pull/57); repository-wide guardrails и единый
config/database lifecycle вынесены в [#60](https://github.com/sachkov-inside/platform/issues/60) и
[#61](https://github.com/sachkov-inside/platform/issues/61), чтобы не смешивать независимые
delivery scopes.

Этот документ исследует backend `origin/main` на commit
`1d099a0842077319b9b23e91ed5b0ce1858b0c82` и незамерженный candidate
[PR #57](https://github.com/sachkov-inside/platform/pull/57) на commit
`121c71211692ad2fc091a20210e9b1975fc5addf`. Exact file map ниже остаётся историческим snapshot
до принятого refactor; normative architecture находится в specification и ADR, а backlog — в
tracked issues.

## 1. Рекомендуемый вывод

Platform уже выбрал правильный крупный контур: один NestJS modular monolith, тонкие process
entrypoints, один глубокий Materials vertical module, явные application capabilities, Kysely без
ORM aggregate magic, immutable revisions и проверка PostgreSQL-семантики на real database. Это
следует сохранить.

Основной долг не в отсутствии `.NET`-подобных классов. Он в том, что публичный contract и
composition пока менее глубокие, чем доказанная реализация:

1. `MaterialDocumentV1`, `RenderedMaterialDocumentV1`, `ContentAuthoring` и
   `PublishedMaterials` говорят языком storage/implementation или слишком общим языком вместо
   domain `Material`.
2. Публичный `index.ts` экспортирует слишком много внутренних document shapes и production
   factories, которые принимают concrete `PlatformDatabase`.
3. Один широкий `ContentAuthoringError` делает каждый method статически способным вернуть чужие
   ошибки и ослабляет exhaustive adapter mapping.
4. `MaterialsModule.register(authorPolicyObject)` использует DynamicModule для передачи production
   policy instance, хотя Nest предназначает dynamic modules прежде всего для import-time
   customization; composition root и capability module из-за этого смешаны.
5. Use cases корректно владеют transaction, но SQL locks и persistence orchestration распределены
   между `application` и `infrastructure`, а `application/shared` становится техническим складом.
6. Backend пока не включён в принятый strict typed-lint baseline; nominal IDs и exact optional
   semantics отсутствуют.
7. `Material` как interface плюс `restoreMaterial*` почти не владеет поведением. Это не rich domain
   model, но и не честный immutable snapshot.

Target proposal: сохранить **один Materials module** и две caller-oriented public facets
(`MaterialAuthoring` и read-only published facet), оставить Nest/Kysely/Tiptap внутренними деталями,
использовать method-specific result unions и branded IDs, убрать `V1` из публичного языка, но
оставить version discriminator в persisted body format. Внутри нужен selective rich domain:
`MaterialRevisionMetadata` и opaque `MaterialBody` владеют своими invariants, а `Material` либо
владеет lifecycle transitions, либо не существует как shallow aggregate-shaped wrapper. Не
добавлять generic repositories, command bus, abstract base classes или отдельный
`ContentSchemaModule`, пока у них нет внешнего consumer или реальной вариативности.

## 2. Authority и классификация рекомендаций

Repository authority:

- [`CONTEXT.md`](../../CONTEXT.md) владеет словами `Material`, `MaterialRevision`, `CurrentDraft`,
  `Topic`, `Format`, `Tag`, `Series`, `Principal` и access concepts.
- [ADR 0001](../adr/0001-one-backend-multiple-entrypoints.md) фиксирует один backend codebase с
  тонкими `api`, `worker` и `mcp` entrypoints.
- [Platform v1 specification](../specifications/platform-v1.md#engineering-organization-and-write-contract)
  является authority для application interfaces, real PostgreSQL testing, application-owned
  transactions, versioned ProseMirror JSON и no-speculative-extraction rule. Связанный
  [research artifact](platform-v1-engineering-contract.md) содержит только evidence и rationale.
- #58 требует отделять stack constraints, correctness constraints и project choices; это разделение
  используется во всём документе.

| Класс утверждения | Что действительно обязательно | Что не следует выдавать за universal best practice |
|---|---|---|
| Framework constraint | Nest видит runtime provider token; module экспортирует provider для внешней видимости; lifecycle hook требует зарегистрированный provider и корректное shutdown | «Каждый use case обязан быть `@Injectable()` class»; «каждый feature обязан быть DynamicModule» |
| Language constraint | TypeScript structural, types erased; runtime input нужно проверять; interface не создаёт runtime token | «Все domain values должны быть classes»; «plain functions не подходят для domain logic» |
| Safety/correctness | Untrusted payload parse; fail-closed access; transaction-scoped queries; DB constraints/races; complete transaction retry; exhaustive safe rendering | Любое конкретное folder name, class suffix или repository pattern |
| Project design choice | Modular monolith, capability names, lock order, result taxonomy, persisted body version, public import seams, real-Postgres acceptance | Представлять выбранный вариант как требование Nest/Kysely/Tiptap |
| Style/AI navigation | Один очевидный public entrypoint, semantic filenames, no junk drawer, bounded files, architecture tests | Фиксированный лимит строк или универсальная «идеальная» directory tree |

### Явная delta к принятому #27 contract

#27 принял `ContentAuthoring` и `ContentSchema` как отдельные capabilities и иллюстрировал их
отдельными Nest modules. Фактические #30 и #31 дали новый implementation evidence: schema operations
пока потребляются только Materials workflows, а единственная внешняя граница — Materials public
interface. Поэтому этот draft **осознанно переоткрывает только module/public-boundary часть**:
оставить отдельный internal `MaterialBodySchema` interface, но не экспортировать speculative
`ContentSchemaModule` до независимого consumer. Versioned validation/rendering contract,
application-owned transaction и safe renderer не переоткрываются. Это изменение требует explicit
owner decision; оно не должно произойти молча под видом folder refactor.

## 3. Primary-source constraints

### 3.1 TypeScript 6: это JavaScript runtime, а не C# с другим синтаксисом

TypeScript проверяет программу до исполнения, затем стирает типы; compiled JavaScript не содержит
interface/alias/brand validation. Поэтому HTTP, MCP, persisted JSON и provider output остаются
`unknown` до runtime parse независимо от красоты compile-time DTO
([TypeScript: erased types](https://www.typescriptlang.org/docs/handbook/typescript-from-scratch.html#erased-types)).

Type compatibility основана на structural subtyping, в отличие от nominal C#/Java. Объект или
class instance подходит interface по форме, а не по явному nominal declaration
([TypeScript: type compatibility](https://www.typescriptlang.org/docs/handbook/type-compatibility)).
Следствия:

- interface полезен как compile-time contract, но не создаёт Nest token и не удостоверяет value;
- branded IDs полезны для защиты от случайного смешивания `MaterialId`, `RevisionId` и
  `PrincipalId`, но brand сам по себе не runtime validation;
- class оправдан, когда нужен runtime identity, private constructor, state/lifecycle или cohesive
  behavior; для stateless transformation обычная function/object factory не хуже. TypeScript docs
  прямо отмечают, что вместо «static class» обычно достаточно object или top-level function
  ([TypeScript classes](https://www.typescriptlang.org/docs/handbook/2/classes.html)).

Discriminated unions дают narrowing и `never`-based exhaustiveness
([TypeScript narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking)).
Это объективная причина сохранить `{ ok: true } | { ok: false }` и closed error unions, но не
причина иметь один maximal error union на все methods.

`exactOptionalPropertyTypes` различает отсутствующее поле и присутствующее `undefined`
([TSConfig: exact optional properties](https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html)).
Для patch commands это correctness benefit: «не менять access» и «передать undefined» не должны
случайно становиться одним состоянием.

### 3.2 NestJS 11: modules — runtime composition и encapsulation boundary

Nest module encapsulates providers by default; наружу видны только explicitly exported providers,
и эти exports являются public API module
([Nest modules](https://docs.nestjs.com/modules)). Custom provider может использовать class,
value, factory или existing provider, а token может отличаться от implementation class
([Nest custom providers](https://docs.nestjs.com/fundamentals/custom-providers)). Следовательно,
Symbol tokens для ports — нормальный framework mechanism; interface без token недостаточен.

Dynamic modules дают importer API для customization module behavior/configuration
([Nest dynamic modules](https://docs.nestjs.com/fundamentals/dynamic-modules)). Это возможность, а не
требование для каждого capability. В Nest 11 identity dynamic module зависит от object reference;
повторное создание metadata может дать несколько module instances в tests/import graph
([Nest 11 migration guide](https://docs.nestjs.com/migration-guide)). Для project-owned
`MaterialsModule` без нескольких production configurations static module проще и яснее; если
позже понадобится configurable library boundary, решение можно пересмотреть.

Providers singleton-scoped по умолчанию, поэтому pool/client lifecycle должен принадлежать одному
provider, а не создаваться неявно в каждом consumer
([Nest injection scopes](https://docs.nestjs.com/fundamentals/injection-scopes)). Nest вызывает
shutdown hooks только для registered lifecycle objects и при `app.close()` или enabled shutdown
hooks
([Nest lifecycle events](https://docs.nestjs.com/fundamentals/lifecycle-events)).

Nest testing utilities разрешают provider/module override и application-context wiring tests
([Nest testing](https://docs.nestjs.com/fundamentals/testing)). Это поддерживает отдельный thin
composition test, но не заменяет application acceptance на real PostgreSQL.

### 3.3 Kysely и PostgreSQL: typed SQL не равен domain validation

Kysely предоставляет compile-time table/column/result typing и допускает generated types от DB
schema ([Kysely official overview](https://www.kysely.dev/)). Это сильная concrete persistence
boundary, но её TypeScript types также стираются; database rows и JSONB должны гидратироваться через
domain/runtime validation.

Kysely callback transaction выполняет все queries, начатые через полученный `Transaction`, в одной
transaction; exception приводит к rollback и повторному throw, normal return — к commit
([Kysely transaction API](https://kysely-org.github.io/kysely-apidoc/classes/Kysely.html#transaction)).
Это подтверждает текущий `AuthoringRollback` mechanism, но не предписывает его имя или class shape.

В PostgreSQL default `Read Committed` каждый command видит snapshot начала command, поэтому
многошаговый workflow нельзя считать атомарным без transaction/locks/constraints
([PostgreSQL transaction isolation](https://www.postgresql.org/docs/18/transaction-iso.html)). Row
locks блокируют competing writers, а consistent lock order — стандартная защита от deadlock;
PostgreSQL всё равно может обнаружить deadlock, который application должен обработать
([PostgreSQL explicit locking](https://www.postgresql.org/docs/18/explicit-locking.html#LOCKING-DEADLOCKS)).

`UNIQUE`, `FOREIGN KEY` и другие constraints являются race-safe database authority
([PostgreSQL constraints](https://www.postgresql.org/docs/18/ddl-constraints.html)). Mapping должен
использовать SQLSTATE и известные constraint names; PostgreSQL предоставляет стабильные codes
([PostgreSQL error codes](https://www.postgresql.org/docs/18/errcodes-appendix.html)). При
`40001` complete transaction logic нужно повторить целиком с начала; автоматический partial retry
некорректен
([PostgreSQL serialization failures](https://www.postgresql.org/docs/18/mvcc-serialization-failure-handling.html)).

### 3.4 Tiptap/ProseMirror: JSON нужен, публичный suffix `V1` — нет

Tiptap JSON — tree из node/mark/attributes; extension names входят в persisted JSON
([Tiptap concepts](https://tiptap.dev/docs/editor/core-concepts/introduction),
[extension names](https://tiptap.dev/docs/editor/extensions/custom-extensions/extend-existing#name)).
Tiptap schema задаёт разрешённые nodes, attributes и nesting, а JSON content checking точнее HTML
checking
([Tiptap schema](https://tiptap.dev/docs/editor/core-concepts/schema)). ProseMirror предоставляет
schema deserialization и recursive conformance check
([ProseMirror model reference](https://prosemirror.net/docs/ref/#model.Node.check)).

Ни Tiptap JSON shape, ни ProseMirror `Node` не требуют application envelope с названием
`MaterialDocumentV1`. Официальный JSON начинается с `{ type: "doc", content: ... }`. Поэтому
`schemaVersion` и имя wrapper — project design choice.

Version discriminator всё же имеет доказанную ценность для immutable revisions: Tiptap migration
между major schemas может потребовать переписать stored node names
([Tiptap v1→v2 stored JSON migration](https://tiptap.dev/docs/guides/upgrade-tiptap-v1#new-names-for-most-extensions)).
PostgreSQL рекомендует даже flexible JSON documents держать в somewhat fixed structure и в целом
предпочитать `jsonb`, если не требуется exact input text preservation
([PostgreSQL JSON design](https://www.postgresql.org/docs/18/datatype-json.html#JSON-DOC-DESIGN)).

Следствие: persisted `format_version = 1` — разумная safety/project choice; suffix `V1` в каждом
публичном TypeScript имени не является best practice и ухудшает domain language.

## 4. Exact current-state map

### 4.1 `origin/main`

```text
entrypoints/api.ts
  -> ApiModule
     -> ReadinessModule
        -> DatabaseProbe token -> PostgresProbe -> own pg Pool

entrypoints/worker.ts
  -> own PgBoss lifecycle
  -> RuntimeModule -> ReadinessModule

entrypoints/mcp.ts
  -> RuntimeModule -> ReadinessModule

MaterialsModule.register(authorPolicy object)      # пока не импортирован entrypoints
  -> PostgresModule -> PLATFORM_DATABASE -> Kysely<DB> + pg Pool lifecycle
  -> CONTENT_AUTHORING
     -> create/load/revise use-case functions
        -> metadata/document domain functions
        -> direct Kysely transaction + semantic persistence functions
        -> PostgreSQL constraints/migrations
  -> internal Tiptap schema adapter
```

Evidence:

- [`api.module.ts`](../../apps/backend/src/entrypoints/api/api.module.ts) и
  [`runtime.module.ts`](../../apps/backend/src/entrypoints/runtime.module.ts) импортируют только
  readiness; Materials остаётся headless production capability.
- [`MaterialsModule`](../../apps/backend/src/modules/materials/materials.module.ts) является
  DynamicModule и принимает уже созданный `AuthorPolicy` value.
- [`ContentAuthoringDependencies`](../../apps/backend/src/modules/materials/application/content-authoring.dependencies.ts)
  содержит concrete `PlatformDatabase`; use cases импортируют transaction/persistence helpers и
  местами строят Kysely queries сами.
- [`PostgresModule`](../../apps/backend/src/infrastructure/postgres/postgres.module.ts) корректно
  владеет `Kysely` lifecycle, но [`PostgresProbe`](../../apps/backend/src/modules/readiness/postgres-probe.ts)
  создаёт второй independent pool.
- [`material-document.ts`](../../apps/backend/src/modules/materials/domain/material-document/material-document.ts)
  публично объявляет structural `MaterialDocumentV1 { schemaVersion: 1; doc: JsonObject }`.
- [`MaterialRevisionMetadata`](../../apps/backend/src/modules/materials/domain/material-revision-metadata.ts)
  — реальный immutable value object с runtime Zod parse и `revise`; напротив,
  [`Material`](../../apps/backend/src/modules/materials/domain/material.ts) — interface с почти
  пустыми restore/freezing functions.
- Backend `tsconfig` включает `strict` и `noUncheckedIndexedAccess`, но
  [`eslint.config.mjs`](../../eslint.config.mjs) применяет `strictTypeChecked` только к web, не к
  backend; `exactOptionalPropertyTypes`, `noImplicitReturns` и backend import boundaries ещё не
  включены.

Configuration сейчас не имеет одного composition owner:

- [`loadRepositoryEnvironment.ts`](../../apps/backend/src/config/load-repository-environment.ts)
  вычисляет repository-relative `.env` path, мутирует process-wide `process.env` и хранит
  module-level `loaded` flag;
- `readApiListenConfig(explicitEnvironment)` и `readDatabaseConfig(explicitEnvironment)` всё равно
  сначала вызывают этот side effect, хотя затем могут читать переданный object;
- API читает listen config до создания Nest application, worker отдельно читает database URL для
  `PgBoss`, MCP config не читает, а Nest providers повторно получают database config через свои
  constructors;
- API port валидируется, но database URL получает silent local default при любом runtime mode;
  нет одного parsed immutable `PlatformConfig`, который fail-fast доказывает production values и
  передаётся всем process/resource providers.

Target: process bootstrap один раз загружает environment source, pure parser строит immutable
`PlatformConfig`, а Nest/process adapters получают уже parsed sections. Test с explicit environment
не мутирует global process state. Local defaults разрешены только explicit development/test mode.
Это не требует превращать каждый config section в Nest class: lifecycle owner нужен side effect и
resource wiring, pure validation остаётся function.

### 4.2 Candidate PR #57

PR добавляет `validate`, `preview`, `publish`, `restore`, `unpublish`, safe render/extract,
`ContentAccess`, `PublishedMaterials`, projection tables и publication events. Ключевые files:

- [expanded `ContentAuthoring`](https://github.com/sachkov-inside/platform/blob/121c71211692ad2fc091a20210e9b1975fc5addf/apps/backend/src/modules/materials/application/content-authoring.interface.ts);
- [`PublishedMaterials`](https://github.com/sachkov-inside/platform/blob/121c71211692ad2fc091a20210e9b1975fc5addf/apps/backend/src/modules/materials/application/published-materials.interface.ts);
- [`ContentAccess`](https://github.com/sachkov-inside/platform/blob/121c71211692ad2fc091a20210e9b1975fc5addf/apps/backend/src/modules/materials/application/ports/content-access.ts);
- [publication persistence](https://github.com/sachkov-inside/platform/blob/121c71211692ad2fc091a20210e9b1975fc5addf/apps/backend/src/modules/materials/infrastructure/postgres/lifecycle-persistence.ts);
- [safe renderer/extractor](https://github.com/sachkov-inside/platform/blob/121c71211692ad2fc091a20210e9b1975fc5addf/apps/backend/src/modules/materials/domain/material-document/render-document.ts);
- [real-PostgreSQL lifecycle suite](https://github.com/sachkov-inside/platform/blob/121c71211692ad2fc091a20210e9b1975fc5addf/apps/backend/test/integration/material-lifecycle.test.ts).

Candidate сохраняет safety properties, которые нельзя потерять при refactor:

- access decision выполняется до load protected body;
- published body load проверяет exact current published pointer;
- Material row lock предшествует reference locks в competing write flows;
- publication event, projections, pointer и idempotency effect входят в одну transaction;
- renderer exhaustive по allowlisted nodes/marks и не выполняет author HTML;
- restore создаёт новую immutable revision, а не переписывает историю;
- real PostgreSQL tests доказывают races, rollback и closed-content non-leakage.

## 5. Findings: keep / simplify / deepen / rename / remove

Priority ниже означает architectural risk, а не defect severity PR #57.

| Priority | Action | Область | Наблюдение и proposal |
|---|---|---|---|
| P0 keep | Keep | Transaction/access safety | Сохранить exact-revision, lock order, fail-closed body load, atomic projection/event/idempotency и real PostgreSQL tests как non-negotiable behavior. |
| P0 keep | Keep | Module topology | Сохранить один backend package и один Materials vertical module. Не выделять `ContentSchema`, authoring или reading в deployable/package только из-за folder size. |
| P1 rename/deepen | Rename | Public domain language | `ContentAuthoring` → proposed `MaterialAuthoring`; `PublishedMaterials` → proposed `PublishedMaterialReader`; `MaterialDocumentV1` → `MaterialBody`/`MaterialBodySnapshot`; `RenderedMaterialDocumentV1` → `RenderedMaterialBody`. Final names требуют owner decision. |
| P1 deepen | Deepen | Result contracts | Вынести общий `Result<T, E>`, но определить error union на method, например `PublishRevisionError`, чтобы adapter switch был реально exhaustive. |
| P1 deepen | Deepen | Identity/value types | Brand `MaterialId`, `MaterialRevisionId`, `PrincipalId`, `IdempotencyKey`; создать runtime parsers. Не делать class wrapper на каждый UUID. Рассмотреть `MaterialSlug` value object, потому что у него есть normalization/validation/domain conflict behavior. |
| P1 simplify | Simplify | Nest composition | Заменить `MaterialsModule.register(policyObject)` на static module. Production root binds/imports `AuthorPolicy`, `PublicationPolicy` и `ContentAccess` providers. Dynamic registration оставить только для доказанной import-time configuration. |
| P1 deepen | Deepen | Configuration/resources | Валидировать env один раз в composition root/provider, убрать silent production fallback к local DB, дать readiness probe использовать тот же production database capability/pool. |
| P1 deepen | Deepen | Backend guardrails | Включить compatible strict typed lint/TS flags для backend и architecture import checks. Это уже принято направлением #27, но фактически не реализовано. |
| P2 deepen | Deepen | Domain model | Дать immutable `Material` aggregate только cohesive lifecycle transitions: current-draft CAS, restore-as-new-revision, publish/unpublish CAS. Persistence, authorization, references и idempotency остаются снаружи. Текущие `restoreMaterial*` и shallow `Object.freeze` заменить, а не сохранять параллельно. Не строить class hierarchy ради сходства с .NET. |
| P2 deepen | Deepen | Persistence locality | Оставить Kysely concrete и tests на real DB, но убрать inline SQL из use cases в semantic persistence functions (`lockMaterial`, `advanceDraft`, `writePublication`). Не вводить generic repository/fake UoW. |
| P2 simplify | Simplify | Public exports | `modules/materials/index.ts` должен экспортировать capabilities, tokens и wire DTO only. Production factories с `PlatformDatabase`, internal document resources и persistence types перенести в internal/test composition. |
| P2 deepen | Deepen | Idempotency | Пять lifecycle operations уже доказывают повторяющийся seam. Создать typed idempotency effect per operation и один bounded claim/replay protocol, но не generic command bus. |
| P2 simplify | Simplify | Folders | Убрать generic `application/shared`; разместить fingerprint, idempotency, errors, references рядом с owning concern. `shared` не сообщает агенту ownership. |
| P3 remove | Remove | Hypothetical abstractions | Не добавлять `IMaterialRepository`, `IUnitOfWork`, base entity, domain event bus/outbox, CQRS bus или abstract service без второго implementation/consumer либо отдельного behavior requirement. |

## 6. Functions, classes и domain objects

### Что оставить functions

- document canonicalization, validation issue ordering, render/extract;
- command fingerprinting;
- DTO mapping;
- PostgreSQL query fragments без owned state;
- use-case factories, если Nest provider factory собирает один stable capability object.

Они stateless, легко тестируются и не выигрывают от inheritance или `this`.

### Что оправдывает class/runtime object

- Nest lifecycle provider, который владеет pool/client и `onApplicationShutdown`;
- immutable value object с private construction и cohesive behavior, как metadata/slug;
- error, который нужен именно для runtime transaction unwinding (`AbortTransaction`);
- stateful adapter/provider с resource lifecycle.

### Что не нужно копировать из .NET

Не требуется по одному interface + class на каждый use case, `BaseEntity<TId>`, generic repository,
mapper layer на каждую таблицу или dependency-injected pure function. В TypeScript interface
structural и erased, а Kysely уже даёт compile-time DB schema. Такие abstractions должны окупаться
variation, encapsulated complexity или public seam, а не привычностью.

### Proposed domain shape

```ts
declare const materialIdBrand: unique symbol;
declare const revisionIdBrand: unique symbol;

export type MaterialId = string & { readonly [materialIdBrand]: true };
export type MaterialRevisionId = string & { readonly [revisionIdBrand]: true };

export type Result<Value, Error> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: Error };
```

Brands предотвращают accidental ID swap во внутреннем typed code. `parseMaterialId(unknown)` и
`parseRevisionId(unknown)` всё равно обязательны, потому что types erased. Brand symbols не следует
экспортировать наружу; иначе caller сможет проще обходить intended constructor.
TypeScript предоставляет `unique symbol` как отдельную несовместимую symbol identity
([TypeScript symbols](https://www.typescriptlang.org/docs/handbook/symbols.html#unique-symbol));
конкретное branded-intersection применение остаётся project pattern, не runtime guarantee.

Для current `MaterialRevisionMetadata` есть два допустимых target:

1. оставить immutable class с `create`, `revise`, `toSnapshot`; вынести Zod issue translation в
   codec рядом с class, если domain не должен знать validation-library errors;
2. использовать opaque branded immutable record + pure functions.

Оба соответствуют TypeScript. Рекомендация — первый вариант, потому что metadata уже имеет
cohesive construction/revision invariants. Для `Material` PR #57 теперь даёт достаточное основание
углубить model: `revise`, `restore`, `publish` и `unpublish` разделяют current-draft/publication CAS.
Immutable aggregate должен возвращать typed transitions/effects и не владеть authorization,
idempotency, reference I/O или persistence. Если class не удаляет эту duplicate transition logic,
его не следует сохранять как декоративный wrapper.

## 7. Public capability designs

### Design It Twice: три complete module shapes

До выбора target были независимо спроектированы три варианта с разными optimization goals. Это не
три варианта spelling одного interface: у них различается центр архитектуры и место, где скрывается
сложность.

| Вариант | Центр и внешний interface | Сильная сторона | Основной риск | Решение |
|---|---|---|---|---|
| A. TypeScript-first deep vertical | Одна `createMaterials()` assembly возвращает authoring и published-reading facets; behavior-oriented `internal/` | Минимальный внешний interface, высокая locality, zero framework leakage | Pure model может остаться слишком anemic, если lifecycle rules продолжат дублироваться в use cases | Взять как основу public boundary и canonical assembly |
| B. Selective rich domain | Те же facets, но immutable `Material` aggregate возвращает typed lifecycle transitions; metadata/body — value objects | Максимальная locality CAS/restore/publish invariants, привычная сильная модель без .NET ceremony | Aggregate может дублировать DB или стать god object | Взять value objects обязательно; aggregate — только для уже существующих lifecycle transitions, без persistence/auth/idempotency внутри |
| C. Nest-native composition | Static `MaterialsModule` экспортирует два tokens, один internal runtime provider вызывает canonical assembly | Fail-fast wiring, один graph для API/MCP/worker, один resource lifecycle | Nest TestingModule может стать главным test seam, а feature module — зависеть от ещё не существующих providers | Взять composition adapter и wiring test; real-PG acceptance оставить через тот же framework-free assembly |

Selected hybrid:

1. **Boundary из A:** один deep `Materials` vertical, explicit operations, authoring и published-read
   facets, один framework-free `createMaterials()` construction entry.
2. **Domain depth из B:** opaque validated `MaterialBody`, существующий
   `MaterialRevisionMetadata`, branded IDs и immutable `Material` lifecycle aggregate. PR #57 уже
   содержит четыре согласованных transitions (`revise`, `restore`, `publish`, `unpublish`), поэтому
   seam доказан. Aggregate владеет только transitions и typed effects; persistence, authorization,
   reference checks и idempotency остаются application orchestration. Shallow restore wrappers
   удаляются, а не живут рядом.
3. **Composition из C:** static Nest adapter вызывает ту же `createMaterials()` ровно один раз и
   экспортирует только facet tokens. Nest composition test доказывает production graph; application
   acceptance продолжает доказывать behavior на real PostgreSQL без fake repository.
4. **Не выбранное:** generic command bus, class/token per use case, generic repository/UoW,
   injection token для единственного Tiptap round-trip и отдельный public `ContentSchemaModule` без
   независимого caller.

Этот выбор оптимизирует не минимальное количество files, а стабильность наиболее дорогих seams:
callers, stored body evolution, authorization, transaction boundary и process composition. Внутри
module допустимы mechanical refactors без изменения REST/MCP/tests; снаружи остается маленький
контракт.

### Shape caller-facing facets

#### Candidate A — один façade с named methods (recommended)

```ts
export interface MaterialAuthoring {
  createDraft(command: CreateDraftCommand): Promise<Result<RevisionSnapshot, CreateDraftError>>;
  loadDraft(query: LoadDraftQuery): Promise<Result<RevisionSnapshot, LoadDraftError>>;
  reviseDraft(command: ReviseDraftCommand): Promise<Result<RevisionSnapshot, ReviseDraftError>>;
  validateRevision(query: ValidateRevisionQuery): Promise<Result<ValidationReport, ValidateRevisionError>>;
  previewRevision(query: PreviewRevisionQuery): Promise<Result<MaterialPreview, PreviewRevisionError>>;
  publishRevision(command: PublishRevisionCommand): Promise<Result<PublicationReceipt, PublishRevisionError>>;
  restoreRevision(command: RestoreRevisionCommand): Promise<Result<RevisionSnapshot, RestoreRevisionError>>;
  unpublishMaterial(command: UnpublishMaterialCommand): Promise<Result<PublicationReceipt, UnpublishMaterialError>>;
}
```

Depth: высокий — caller видит одну capability, не знает Nest/Kysely/Tiptap/transactions. Locality:
хорошая — implementation может оставаться по одному use-case file. Test surface: один retained
interface. AI navigation: method name ведёт в одноимённый file. Это сохраняет сильную часть current
design и исправляет только taxonomy/error precision.

#### Candidate B — provider/class на use case

```ts
interface PublishMaterialRevision {
  execute(command: PublishRevisionCommand): Promise<PublishRevisionResult>;
}
```

Плюсы: самый узкий dependency для controller, отдельные Nest override и method-specific types.
Минусы: 8+ public tokens/providers, больше composition ceremony, tests и callers должны собирать
graph, capability как единое целое исчезает. Выбирать только если реальные consumers используют
разные subsets с разными lifecycle/scopes. Сейчас доказательств нет.

#### Candidate C — generic command bus

```ts
interface MaterialsBus {
  execute<C extends MaterialsCommand>(command: C): Promise<ResultFor<C>>;
}
```

Плюсы: centralized middleware/telemetry. Минусы: registry, type-level indirection, ухудшение search и
AI navigation, слабее public semantics. Реального cross-cutting pipeline кроме idempotent writes
нет. Не рекомендован.

### Reading capability

`PublishedMaterials.read()` уже separate consumer-facing contract и не должен сливаться с
authoring:

```ts
export interface PublishedMaterialReader {
  read(
    query: ReadPublishedMaterialQuery,
  ): Promise<Result<PublishedMaterialSnapshot, ReadPublishedMaterialError>>;
}
```

Interface invariant: access decision происходит до load protected body, а возвращаемая revision
должна всё ещё быть exact current published revision. Depth высокий — caller не видит projection
tables, access provider, exact-pointer verification или body renderer. Locality хорошая — один read
workflow и его result contract. Test surface — capability test с real PostgreSQL плюс access
adapter cases. AI navigation — `read-published-material.ts` однозначно соответствует единственному
method.

Рабочее имя `PublishedMaterialReader` сообщает действие точнее текущего collection-like
`PublishedMaterials` и не пересекается с `ReadingActivity`. Имя `MaterialLibrary` исключено:
canonical `ContentLibrary` уже владеет listing, search и navigation; слияние этих boundaries не
входит в #58.

## 8. Material body designs

### Candidate A — public `MaterialDocumentV1` (current)

Плюсы: exact discriminator и simple fixture types. Минусы: имя не говорит «body», `V1` протекает
во все DTO/render types, `doc: JsonObject` structural и может быть constructed без validation,
Tiptap/storage vocabulary становится application vocabulary.

### Candidate B — Markdown/string

Плюсы: human-readable diff, простой plain text path. Минусы: это изменение product behavior и
editor schema, а не naming refactor; tables, callouts, local assets/video, stable block IDs и exact
agent edits потребуют custom syntax/AST. #58 не имеет authority менять lifecycle/body behavior.
Markdown следует сравнивать отдельным prototype только если owner готов сузить structured-content
requirements.

### Candidate C — domain-named body + internal versioned codec (recommended)

```ts
export interface MaterialBodySnapshot {
  readonly format: "tiptap-json";
  readonly formatVersion: number;
  readonly document: JsonObject;
}

// internal only; produced by MaterialBodySchema.parse/hydrate
declare const validatedBody: unique symbol;
type MaterialBody = MaterialBodySnapshot & {
  readonly [validatedBody]: true;
};

interface MaterialBodySchema {
  parse(input: unknown): Result<MaterialBody, InvalidMaterialBody>;
  apply(body: MaterialBody, changes: readonly MaterialBodyChange[]): Result<MaterialBody, InvalidMaterialBody>;
  render(body: MaterialBody): RenderedMaterialBody;
  extract(body: MaterialBody): MaterialBodyExtraction;
}
```

Public/wire snapshot остаётся serializable; internal brand не заменяет parse. Version-specific
`StoredMaterialBodyV1` и migration functions остаются внутри codec/persistence. Если application
всегда отдаёт latest normalized editor format, caller не должен знать union всех historic schemas.

`format: "tiptap-json"` — proposal, не обязательное поле. Оно делает смысл версии яснее:
`formatVersion: 1` означает версию canonical body format, а не API, Material или Tiptap package.
Минимальная альтернатива — просто `MaterialBody { schemaVersion: 1; document: JsonObject }`, без
suffix `V1` в имени.

## 9. Runtime validation и error/result contracts

Current implementation разумно повторно валидирует persisted body при hydration. Это нужно
сохранить: generated Kysely type и JSONB syntactic validity не доказывают ProseMirror/domain schema.

Proposed ownership:

| Boundary | Owner | Result |
|---|---|---|
| HTTP/MCP protocol | adapter | request size, JSON/object shape, protocol authentication; transport-specific error |
| Application command | Materials public codec/use case | branded IDs, idempotency key, semantic patch shape; stable application error |
| Metadata/body | domain codec | normalized validated values, bounded deterministic issues |
| Persistence hydration | Materials PostgreSQL adapter | validate enum/JSON/date and convert to domain; corruption → observable internal failure |
| Durable relations/races | PostgreSQL | FK/UNIQUE/CHECK + mapped known SQLSTATE/constraint |

Не следует импортировать Zod-specific types в public result. Zod — selected implementation. Public
issue path/code должны быть stable project types.

Current `ApplicationResult<Value>` всегда использует весь `ContentAuthoringError`. Proposed:

```ts
type PublishRevisionError =
  | Forbidden
  | MaterialNotFound
  | RevisionNotFound
  | InvalidReference
  | StaleRevision
  | StalePublication
  | IdempotencyKeyReused
  | DependencyUnavailable
  | InternalFailure;
```

Тогда REST/MCP mapper принимает exact method error. Общие small error records можно переиспользовать;
maximal union не нужен. `switch-exhaustiveness-check`/`never` должен ловить новый code во всех
transport mappings.

Нужно отдельно решить naming `invalid_request_shape` vs `invalid_content`: current application
Zod command parse возвращает `invalid_content`, хотя #27 различает protocol shape и domain content.
Recommendation: transport владеет malformed envelope, application — semantic invalid command/body;
не создавать две независимые copies одной Zod schema.

## 10. Nest composition target

### Current tension

`MaterialsModule.register(authorPolicy)` одновременно:

- объявляет capability providers;
- принимает production authorization object;
- импортирует concrete Postgres;
- создаёт baseline ContentAccess;
- используется factory tests обходом Nest, а entrypoints его пока не импортируют.

Это работает, но composition ownership неочевидно.

### Proposed static module

```ts
@Module({
  imports: [PostgresModule, PrincipalsModule],
  providers: [
    materialAuthoringProvider,
    materialReadingProvider,
    materialBodySchemaProvider,
    contentAccessProvider,
  ],
  exports: [MATERIAL_AUTHORING, MATERIAL_READING],
})
export class MaterialsModule {}
```

Root `ApiModule`, `WorkerModule` и `McpModule` импортируют только capabilities, реально нужные
процессу. Provider bindings для external identity/membership принадлежат owning module или root
composition, а не value argument `register()`.

Пока `PrincipalsModule` не существует, headless Stage может использовать explicit local provider
module в test/application composition. Не нужно делать `canPublish?` optional в stable production
port: fail-closed default безопасен transitionally, но silent absence ухудшает wiring proof. Лучше
разделить обязательные `AuthorPolicy`/`PublicationPolicy` либо сделать обе operations required и
доказать binding composition test.

DynamicModule остаётся оправданным для truly configurable reusable infrastructure, например
Postgres test module с supplied connection или external library options. Project feature module не
обязан быть dynamic.

### Configuration и pool lifecycle

Node `process.env` предоставляет string-based environment и `process.loadEnvFile()` загружает
`.env` в `process.env`
([Node environment variables](https://nodejs.org/api/environment_variables.html)). Runtime
validation/default policy остаётся ответственностью Platform.

Proposal:

- один `PlatformConfig` provider parses env до создания dependent providers;
- local default database URL разрешён только в explicit development/test mode;
- `PostgresModule` владеет одним pool/Kysely lifecycle;
- readiness проверяет тот же database capability, который обслуживает приложение, вместо второго
  `pg.Pool`;
- worker `PgBoss` lifecycle остаётся отдельным, потому что это отдельный library-owned connection
  concern.

## 11. Persistence и transaction seams

### Candidate A — direct Kysely everywhere in use cases

Current compromise. Плюсы: SQL/locks видимы, минимум ceremony. Минусы: use-case files знают table
names, lock syntax и generated DB; application/persistence folders обещают separation, которого нет.

### Candidate B — generic repository + unit of work

```ts
interface Repository<TAggregate, TId> { /* ... */ }
interface UnitOfWork { commit(): Promise<void> }
```

Не рекомендован. Он скрывает PostgreSQL operations, плохо выражает append-only revisions,
projections, row locks, idempotency и `ON CONFLICT`, провоцирует fake repository acceptance и
копирует ORM-oriented .NET vocabulary без реальной второй persistence implementation.

### Candidate C — concrete semantic persistence functions (recommended)

Use case продолжает владеть Kysely transaction callback, но вызывает named internal operations:

```ts
await database.transaction().execute(async (tx) => {
  const material = await materialRecords.lockForLifecycleChange(tx, materialId);
  const claim = await idempotency.claim(tx, commandIdentity);
  await revisionRecords.insert(tx, revision);
  await publicationRecords.replaceCurrent(tx, projection);
});
```

`tx` и Kysely остаются internal module details. Semantic functions централизуют SQL, hydration,
lock order и constraint names; они не объявляются public repository port и не мокируются в
acceptance tests. Это сохраняет application-owned atomicity и real-DB evidence, одновременно
делая use case readable как workflow.

Если после двух slices transaction callback всё ещё перегружен infrastructure details, proof gate
может сравнить concrete `PostgresMaterialsStore` class с functions. Interface добавлять только при
реальном втором adapter или test seam, который невозможно доказать real DB.

Lock order следует записать рядом с semantic lock functions и проверить competing-session tests:

```text
Material row -> referenced Series rows (sorted) -> projections/idempotency rows
```

Нельзя полагаться только на comment: test должен создавать conflicting transactions и ограничивать
время завершения.

## 12. Target module map proposal

Это topology sketch, не filename contract:

```text
apps/backend/src/
  entrypoints/
    api/                       # HTTP controllers/mappers/root composition
    worker/                    # pg-boss process adapter
    mcp/                       # MCP process adapter
  config/
    platform-config.ts         # one runtime parser/provider
  infrastructure/postgres/
    postgres.module.ts         # one pool/Kysely lifecycle
    platform-database.ts
    generated/database.ts
    migrations/
  modules/
    materials/
      index.ts                 # ONLY tokens, capabilities, commands/results, wire snapshots
      materials.module.ts      # Nest composition; no business logic
      public/
        material-authoring.ts
        material-reading.ts
        material-contracts.ts
      internal/
        authoring/
          create-draft.ts
          revise-draft.ts
          validate-revision.ts
          preview-revision.ts
          publish-revision.ts
          restore-revision.ts
          unpublish-material.ts
        body/
          material-body.ts
          schema.ts
          changes.ts
          render.ts
          extract.ts
          tiptap-schema.ts
          migrations/
        model/
          material-revision.ts
          material-metadata.ts
          material-ids.ts
        access/
          content-access.ts
        postgres/
          material-records.ts
          revision-records.ts
          publication-records.ts
          idempotency-records.ts
          errors.ts
          migrations/
        composition/
          create-material-authoring.ts
          create-material-reading.ts
    readiness/
      ...                      # probe shared PlatformDatabase capability
```

Why this is agent-navigable:

- external agent starts at one `index.ts` and cannot import `internal` by convention + lint;
- method `publishRevision` maps directly to one file;
- `body`, `access`, `postgres`, `model` name ownership, unlike `shared`;
- Nest composition is physically separate from behavior;
- no artificial package/deployable boundaries or duplicate DTO/domain trees.

Potential simplification: `public/` may be unnecessary if only two files; `index.ts` can re-export
root-level `material-authoring.ts` and `material-reading.ts`. Folder depth is preference, not a
constraint. The important invariant is public/internal import direction.

## 13. Testing and architecture enforcement

### Keep

1. Pure unit tests for body validation/change/render/extract and metadata invariants.
2. Application tests through retained public capabilities + real PostgreSQL.
3. Independent connections for races/deadlocks/rollback/idempotency.
4. Fastify/MCP mapping tests separated from application acceptance.
5. Negative body fixtures and exact current-publication non-leak tests from PR #57.

### Add

1. Nest composition contract: compile each real root module and resolve only expected exported
   tokens; prove required policy binding and one database lifecycle instance.
2. Architecture import test/lint:
   - outside Materials imports only `modules/materials/index.js`;
   - domain/body code imports neither Nest nor Kysely;
   - entrypoints import no Materials internal/postgres files;
   - only approved persistence/migration paths import generated DB/raw Kysely.
3. Type-level fixtures (`tsc`) proving `MaterialId` cannot substitute `RevisionId` and each error
   mapper is exhaustive.
4. Hydration corruption tests: unknown `formatVersion`, invalid access enum, malformed body and
   missing projection relation fail observably without leaking body.
5. One migration compatibility corpus: every persisted body version either parses directly or has
   deterministic/idempotent migration to current format.
6. Test data builders local to `test/support/materials`, чтобы 700+ line lifecycle suite did not
   duplicate setup while preserving scenario readability.

### Mocking policy

- mock/fake только real external variable ports: Identity, Membership/ContentAccess, future
  Assets/Video/provider calls;
- не создавать in-memory MaterialRepository как доказательство PostgreSQL behavior;
- pure body codec можно использовать real во всех application tests;
- Nest provider overrides проверяют adapter/wiring, но не заменяют real-DB acceptance.

## 14. Guardrails proposal

Repository-local, после отдельного compatibility proof:

- backend `strictTypeChecked` + `stylisticTypeChecked`;
- `exactOptionalPropertyTypes`, `noImplicitReturns`, `noFallthroughCasesInSwitch`,
  `noUncheckedSideEffectImports`;
- forbid explicit `any`, unsafe assignment/call/member/return и non-null assertions в owned code;
- enforce exhaustive switches;
- `no-restricted-imports` для Materials public/internal и domain → Nest/Kysely boundaries;
- generated DB file и migrations получают узкие documented exceptions, не global lint disable.

Не вводить arbitrary file-length metric. Большой file — navigation signal, но split должен следовать
ownership/behavior, иначе агент получает больше shallow files без улучшения understanding.

## 15. Durable decision placement

| Решение | Canonical место после owner approval |
|---|---|
| Термин `MaterialBody` | `CONTEXT.md`, если становится durable domain language |
| Capability names/behavior, invariants, access ordering, lifecycle results | application specification |
| Canonical persisted body format/version/migration policy | focused ADR, потому что immutable stored data делает решение hard-to-reverse |
| Transaction authority, lock order и projection atomicity | specification + code/tests; ADR только если выбран surprising transaction abstraction |
| Static Nest module, token spelling, folders, functions/classes | code + architecture tests; обычно не ADR |
| Backend strict flags/lint/import boundaries | repository config + engineering baseline; не product glossary |
| Real PostgreSQL test strategy | engineering baseline/specification; test implementation в code |

Research artifact не должен становиться параллельной canonical architecture после принятия. После
owner decision отдельный documentation slice переносит approved decisions в перечисленные
authorities и оставляет здесь evidence и rationale.

## 16. Independently mergeable improvement slices

Все slices — proposals. Production refactor начинается только после owner approval target.

| Order | Slice | Depends on | Verification |
|---:|---|---|---|
| 1 | Принять naming/module/result/body decisions; обновить glossary/spec/ADR inputs | owner decisions | docs links, Standards + Spec review |
| 2 | Backend strict TS + typed lint + public/internal import rules без behavior changes | 1 public seam names may remain aliases | `pnpm check`, negative architecture/type fixtures |
| 3 | Ввести branded IDs, generic `Result<T,E>` и method-specific errors; сохранить compatibility adapters | 1 | type fixtures, all unit/integration/adapter tests |
| 4 | Сузить Materials public exports; переименовать capabilities с temporary aliases | 1, 3 | import graph, Nest/public factory consumers compile |
| 5 | Убрать `V1` из public names, ввести `MaterialBody` + internal stored-version codec; data unchanged | 1, 3 | full fixture corpus, generated types, no migration/data rewrite unless separately approved |
| 6 | Углубить `Material` до immutable lifecycle aggregate и удалить shallow restore wrappers | 3, 5 | pure transition tests + unchanged real-Postgres lifecycle/race outcomes |
| 7 | Перевести Materials на static Nest composition и required policy providers; добавить wiring tests | 4 | compile api/worker/mcp contexts, token resolution, fail-closed missing binding |
| 8 | Объединить config/database lifecycle и readiness probe вокруг одного PlatformDatabase provider | 7 | health smoke, shutdown test, one-pool wiring assertion |
| 9 | Перегруппировать persistence в semantic Kysely functions, убрать inline SQL/shared junk drawer | 2–6 | exact SQL behavior via all real-Postgres race/rollback suites |
| 10 | Вынести typed idempotency protocol after shape is visible across all five writes | 3, 9 | replay/mismatch/incomplete/rollback tests per operation |

Каждый slice должен быть mechanical или behavior-preserving по acceptance tests. Не совмещать body
format migration, public rename и transaction rewrite в одном PR.

## 17. Explicit owner decisions

1. Принять ли domain naming direction:
   - `MaterialAuthoring` вместо `ContentAuthoring`;
   - `PublishedMaterialReader` вместо `PublishedMaterials`;
   - `MaterialBody` вместо `MaterialDocumentV1`.
2. Оставить ли `formatVersion/schemaVersion` в persisted data, скрыв `V1` из public type names
   (recommended), или действительно отказаться от version discriminator.
3. Принять ли один deep Materials module вместо ранее иллюстрировавшихся отдельных
   `content-authoring`/`content-schema` modules.
4. Принять ли static `MaterialsModule` с required policy providers и composition-root bindings.
5. Принять ли branded string IDs + selective value objects вместо class wrapper на каждый ID.
6. Принять ли method-specific error unions, даже если это добавит несколько aliases.
7. Принять ли immutable `Material` lifecycle aggregate без repository/UoW и без I/O внутри.
8. Подтвердить ли concrete semantic Kysely functions без generic repository/UoW как target
   transaction seam.
9. Разрешить ли отдельные implementation PRs из backlog только после merge/решения судьбы PR #57.

## 18. Unresolved proof gates

- PR #57 не находится в `origin/main`; target synthesis должен решить, audit refactor starts from
  merged lifecycle или адаптируется к revised candidate. Audit не должен merge PR.
- Production `AuthorPolicy`/Membership modules ещё отсутствуют; static Nest composition нельзя
  окончательно доказать до real provider binding, но можно доказать fail-fast wiring contract.
- Нет HTTP/MCP Materials adapters; public DTO/error naming нужно проверить на первом real transport,
  не создавать speculative mapper hierarchy.
- Body format v2 отсутствует. Нужно сохранить version discriminator и fixture migration seam, но не
  писать пустой V1→V2 framework.
- Markdown alternative не оценена against full tables/callouts/assets/stable-node-ID corpus;
  переход нельзя рекомендовать без behavior prototype и owner scope decision.
- Typed lint performance/compatibility под exact locked TypeScript 6/Nest decorators/generated DB
  нужно измерить отдельным config slice.
- Shared pool readiness должен доказать, что health semantics остаются пригодны во время startup,
  shutdown и degraded connection states.
- Semantic persistence regrouping должно сохранить measured lock order и race outcomes; compile-only
  refactor недостаточен.

## 19. Decision handoff

### Recommended conclusion

Принять как target один глубокий, domain-named Materials module: functions для pure workflows,
selective classes/value objects для invariants/lifecycle, static Nest composition, narrow Symbol-token
capabilities, branded IDs, method-specific result unions, concrete Kysely persistence и real
PostgreSQL acceptance. Убрать `V1` из public names, но сохранить persisted body format version и
internal version-specific codec.

### Decisions enabled

Owner может решить naming, public capability shape, body version visibility, class/function policy,
Nest composition, transaction/persistence seam, strict guardrails и порядок independently mergeable
refactors без механического переноса .NET patterns.

### Unresolved proof gates

Сначала определить судьбу PR #57 и подтвердить девять owner decisions выше. Затем каждый production
slice отдельно доказывает compatibility, wiring, body fixtures и PostgreSQL concurrency. До этого
target sections остаются proposals, а current safety behavior PR #57 нельзя ослаблять.
