# ContentAccess authorization specification v1

Статус: decision-ready repository-local specification для
[#84](https://github.com/sachkov-inside/platform/issues/84), подготовленный по
`origin/main` `30bf750f30dcc7e72363f1a9d5a2caf03b192634` от 2026-08-25. После owner approval
и merge он является repository-local implementation contract для
[#50](https://github.com/sachkov-inside/platform/issues/50), но не production implementation и не
ADR.

## Решение

Platform создаёт один глубокий `ContentAccess` module с единственным внешним interface:

```ts
type AccessCaller =
  | "web"
  | "rest"
  | "mcp"
  | "asset"
  | "download"
  | "playbackToken"
  | "videoAuthorization";

type AccessAuditContext = Readonly<{
  caller: AccessCaller;
  correlationId: CorrelationId;
}>;

type AccessRequest = Readonly<{
  subject: Subject;
  resource: Resource;
  action: Action;
}> & AccessAuditContext;

interface ContentAccess {
  authorize(input: AccessRequest): Promise<AccessDecision>;
}
```

Caller сообщает trusted `Subject`, opaque local `Resource` reference, одну `Action` и
audit context `caller`/`correlationId`. Audit context не влияет на policy outcome.
`AccessCaller` — stable audit taxonomy конкретной boundary, запросившей decision: она
намеренно включает transport callers и resource-delivery adapters и не моделирует
resource или action — для них есть отдельные fields.
Module сам читает актуальные Platform facts о Principal, publication/resource mapping и
`MembershipEntitlement`; caller не передаёт роли, access class, publication state, email,
Telegram state или provider claims. IdP аутентифицирует External Identity, а Platform
авторизует каждую operation. Ни IdP role/claim, ни факт login/linking, ни Telegram decision сами
по себе не дают content access.

Этот interface заменяет текущий Materials-local baseline `ContentAccess`, а не оборачивает его.
Если module удалить, Principal/resource/entitlement policy, reason ordering, freshness и
fail-closed rules разойдутся по Material Reader, preview и будущим delivery callers; поэтому seam
даёт leverage и locality. Tests проходят через тот же `authorize`, что production callers.
Транспортный `TrustedSubject` из `IdentityPrincipals` сужается до access-oriented
`Subject`; current Principal state и grants проверяются за границей caller и не
переносятся в `ContentAccess` как trusted permission snapshot.

`MembershipEntitlements` остаётся отдельным глубоким Platform module за внутренним seam
`ContentAccess`. Он скрывает validation versioned evidence, projection, persistence, freshness,
single-flight и outage behavior за одной access-oriented operation. Внешний Telegram dependency
получает узкий `TelegramMembership` port: deterministic test adapter в #50 и production HTTP
adapter в [#52](https://github.com/sachkov-inside/platform/issues/52) реализуют один interface.
Сам HTTP adapter, Telegram calls и credentials в #50 не создаются.

## Authority и contract provenance

Решение конкретизирует следующие принятые authorities:

- [Platform specification](platform-v1.md) закрепляет Platform-owned
  `ContentAccess`, `MembershipEntitlements`, public/closed load ordering и protected delivery;
- [IdentityPrincipals и Platform Session specification](identity-principals-session-v1.md)
  закрепляет trusted `Subject`, current Principal state и exact permission vocabulary;
- [Platform #48](https://github.com/sachkov-inside/platform/issues/48) задаёт root
  Identity/Authorization delivery contract, а #50 реализует эту specification;
- [Workspace #65](https://github.com/sachkov-inside/workspace/issues/65) задаёт cross-repository
  authority split;
- Workspace contract
  [`identity-membership-v1.md`](https://github.com/sachkov-inside/workspace/blob/91258c67560e27fdffd5e63f48e98e27d973fee2/docs/contracts/identity-membership-v1.md),
  [schema](https://github.com/sachkov-inside/workspace/blob/06130c58f38d030a393d7985e395342fc5379139/docs/contracts/identity-membership-v1.schema.json)
  и
  [fixtures](https://github.com/sachkov-inside/workspace/blob/06130c58f38d030a393d7985e395342fc5379139/docs/contracts/identity-membership-v1.fixtures.json)
  фиксируют `inside.membership-evidence.v1`, five-minute bound и conformance corpus;
- owner-confirmed Workspace
  [ContentAccess research](https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/research/platform-content-access.md)
  остаётся provenance для policy vocabulary и caller safety.

Platform сейчас не содержит vendored schema/fixtures shared contract. #50 должен добавить exact
versioned snapshot в собственную test/runtime authority; build, tests и runtime не читают
Workspace checkout или GitHub. Обновление snapshot является явной совместной migration, а не
floating dependency на `workspace/main`.

## Инвентаризация `origin/main`

| Surface | Реальность на `30bf750` | Следствие для #50 |
|---|---|---|
| Published Material body | Реальный PostgreSQL-backed [`PublishedMaterialReader`](../../apps/backend/src/modules/materials/application/create-published-material-reader.ts) сначала загружает allowlisted public projection, вызывает Materials-local `ContentAccess`, и только после allow загружает exact published revision/body. Closed deny возвращает teaser; интеграционные tests доказывают отсутствие protected bytes и `private-no-store` для allow. | Первый реальный protected consumer уже существует. #50 заменяет injected baseline новым module и сохраняет authorize-before-body-load. #31 закрыт и больше не blocker. |
| Material preview | Реальный `previewRevision` вызывает `ContentAccess` до body load, но сначала читает revision header и передаёт caller-supplied `publication/access` facts в policy. | Первый real privileged consumer существует. #50 переносит resource-fact resolution внутрь `ContentAccess`, чтобы private revision metadata не была pre-authorization dependency caller. |
| Current ContentAccess | [`content-access.ts`](../../apps/backend/src/modules/materials/application/ports/content-access.ts) поддерживает только anonymous/principal, Material body, `preview/read` и baseline public/author outcomes. `createMaterials` допускает injection, а `MaterialsModule.register` создаёт baseline из `AuthorPolicy`. | Файл является временным seam из #31, не target ownership. Новый Platform-owned module заменяет типы/policy; параллельный compatibility policy не сохраняется. Static composition появляется вместе с #49/#50 real providers. |
| Public projection/cache | `published_materials` и `PublishedMaterialReader` уже отделяют title/summary/taxonomy от body; public/free body может быть `public`, protected result — `private-no-store`. | Сохранить public lookup до authorization, но никогда не добавлять в projection body, private locator, entitlement, decision или credential. |
| Access audit | `material_access_audit_events` записывает только action, actor, resource ids и coarse allow/deny для read/preview. | #50 заменяет или мигрирует этот временный consumer в обязательный ContentAccess audit с stable reason, caller, policy/decision/correlation fields; email, provider refs/tokens и credentials не логируются. Audit не становится authorization input. |
| Asset/Image/File | MaterialBody умеет validate/render local `assetId` references и safe labels. Отдельных `Assets` module, persistence, ready-state, private metadata, upload или delivery interface/endpoints нет. | `Resource` vocabulary резервирует `asset`, но #50 не создаёт Asset adapter, signed URL или dummy production resource. Asset slice начинается только с owning real consumer. |
| Video | MaterialBody умеет validate/render local `videoId` и caption. `Videos` module, Kinescope mapping/status, playback-token и callback отсутствуют. Storybook `Video` fixtures — presentation-only. | `Resource` vocabulary резервирует `video`, но #50 не создаёт Video/Kinescope adapter. `play` conformance активируется с первым owning Video consumer. |
| Web page | Production routes `/`, `/library`, `/map` не читают Material. Material route и real backend adapter отсутствуют; #67 closed as superseded without implementation, а [#89](https://github.com/sachkov-inside/platform/issues/89) теперь владеет одним finished production Reader slice. | #50 не создаёт page. `PublishedMaterialReader` остаётся application test surface; #89 использует его outcome и не повторяет policy. |
| REST | API process содержит только `/health` и result mapping helper; Materials module/controller/read endpoint не подключены. | REST adapter отсутствует. Не создавать speculative controller; первый real REST consumer вызывает тот же `ContentAccess` через owning application interface и получает reason mapping из этой specification. |
| MCP | MCP process содержит config, PostgreSQL и readiness; Materials resources/tools отсутствуют. [#29](https://github.com/sachkov-inside/platform/issues/29) владеет future Material MCP adapter. | Не создавать speculative MCP resource. Service Principal и preview/read semantics фиксируются сейчас, adapter появляется consumer-led в #29. |

`Asset`, `Video`, page, REST и MCP являются подтверждёнными contract consumers, но не существующими
code consumers. Type vocabulary не является разрешением создать их adapters заранее.

## Внешний interface

### Subject

```ts
type Subject =
  | Readonly<{ kind: "anonymous" }>
  | Readonly<{ kind: "human"; principalId: PrincipalId }>
  | Readonly<{ kind: "service"; principalId: PrincipalId }>;
```

`PrincipalId` — opaque checked Platform identifier из trusted `IdentityPrincipals` path #49.
`IdentityPrincipals.resolveSubject` возвращает `TrustedSubject`; trusted composition проецирует
только `principalId` и `principalKind` в этот `Subject`. Human/service kind не приходит
из request body или provider claim. `Subject` не содержит permissions, account status,
Membership, email, `sessionRef`, issuer/subject или Telegram identifiers. Author/admin — personas
с explicit current Platform permissions, не Subject kinds. `ContentAccess` проверяет их
через `IdentityPrincipals.checkPermission`; caller-supplied permission snapshot не является authority.
Service Principal никогда не использует human Membership entitlement и не наследует browser
session; ему нужен explicit permission для каждой privileged content action.

Invalid/expired token, disabled Principal mapping или неподдержанный issuer не должны производить
authenticated Subject. Если adapter ещё не установил trusted Subject, он передаёт `anonymous`
только для действительно optional public authentication; protected transport не превращает
authentication failure в anonymous retry.

### Resource и Action

```ts
type Resource =
  | Readonly<{ kind: "material_body"; revisionId: MaterialRevisionId }>
  | Readonly<{ kind: "asset"; assetId: AssetId }>
  | Readonly<{ kind: "video"; videoId: VideoId }>;

type Action = "read" | "preview" | "download" | "play";
```

Opaque local IDs — единственные caller assertions. `ContentAccess` сам разрешает owning Material,
exact revision, draft/published state, current published pointer, free/membership access class и
Asset/Video attachment. URL, slug, S3 key, Kinescope ID, access class и publication state не входят
в interface. Unknown ID, non-current published revision, cross-revision attachment и invalid
resource/action pair fail closed.

Valid pairs:

- Material body: `read` или `preview`;
- inline image Asset: `read` или `preview`;
- downloadable Asset: `download` или `preview`;
- Video: `play` или `preview`.

`preview` выбирает exact revision/resource и требует content/admin permission. Обычные
`read/download/play` никогда не открывают draft resource, даже admin. Create, revise, validate,
publish, unpublish, taxonomy и owner GO остаются в `MaterialAuthoring` policy.

### Finite AccessDecision

```ts
type AllowReason =
  | "public_resource"
  | "active_membership"
  | "content_permission"
  | "admin_permission";

type DenyReason =
  | "authentication_required"
  | "principal_disabled"
  | "membership_required"
  | "membership_expired"
  | "entitlement_stale"
  | "content_permission_required"
  | "resource_unpublished"
  | "resource_not_found"
  | "resource_mismatch"
  | "resource_action_invalid"
  | "dependency_unavailable";

type AccessDecisionBase = Readonly<{
  decisionId: AccessDecisionId;
  policyVersion: PolicyVersion;
  decidedAt: Instant;
}>;

type AccessDecision =
  | (AccessDecisionBase & Readonly<{
      effect: "allow";
      reason: "public_resource";
    }>)
  | (AccessDecisionBase & Readonly<{
      effect: "allow";
      reason: Exclude<AllowReason, "public_resource">;
      validUntil: Instant;
    }>)
  | (AccessDecisionBase & Readonly<{
      effect: "deny";
      reason: DenyReason;
    }>);
```

Reason codes являются repository-local lower-snake-case representation owner-confirmed Workspace
semantics; adapters не создают новые reasons. `policyVersion` меняется при semantic matrix change,
а не при refactor. `decisionId`/timestamps производит module через injected clock/ID source и
использует для correlation, но они не являются bearer credential.

Каждый non-public allow конечен. `active_membership` не живёт дольше entitlement, а
`content_permission`/`admin_permission` не живут дольше самого раннего known permission,
Principal expiry и versioned finite `permissionDecisionCap` от `decidedAt`. Exact cap — open owner
decision #50: он выбирается до permission-based ContentAccess core code, блокирует
этот slice до выбора и входит в `policyVersion`; Platform Session только идентифицирует
Subject и не является access lease. Five-minute cap применяется к Membership evidence,
а не автоматически к permission-based decisions. Caller не reuse-ит allow для другой
operation; он может только ограничить derived credential ещё более коротким сроком. Public allow
не требует Principal/Membership lookup и может не иметь `validUntil`.

Детерминированный reason precedence:

1. resolve resource/action mapping; вернуть `resource_not_found`, `resource_mismatch`,
   `resource_action_invalid` или `resource_unpublished`;
2. published free normal delivery получает `public_resource` без private Principal/entitlement
   lookup;
3. protected anonymous operation получает `authentication_required`;
4. unavailable required Platform fact получает `dependency_unavailable`;
5. disabled Principal получает `principal_disabled`;
6. current `materials:author` разрешает content read/preview с `content_permission`;
   если у того же Principal есть `identity:admin`, reason — `admin_permission`;
   `identity:admin` без `materials:author` ничего не открывает, а `materials:publish` не участвует в
   content access;
7. preview без permission получает `content_permission_required`;
8. human normal closed delivery проверяет current entitlement; service Principal без explicit
   permission получает `content_permission_required`, не Membership lookup;
9. no current/history → `membership_required`, confirmed ended membership →
   `membership_expired`, stale positive after failed refresh → `entitlement_stale`.

Transport скрывает resource oracle: page возвращает public teaser/coarse state; REST/MCP обычно
маппит missing authentication в `401`, known authorization deny в `403`, unsafe unknown/mismatch в
`404`, dependency outage в `503`; download/playback не выдаёт redirect, bytes или token на любой
deny. Internal reason не попадает в public analytics/UI copy.

## Stable access matrix

`Author` и service-with-permission columns подразумевают `materials:author`.
`Admin` подразумевает одновременно `materials:author` и `identity:admin`; один
`identity:admin` не даёт Material access. Active/expired Membership применяется только к human Principal.

| Resource / action | Anonymous | Human non-member | Active member | Expired member | Human author | Human admin | Service, no permission | Service, explicit content permission |
|---|---|---|---|---|---|---|---|---|
| Published free body `read` | Allow `public_resource` | Allow `public_resource` | Allow `public_resource` | Allow `public_resource` | Allow `public_resource` | Allow `public_resource` | Allow `public_resource` | Allow `public_resource` |
| Published free inline Asset `read` | Allow `public_resource` | Allow `public_resource` | Allow `public_resource` | Allow `public_resource` | Allow `public_resource` | Allow `public_resource` | Allow `public_resource` | Allow `public_resource` |
| Published free file `download` | Allow `public_resource` | Allow `public_resource` | Allow `public_resource` | Allow `public_resource` | Allow `public_resource` | Allow `public_resource` | Allow `public_resource` | Allow `public_resource` |
| Published free Video `play` | Allow `public_resource` | Allow `public_resource` | Allow `public_resource` | Allow `public_resource` | Allow `public_resource` | Allow `public_resource` | Allow `public_resource` | Allow `public_resource` |
| Published membership body `read` | Deny `authentication_required` | Deny `membership_required` | Allow `active_membership` | Deny `membership_expired` | Allow `content_permission` | Allow `admin_permission` | Deny `content_permission_required` | Allow `content_permission` |
| Published membership Asset `read/download` | Deny `authentication_required` | Deny `membership_required` | Allow `active_membership` | Deny `membership_expired` | Allow `content_permission` | Allow `admin_permission` | Deny `content_permission_required` | Allow `content_permission` |
| Published membership Video `play` | Deny `authentication_required` | Deny `membership_required` | Allow `active_membership` | Deny `membership_expired` | Allow `content_permission` | Allow `admin_permission` | Deny `content_permission_required` | Allow `content_permission` |
| Published free/membership revision/resource `preview` | Deny `authentication_required` | Deny `content_permission_required` | Deny `content_permission_required` | Deny `content_permission_required` | Allow `content_permission` | Allow `admin_permission` | Deny `content_permission_required` | Allow `content_permission` |
| Draft body/Asset/Video `preview` | Deny `authentication_required` | Deny `content_permission_required` | Deny `content_permission_required` | Deny `content_permission_required` | Allow `content_permission` | Allow `admin_permission` | Deny `content_permission_required` | Allow `content_permission` |
| Draft through normal `read/download/play` | Deny `resource_unpublished` | Deny `resource_unpublished` | Deny `resource_unpublished` | Deny `resource_unpublished` | Deny `resource_unpublished` | Deny `resource_unpublished` | Deny `resource_unpublished` | Deny `resource_unpublished` |

Additional matrix rules:

- disabled Principal keeps anonymous access to published free resources, but receives
  `principal_disabled` for every private privilege;
- unknown local resource → `resource_not_found`; wrong revision attachment →
  `resource_mismatch`; invalid pair → `resource_action_invalid`;
- author preview does not imply publish permission or recorded owner GO;
- active Membership does not grant preview, draft, authoring or admin operations;
- an unlinked/conflicted human has no entitlement and follows non-member access; Account UI may
  show a more specific recovery state outside `ContentAccess`.

Asset/Video rows являются conformance contract, не assertion об их наличии на `origin/main`.

## MembershipEntitlements и TelegramMembership

Минимальный access-oriented interface скрывает весь refresh protocol:

```ts
interface MembershipEntitlements {
  resolveForAccess(principalId: PrincipalId): Promise<MembershipAccessState>;
}

interface TelegramMembership {
  check(input: Readonly<{
    principalRef: MembershipPrincipalRef;
    afterEvidenceVersion?: number;
  }>): Promise<unknown>;
}
```

`MembershipAccessState` — internal finite Platform state (`active` с `validUntil` и audit refs,
`required`, `expired`, `stale`, `unavailable`), не wire evidence и не UI DTO. `check` возвращает
`unknown`, потому что owning module обязан strict-validate the vendored v1 schema, principal
binding, clock and monotonic version before accepting evidence. `MembershipPrincipalRef` — opaque
Platform-issued integration reference, не email/raw Principal ID. Consumer-side binding
`PrincipalId -> MembershipPrincipalRef` принадлежит `MembershipEntitlements`, а не
`IdentityPrincipals`: #50 доказывает его с deterministic fixture binding, а #52 подключает
real link lifecycle и HTTP adapter.

`resolveForAccess` выполняет:

1. read current projection and link binding;
2. return current positive entitlement only while `now < validUntil`;
3. when absent/stale or explicit refresh is requested, claim one refresh generation for this
   Principal;
4. call `TelegramMembership` outside database transaction;
5. strict-validate and atomically compare/apply newer evidence;
6. re-read the committed projection and return finite Platform state.

### Projection and freshness

- Accepted `member/chat_member` creates an `inside_membership` entitlement with
  `validUntil <= checkedAt + 5 minutes` and never later than evidence `validUntil`.
- Accepted newer `not_member/chat_not_member` atomically replaces a still-fresh positive and denies
  all new protected operations immediately after commit. It does not delete Principal, link,
  Account, profile, history or reading state.
- `identity_not_linked`, `identity_conflict` and `unavailable` never create entitlement.
- Expired, malformed, unsupported, principal-mismatched or replayed evidence never extends or
  replaces current projection. An already accepted positive may continue only to its original
  `validUntil`; after that access denies.
- Identical retry of the same `evidenceRef`/version/effect is idempotent. A lower version, or equal
  version with a different effect/reference, is `replayed_evidence` and cannot overwrite state.
- Rejoin accepts a newer positive version without relink or new Principal.
- `validUntil` comparison uses injected UTC clock and half-open semantics: active only while
  `now < validUntil`; at equality it is expired.

### Single-flight and outage

Single-flight key is one `MembershipPrincipalRef`, not route/resource. One process-local Promise
is insufficient in a multi-instance backend, so projection persistence owns a short refresh lease
and generation:

1. short transaction claims an expired/free lease with compare-and-set and commits;
2. lease owner calls adapter without holding a PostgreSQL transaction/row lock;
3. waiters observe the generation and re-read after bounded wait; they do not call provider;
4. owner applies evidence by monotonic version CAS in a second short transaction and releases the
   lease;
5. timeout/crash lets the lease expire; no request infers Membership from the lease itself.

While a positive entitlement is still fresh, adapter/store outage may use it only until its
unchanged `validUntil`. Missing or stale evidence fails closed. A stale positive plus unavailable
refresh maps to `entitlement_stale`; an unreadable required Platform store maps to
`dependency_unavailable`. There is no grace-period extension, local role fallback or provider
stampede.

The #50 deterministic adapter scripts named responses/concurrency and passes the vendored fixture
corpus. #52 production HTTP adapter later adds authentication, timeout/retry and wire validation at
the same port; raw Telegram models never enter Platform domain.

## Authorize-before-load, cache and credentials

### Material body and preview

Published delivery order:

1. Resolve optional trusted Subject.
2. Load only allowlisted `PublicMaterialProjection` by slug.
3. Call `authorize(subject, material_body(revisionId), read)`; `ContentAccess` independently
   verifies current published pointer/access.
4. On deny, return projection + coarse state. Do not load revision/body.
5. On allow, load exact revision/body and render.
6. Public free result may enter shared cache; every Subject/permission/Membership allow is
   `private, no-store`.

Preview order:

1. Resolve trusted human/service Subject and parse opaque Material/revision IDs.
2. Call `authorize(..., preview)` before revision header, metadata or body is loaded by caller.
3. On allow, load exact revision and render with `private, no-store`; on deny return no revision
   projection.

Caller не кэширует `AccessDecision`. `ContentAccess` may cache internal resource facts only by
version/current-published pointer and entitlement only to its `validUntil`; policy-version or
resource-pointer change invalidates relevant internal entry. Protected speculative prefetch,
static generation, shared route/data cache and `Vary: Cookie` as sole protection are forbidden.

### Asset/download/video ordering

When real consumers appear:

1. Parse opaque local Asset/Video ID; do not load private locator/provider metadata.
2. `ContentAccess` resolves safe minimal mapping facts and authorizes exact Subject/Resource/Action.
3. Deny returns no private metadata, bytes, redirect, player config or credential.
4. Allow then loads private locator/provider mapping.
5. Delivery adapter mints a credential bound to the exact Subject, Resource and Action with expiry
   `min(decision.validUntil, adapterDeliveryCap)`; public free delivery follows its separate public
   object policy.
6. Playback callback re-authorizes; any deny, timeout or dependency failure denies playback.

Object-storage/Kinescope mechanism and exact delivery caps belong to their owning production
proofs. #50 does not invent those adapters.

## Audit and correlation

`ContentAccess` обязательно эмитит audit event для каждого protected allow/deny,
author/admin preview и dependency failure. High-volume `public_resource` allow может быть
metrics-only; public deny аудируется, если он показывает probing или configuration
error. Internal `AccessAudit` port получает событие из того же module, который
сформировал decision; route или delivery adapter не собирает duplicate audit сам.

Minimum event содержит `decisionId`, `decidedAt`, `effect`, `reason`, `action`, `caller`,
opaque Subject/resource identifiers, `policyVersion`, `correlationId`, latency class и — только
если entitlement участвовал — evidence reference/version/`validUntil`. Email, names, raw
Platform/Telegram identifiers, sessions, authorization headers, signed URLs, JWTs, query strings,
provider tokens, IP и User-Agent запрещены. `caller` и `correlationId` — audit context, а не
policy inputs.

Audit sink outage не превращает deny в allow и не меняет уже вычисленный decision:
adapter использует bounded buffer/best-effort telemetry и alert. Production protected paths не
получают GO, пока required events не доказаны и не защищены от sensitive data.

## Persistence, composition and tests

Recommended ownership after #49 merge:

```text
apps/backend/src/modules/
  content-access/             # external authorize interface + policy implementation
  membership-entitlements/   # evidence projection, refresh coordination, TelegramMembership port
  identity-principals/       # #49 trusted Subject, status and permission facts
  materials/                 # Material facts/reader/preview consumer; no Membership policy
```

`ContentAccess` and `MembershipEntitlements` are in-process modules in the same modular monolith,
not packages/processes. PostgreSQL implementations stay internal and use existing Platform
database/migration authority. `ContentAccess` не читает Materials tables напрямую. Он
объявляет access-oriented `MaterialResourceFacts` port, а Materials-owned adapter
реализует его поверх internal persistence и возвращает только minimal
revision/publication/access facts. Так Materials хранит ownership своих tables,
caller не передаёт policy facts, а dependency в code остаётся однонаправленной:
Materials adapter реализует ContentAccess-owned port. #50 добавляет только real Material
port; будущие Assets/Videos добавляют свои facts adapters только вместе с real
consumers. Generic `ResourceRepository`, policy engine, UoW или in-memory Materials store
остаются rejected hypothetical seams. Tests адаптера используют real PostgreSQL.

The only new remote port is `TelegramMembership`, justified by deterministic test and production
HTTP adapters. Clock/ID sources and contract fixture adapter are internal test seams, not exported
through `ContentAccess`. Nest entrypoints bind one canonical assembly; page/REST/MCP never import
implementation or persistence paths.

Required tests:

- pure exhaustive policy table for every allow/deny reason through `ContentAccess.authorize`;
- real-PostgreSQL Material Reader/preview acceptance proving no body/private metadata load on deny;
- vendored Workspace fixtures through `MembershipEntitlements.resolveForAccess` and deterministic
  `TelegramMembership` adapter;
- just-before/at/after expiry, removal, rejoin, identical retry, replay, principal mismatch,
  malformed/unsupported evidence and fresh/stale outage;
- concurrent stale requests prove one adapter call, durable lease takeover after failure and
  monotonic final state;
- service Principal never consumes Membership; disabled Principal loses private permissions;
- cross-caller corpus expands only when page/REST/MCP/Asset/Video adapters actually exist;
- cache/response tests prove closed bytes/IDs/credentials absent and Subject A never receives
  Subject B protected result;
- every protected allow/deny, preview и dependency failure проходят через `AccessAudit`
  с exact `caller`/`correlationId`/reason/policy fields и без prohibited identity, session и provider data.

Old baseline-policy unit tests are deleted once equivalent tests pass through the new external
interface. Existing Materials lifecycle tests are adapted, not layered with a second policy fake.

## Consumer-led slices for #50

1. **Contract and vocabulary.** Vendor exact v1 schema/fixtures with source commit metadata; add
   branded IDs, finite Subject/Resource/Action/Decision and versioned conformance builder. No
   production adapter.
2. **MembershipEntitlements core.** Add PostgreSQL projection/migration, strict evidence validation,
   deterministic adapter, clock, monotonic replay/removal/rejoin behavior and durable single-flight
   tests. This slice waits for #49's `PrincipalId`/trusted Subject ownership, но сам владеет
   consumer-side opaque Membership binding и не создаёт duplicate identity table.
3. **Platform ContentAccess core.** Implement reason precedence against #49 Principal/permission
   facts, current Material resource facts and MembershipEntitlements. Prove the full Material rows
   plus unavailable/disabled/service cases through one interface.
4. **Replace the real Material consumers.** Remove `createBaselineContentAccess`, caller-supplied
   access/publication facts and preview header-before-authorization. Bind one production
   `ContentAccess` into `createMaterials`/Nest composition; preserve public teaser, exact published
   pointer, private-no-store and audit behavior.
5. **Cross-surface hardening.** Run focused lifecycle/conformance/concurrency/cache tests, root
   checks, guardrails and Standards + Spec review. Record explicit TODO links to #89, #29 and future
   Asset/Video owners; do not scaffold their adapters.

Slices 2–4 may be separate commits inside one #50 PR, but they are not independently releasable
alternate policies. The stopping condition is one provider-neutral protected Material path on the
real reader/preview consumers plus stable interfaces for future consumers.

## Blockers, caveats and rejected alternatives

Design #84 не заблокирован. Для #50:

- [#31](https://github.com/sachkov-inside/platform/issues/31) уже closed и real protected Material
  path существует;
- [#49](https://github.com/sachkov-inside/platform/issues/49) design contract уже merged, но production
  implementation остаётся hard blocker для trusted human/service Subject, Principal status и
  current permissions; opaque Membership binding принадлежит #50/#52, а не #49;
- Assets/Videos/page/REST/MCP не blockers для core Material implementation; они отсутствующие
  consumers и подключаются своими owning tickets;
- production Telegram HTTP adapter и credentialed integration принадлежат #52, поэтому outage and
  contract behavior в #50 доказывает deterministic adapter;
- shared schema/fixtures ещё не vendored; это первый #50 slice, а не runtime dependency на
  Workspace;
- exact finite `permissionDecisionCap` остаётся open owner decision #50 и блокирует
  permission-based policy implementation и derived-credential acceptance до выбора.

Rejected:

- IdP/Telegram roles, session `isMember` или route-local Membership middleware;
- caller-supplied resource access/publication metadata;
- второй compatibility policy поверх Materials baseline;
- generic RBAC/ABAC/policy DSL, multiple tiers or delegated service Membership;
- fake Asset/Video production resources, signed URL/Kinescope placeholders;
- provider call inside a long PostgreSQL transaction;
- stale-positive grace extension, allow-on-error or shared caching of protected outcomes.

Owner выбрал PostgreSQL lease/generation как reversible #50 implementation default для
cross-process single-flight: remote call не держит transaction, а expired lease даёт recovery
после crash. Acceptance property — один refresh на Principal между live instances — остаётся
важнее exact table/query shape. Если implementation proof выявит hard-to-reverse trade-off,
owning application ADR зафиксирует его тогда. #84 не создаёт ADR заранее. Concrete object
delivery, Kinescope enforcement и operational retention также могут потребовать focused ADRs только
после их real proofs.

## Traceability and implementation acceptance

| #50 / shared requirement | Specification contract |
|---|---|
| IdP authenticates; Platform authorizes | Authority section; Subject contains no roles/claims; Principal facts are Platform-owned. |
| One interface for protected resources/callers | Single `authorize` interface с non-policy caller/correlation context; inventory names real and absent consumers. |
| Anonymous/non-member/member/expired/author/admin/service outcomes | Stable matrix and deterministic reason precedence. |
| Authorize before body/private metadata/credentials | Explicit Material/preview and future delivery ordering. |
| Five-minute positive bound | Entitlement validation and `validUntil` cap. |
| Finite author/admin allow | `permissionDecisionCap` обязателен; exact value — explicit #50 owner blocker и policy-version input. |
| Removal/expiry/rejoin/replay | Monotonic projection rules and vendored fixtures. |
| Stale outage fails closed | Fresh-only use, no grace, `entitlement_stale`/`dependency_unavailable`. |
| Single-flight refresh | Durable lease/generation without remote call in transaction. |
| Test and HTTP adapters share one port | Deterministic adapter in #50, production HTTP adapter deferred to #52. |
| No speculative resource adapters | Asset/Video/page/REST/MCP are explicitly absent and consumer-led. |
| Provider-neutral implementation stopping condition | Real PublishedMaterialReader + preview use one Platform module; baseline policy removed. |

Owner approval of this specification authorizes #50 implementation only after #49 supplies its trusted
Subject contract. It does not approve provider selection, Telegram HTTP calls, production
credentials/deploy, Asset/Video delivery mechanisms or merge.
