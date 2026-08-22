# Platform v1 application specification

Статус: подтверждённый repository-local contract для
[Platform #16](https://github.com/sachkov-inside/platform/issues/16), дополненный принятыми
[Platform #27](https://github.com/sachkov-inside/platform/issues/27) engineering decisions.

Дата: 2026-08-22.

## Результат и authority

Platform v1 является каноническим домом материалов Inside. Автор вручную создаёт и публикует
материалы; публичный посетитель находит и читает открытый контент; участник связывает Platform
account с Telegram и получает закрытый контент, пока состоит в каноническом закрытом chat.

Этот документ владеет application contract: capability modules, logical model, flows,
application-level NFR, порядком production foundations и ADR inputs. Продуктовая граница остаётся в
[MVP brief](../product/platform-mvp-brief.md), а канонические термины — в [`CONTEXT.md`](../../CONTEXT.md).
Код, tests и возможные application ADR принадлежат этому repository.

Specification синхронизирует принятую cross-repository
[Workspace #40](https://github.com/sachkov-inside/workspace/issues/40) и более поздние owner
corrections. Workspace links ниже являются provenance, но build, test, runtime и agent work не
читают соседний checkout или Workspace.

## Application boundaries

MVP brief задаёт product scope; здесь зафиксированы только его Platform-owned implementation
consequences:

- Material и его revisions являются единственным canonical content write/read path;
- актуальные Materials создаются вручную, поэтому application model не содержит Telegram source
  identity, import mapping, migration pipeline, deduplication или loss report;
- material-specific Telegram discussion relation не является обязательным полем или application
  invariant;
- admin, REST и MCP используют одни commands, validation, conflicts и publish policy;
- один provider-neutral `ContentAccess` решает read, preview, asset/download и video access;
- PostgreSQL projections обеспечивают Library, Topic/Series navigation, search и related Materials;
- ReadingState не участвует в access decision и сохраняется при окончании Membership;
- owner-controlled Tribute URL является только outbound acquisition destination: Platform не
  интегрируется с Tribute API/webhooks и не использует click/payment state как MembershipEvidence.

Identity provider, отдельная Telegram application и Kinescope являются внешними seams Platform;
их provider types и credentials не входят в application modules. Final information architecture,
typography, palette, layout, motion, component library и остальные visual/UI decisions принадлежат
[Platform #19–#23](https://github.com/sachkov-inside/platform/issues/19). Production frontend
feature implementation начинается только после принятых результатов этого track; headless
foundations и content core могут развиваться параллельно.

## Production baseline и provisional choices

Эти choices являются стартовым production path, а не invitation к повторному comparison или
throwaway prototype:

| Concern | Application contract |
|---|---|
| Runtime/tooling | Node.js 24 LTS, strict TypeScript, pnpm и exact lockfile |
| Web | Next.js App Router + React |
| Backend | один NestJS + Fastify codebase с thin `api`, `worker` и `mcp` entrypoints |
| Application contract | REST + OpenAPI; transports не владеют application rules |
| Transactional store | PostgreSQL 18 |
| Data access | Kysely + `pg`, checked-in migrations as authority и generated DB types |
| Jobs | `pg-boss`; product queue появляется только вместе с первым durable job |
| Search | PostgreSQL FTS с bounded RU/EN normalization и ranking fixtures |
| Content document | versioned ProseMirror JSON, Tiptap adapter, immutable revisions, safe renderer и semantic commands |
| Video | Kinescope за application-owned authorization adapter |

[Platform #17](https://github.com/sachkov-inside/platform/issues/17) и
[#18](https://github.com/sachkov-inside/platform/issues/18) закрыты как superseded horizontal
foundations. Их scope и acceptance распределены по vertical capability tickets
[#30](https://github.com/sachkov-inside/platform/issues/30),
[#31](https://github.com/sachkov-inside/platform/issues/31),
[#28](https://github.com/sachkov-inside/platform/issues/28) и
[#29](https://github.com/sachkov-inside/platform/issues/29). Отдельных Kysely/Drizzle и
ProseMirror/Portable Text comparison stages нет. Если implementation выявляет конкретный blocker,
owning PR фиксирует evidence и migration impact и предлагает smallest production change; два
параллельных data или document path не поддерживаются.

Identity choice остаётся provisional. Текущая application target — Logto OSS с email code,
branded redirect, Next BFF и Nest JWT; Better Auth является fallback при провале UX/protocol proof.
Provider не считается принятым только на основании этой specification: сначала нужны application
proof и отдельное owner decision, а hard-to-reverse trade-off при необходимости фиксируется в
Platform ADR.

## Engineering organization and write contract

[Platform #27 owner decision](https://github.com/sachkov-inside/platform/issues/27#issuecomment-5378336463)
зафиксировал следующие normative implementation decisions. Их primary-source evidence, comparison
и rationale находятся в [#27 research artifact](../research/platform-v1-engineering-contract.md),
но authority остаётся в этой specification.

### Frontend organization

- Next.js-owned `app/` остаётся единственным App Router route/runtime tree.
- Full Feature-Sliced Design адаптируется под App Router в `src/_app`, `src/_pages`, `src/widgets`,
  `src/features`, `src/entities` и `src/shared`.
- Layer или slice создаётся только вместе с реальным code; пустой speculative scaffold не нужен.
- Imports следуют FSD layer direction и slice public interfaces. Server-only и client-safe public
  interfaces разделены; client graph не импортирует server-only implementation.
- FSD применяется только на frontend. Backend не копирует FSD layers.

### Backend modules и application interface

- Один `apps/backend` остаётся modular monolith. Capability modules имеют малые public interfaces,
  internal implementations и явно объявленные dependencies; entrypoints остаются thin adapters.
- Platform-owned PostgreSQL pool/Kysely composition, generated types и один migration authority
  принадлежат `infrastructure/postgres`; capability persistence остаётся internal.
- Новый workspace package, process или separately deployable module допустим только после доказанной
  operational/domain seam. Speculative packages и generic layer folders запрещены.
- `ContentAuthoring` предоставляет explicit `createDraft`, `loadDraft` и `reviseDraft` operations;
  generic command bus не вводится. Cross-module calls используют capability public interfaces.

### Validation, results and write atomicity

- Transport adapter проверяет protocol и input shape и сопоставляет trusted identity с
  `PrincipalId`; он не владеет business rules.
- `ContentAuthoring` владеет permissions, author workflow, metadata policy и координацией reference
  preconditions через public interfaces `IdentityPrincipals`, `Assets` и `Videos`.
- `ContentSchema` владеет versioned document schema, validation, migration, safe render и extraction.
- PostgreSQL constraints владеют durable uniqueness, foreign keys, revision consistency и финальным
  race arbitration.
- Application operations возвращают discriminated transport-neutral results со stable codes.
  REST отображает их в RFC 9457 Problem Details; MCP использует те же codes без HTTP vocabulary.
- Application operation владеет Kysely transaction. `baseRevisionId` реализует optimistic
  compare-and-set; stale base возвращает conflict, blind partial retry и last-write-wins запрещены.
- Idempotency scope — Principal + operation + key. Request fingerprint, stable result/effect и write
  сохраняются в одной transaction; повтор с тем же payload воспроизводит result, другой payload с
  тем же key возвращает mismatch. Caller повторяет uncertain request с тем же key.

### Testing, enforcement and ADR timing

- Pure Material и `ContentSchema` rules покрываются unit tests. Application integration tests идут
  через capability public interface и real PostgreSQL; отдельно проверяются migrations,
  constraints, transaction rollback, idempotency и concurrency. Transport adapters имеют thin
  mapping tests; journey E2E добавляются с реальными surfaces.
- По мере появления owning capabilities membership refresh и provider callbacks получают
  concurrency, idempotency, stale-state и failure-path tests в том же repeatable setup.
- Testcontainers PostgreSQL принят как future test lifecycle direction: один container на
  integration run с isolation, сохраняющей real commit/rollback и multiple-connection semantics.
  Exact dependency version и isolation mechanics принадлежат #30 implementation brief.
- Platform-local shared strict TypeScript base, type-aware typescript-eslint, frontend/backend
  import rules и generated DB type drift checks приняты как future enforcement. #27 не добавляет
  dependencies, lint/config/CI rules и не меняет shared harness.
- #27 не создаёт ADR и отдельные prototype/proof tickets. #30 фиксирует exact versions, types, SQL
  и test isolation в required implementation brief и доказывает их retained vertical slice и
  tests. Focused ADR добавляется в тот же PR только при реально обнаруженном hard-to-reverse,
  non-obvious trade-off.

## Processes и capability modules

| Process | Responsibility | Не владеет |
|---|---|---|
| `web` | SSR/RSC public, member и admin surfaces; BFF session; coarse access states | Membership policy, provider secrets, direct database access |
| `api` | REST/OpenAPI adapters, identity mapping, uploads/callbacks и application commands | route-local domain rules |
| `worker` | durable projection, reconciliation и provider jobs | отдельная domain model или write path |
| `mcp` | authenticated tools/resources поверх application interfaces | SQL, autonomous publish или human Membership identity |

Entry points вызывают одни application use cases и не создают параллельные rule sets.

| Module | Малый interface | Owned facts |
|---|---|---|
| `IdentityPrincipals` | сопоставить trusted external identity с local Principal и permissions | Principal, identity mapping, account status |
| `ContentAuthoring` | create, revise, validate, preview, publish и restore Material | revision pointers, author policy, publish preconditions |
| `ContentSchema` | validate, migrate, safely render и extract projection из versioned document | schema versions, allowlist, fixture corpus |
| `ContentLibrary` | читать projections, search и навигацию, находить related Materials | published projections, ranking и explicit related pins |
| `ContentAccess` | `authorize(Subject, Resource, Action) -> AccessDecision` | provider-neutral policy и reason codes |
| `MembershipEntitlements` | принять MembershipEvidence и построить Platform-owned entitlement | state, validity и refresh coordination |
| `Assets` | начать/finalize upload, связать с revision и ограничить delivery | Asset identity, readiness и immutable resource references |
| `Videos` | upload, status, reconcile, bind и authorize playback | local Video identity и Kinescope mapping/status |
| `ReadingActivity` | idempotently mark read/unread и вернуть recent history | Principal-to-Material reading state; не content access |

Transaction semantics принадлежат единому
[write atomicity contract](#validation-results-and-write-atomicity), а verification seams —
[testing contract](#testing-enforcement-and-adr-timing). External systems получают narrow internal
ports и test adapters. Generic
multi-provider abstraction появляется только со вторым реальным adapter; `ContentAccess` является
provider-neutral потому, что его policy используют несколько delivery callers.

## Logical model и cardinalities

Physical tables, indexes и package paths определяются в production implementation. Logical
entities и invariants v1:

| Entity | Cardinality / invariant |
|---|---|
| `Principal` | одна local identity; 0..1 Telegram link; roles и permissions принадлежат Platform |
| `Material` | stable identity и slug; ровно один current draft; 0..1 published revision |
| `MaterialRevision` | immutable full snapshot; принадлежит ровно одному Material |
| `Topic` | Material имеет ровно один Topic; dictionary одноуровневый |
| `Format` | Material имеет ровно один Format; это primary consumption mode, не Asset kind |
| `Tag` | Material имеет 0..N Tags; managed dictionary поддерживает rename/merge без synonyms-duplicates |
| `Series` | имеет 0..N ordered memberships; Material входит в 0..N Series |
| `SeriesMembership` | пара Series/Material уникальна; ordinal уникален внутри Series |
| `Asset` | принадлежит Platform; MaterialRevision ссылается на 0..N Assets |
| `Video` | local identity с одним Kinescope provider mapping; MaterialRevision ссылается на 0..N Videos |
| `ExternalLink` | typed label + normalized URL; MaterialRevision содержит 0..N links |
| `NavigationPage` | editorial content и curated/query links; Roadmap использует эту роль |
| `MembershipEntitlement` | не более одного current `inside_membership` projection на Principal; validity bounded |
| `ReadingState` | не более одного current state на пару Principal/Material |

`MaterialRevision` содержит application-owned versioned document, metadata snapshot и local
Asset/Video references. HTML, React tree, search text, signed URLs, provider tokens и editor state
являются производными или ephemeral.

Topic, Format, Tag и Series создаются по мере реального authoring; результаты аудита служат
fixtures, а не заранее заданной ontology. Для v1 подтверждены роли:

- «Создание Platform Inside» — ordered Series;
- Roadmap — `NavigationPage`;
- Library — generated view над Materials, не отдельная entity или duplicated content store;
- material-specific Telegram discussion relation отсутствует.

Public Material projection содержит title, summary/teaser, taxonomy, Series и safe media metadata,
но не closed body, private object locator или delivery credential. Published body читается только
через exact published revision; draft resource недоступен через обычные read/download/play paths.

## Application flows

### Authoring и publish

1. Admin или MCP вызывает explicit application operation с identifiers, concurrency и idempotency
   inputs из [write atomicity contract](#validation-results-and-write-atomicity).
2. `ContentAuthoring` проверяет permissions через `IdentityPrincipals`, владеет workflow/metadata
   policy, координирует reference preconditions через `Assets`/`Videos`, делегирует document
   validation/migration в `ContentSchema` и сохраняет immutable revision в одной transaction.
3. Preview читает explicit revision и использует тот же safe renderer и `ContentAccess`, что
   published delivery.
4. Publish только после recorded owner GO повторяет validation и atomically меняет published
   revision вместе с public/search projections и необходимым durable job fact.
5. Concurrency, idempotency и transport outcomes следуют единому
   [write atomicity contract](#validation-results-and-write-atomicity).

### Public и closed read

1. Public route читает только public projection; free body может быть shared-cacheable.
2. Closed route получает Subject из trusted identity и вызывает `ContentAccess` до загрузки body.
3. Deny возвращает public teaser и coarse state; allow читает exact published revision.
4. Closed body, access decision и delivery credentials имеют `private, no-store`; protected
   speculative prefetch запрещён.

### Membership linking и refresh

1. После email-code sign-in Platform предлагает skippable linking; signed-in Principal начинает
   short-lived link transaction сразу, позже из account или из closed-Material recovery flow.
2. Отдельная Telegram application проверяет Telegram identity, uniqueness и Membership в
   каноническом закрытом chat.
3. Platform принимает normalized MembershipEvidence без raw Telegram model и строит собственный
   entitlement не дольше `validUntil` этого evidence.
4. Первый protected request после expiry выполняет single-flight refresh. Positive
   MembershipEvidence живёт не более пяти минут; confirmed removal denies immediately; outage
   после expiry fails closed.

### Assets, downloads и video

1. `Assets` создаёт immutable upload target, а finalize проверяет type, size и checksum; publish
   допускает только ready resources.
2. Closed asset/download проходит `ContentAccess`; short-lived delivery credential связан с одним
   Subject/Resource/Action и не переживает access decision.
3. `Videos` начинает Kinescope upload, считает webhook только hint и сверяет authoritative provider
   state; publish допускает только ready Video.
4. Playback token и strict authorization callback повторно вызывают `ContentAccess`; mismatch,
   stale entitlement и outage дают deny.

### Search, navigation и related Materials

- publish transaction обновляет search projection из title, summary, body/headings, asset labels и
  current metadata; closed body index остаётся server-side;
- PostgreSQL FTS ранжирует title выше summary/headings, затем taxonomy/body/assets и проверяется на
  bounded representative RU/EN corpus;
- filters появляются только из реально используемых Topic, Format и Series;
- related выдача сочетает metadata score и explicit author pins без AI dependency.

### MCP

- MCP аутентифицируется как отдельный service Principal с explicit author permissions;
- tools вызывают те же semantic commands, validation results и conflicts, что admin;
- read/preview resources проходят `ContentAccess`; service Principal не наследует human Membership;
- publish разделён на prepare/execute с отдельным recorded owner GO; autonomous publish запрещён.

## Application NFR

### Security и privacy

- protected paths fail closed; identity, Telegram и provider role не заменяют Platform authorization;
- cookie session использует `Secure`, `HttpOnly` и explicit `SameSite`; mutations проверяют CSRF и Origin;
- issuer, audience и expiry валидируются строго; secrets, tokens и raw sessions не попадают в logs;
- server renderer запрещает raw HTML/MDX, allowlist-ит nodes/URLs и ограничивает document size/depth;
- closed bodies/resources отделены от public projections; protected allow/deny и preview оставляют
  application audit fact только с opaque local IDs.

### SEO

- home, Library, Topic, Series, Roadmap, public cards и free Materials имеют stable canonical URLs,
  server-rendered metadata, sitemap и crawlable internal links;
- closed card может индексироваться, но closed body отсутствует в HTML, RSC, structured data,
  search response и shared cache;
- draft, preview, admin, account и MCP surfaces имеют `noindex` и не входят в sitemap.

### Accessibility и responsive behavior

- critical journeys работают keyboard-only с видимым focus, semantic landmarks/headings,
  accessible names и announced errors;
- editor, tables, code, player, upload progress и access states имеют non-pointer alternatives;
- UI PR содержит mobile/desktop evidence, keyboard + screen-reader smoke и не имеет
  serious/critical findings automated accessibility audit;
- reduced motion, text zoom и narrow viewport не скрывают content или controls.

### Performance и correctness

В repeatable agreed test setup с зафиксированным fixture corpus:

- public server response p95 не выше 800 ms, protected non-video page p95 не выше 1.5 s без
  пользовательского email/Telegram interaction;
- Library search p95 не выше 300 ms на 10 000 Material projections и representative RU/EN set;
- public critical pages укладываются в LCP 2.5 s, INP 200 ms и CLS 0.1 на согласованном mobile profile;
- query plans, pool limits и payload/document limits измеряются до добавления cache/service;
- correctness scenarios из [testing contract](#testing-enforcement-and-adr-timing) входят в
  согласованный fixture corpus и repeatable setup.

## Production foundation order

1. **Local contract:** этот документ, синхронизированный brief и glossary закрывают Platform #16.
2. **Engineering contract:** [#27](https://github.com/sachkov-inside/platform/issues/27) сравнил
   варианты и зафиксировал [engineering organization and write contract](#engineering-organization-and-write-contract).
   [Research artifact](../research/platform-v1-engineering-contract.md) сохраняет evidence и
   rationale; #27 не меняет harness, agent instructions или production code.
3. **Create и revise draft:** [#30](https://github.com/sachkov-inside/platform/issues/30) одним
   production slice добавляет create/load/revise Material, минимальные PostgreSQL/Kysely migrations,
   versioned ProseMirror/Tiptap document path, immutable revisions, metadata, idempotency и conflicts.
   До кода owner утверждает implementation brief с modules/interfaces, file layout, validation flow,
   transaction boundary и tests. До этого решения ticket имеет `ready-for-human`; после approval
   его переводят в `ready-for-agent` перед production implementation.
4. **Validate, preview, publish и read:**
   [#31](https://github.com/sachkov-inside/platform/issues/31) проводит exact revision через safe
   validation/renderer и private preview к owner-approved publish, public/free read, unpublish и
   restore. До кода owner отдельно утверждает lifecycle, projection, transaction и security design;
   readiness так же меняется с `ready-for-human` на `ready-for-agent` только после approval.
5. **Parallel headless consumers:** после #31
   [#28](https://github.com/sachkov-inside/platform/issues/28) поставляет Library/search/navigation,
   а [#29](https://github.com/sachkov-inside/platform/issues/29) — safe agent authoring через thin
   MCP adapter. Они используют принятый engineering contract; новый owner gate нужен только при
   материальном отклонении.
6. **UI gate:** #20 и #21 дают UX/content и owner-taste inputs, #22 получает explicit owner visual
   selection, #23 доказывает bounded component/primitives strategy. Это единственная source of
   visual/UI decisions.
7. **Public experience:** accepted UI foundation применяется к home, Library, Topic, Series,
   Roadmap, free Material и minimal author surface после готовности content core и UI gate.
8. **Identity и protected content:** identity application proof и единый `ContentAccess` покрывают
   closed body, assets, downloads и video через test Membership adapter.
9. **Real Membership:** отдельная Telegram application подключается только после стабилизации
   versioned MembershipEvidence port; Platform сохраняет ownership entitlement и final access
   decision.
10. **Feature-complete candidate:** author/MCP, content, Kinescope, private resources, Membership,
   reading activity и UI journeys проходят end-to-end application verification; актуальные
   Materials вручную созданы без import pipeline.

Текущая application specification не определяет environments, deploy/promotion/rollback,
infrastructure capacity, domains, observability, secrets operations, backup/recovery или production
GO. Отдельная Workspace specification может начаться только после feature-complete candidate, когда
существует измеренный process/data/provider/capacity profile. До этого trigger соответствующие
решения и implementation backlog не создаются.

## ADR inputs

Application ADR создаётся только если production work обнаруживает одновременно hard-to-reverse
choice, неочевидный контекст и реальный trade-off. Возможные inputs, но не обязательные ADR:

- migrations/data authority и transaction seam;
- canonical document schema, revision model, safe renderer и semantic commands;
- identity provider, BFF и token mapping после proof;
- `ContentAccess` placement и conformance surface;
- private Asset delivery mechanism;
- Kinescope upload/reconciliation/strict authorization mechanics;
- UI component/primitives strategy, только если #23 докажет hard-to-reverse trade-off.

## Provenance

- [Platform #27 owner architecture decisions](https://github.com/sachkov-inside/platform/issues/27#issuecomment-5378336463)
- [Workspace Platform v1 specification](https://github.com/sachkov-inside/workspace/blob/main/docs/specifications/platform-v1.md)
- [Workspace #39: current publishing audit decisions](https://github.com/sachkov-inside/workspace/issues/39)
- [Workspace #41: Telegram Membership boundary](https://github.com/sachkov-inside/workspace/issues/41)
- [Workspace #42: Kinescope lifecycle](https://github.com/sachkov-inside/workspace/issues/42)
- [Workspace #54: provider-neutral ContentAccess](https://github.com/sachkov-inside/workspace/issues/54)
