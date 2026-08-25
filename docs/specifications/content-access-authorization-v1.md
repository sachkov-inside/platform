# ContentAccess authorization specification v1

Статус: decision-ready repository-local specification для
[#84](https://github.com/sachkov-inside/platform/issues/84), подготовленный по
`origin/main` `6c19c057c792c2e470607000c9a7f28ce803b932` от 2026-08-25. После owner approval
и merge он является repository-local implementation contract для
[#50](https://github.com/sachkov-inside/platform/issues/50), но не production implementation и не
ADR.

## Решение

Platform создаёт один глубокий batch-first `ContentAccess` module. Module разделяет
неавторитетную availability для presentation и авторитетную authorization непосредственно перед
protected delivery, но обе операции используют одну policy matrix и одни Platform facts:

```ts
type AccessBoundary =
  | "published_material_read"
  | "material_preview"
  | "mcp_material_read"
  | "asset_delivery"
  | "download_delivery"
  | "playback_token_issue"
  | "video_authorization_callback";

type AccessAuditContext = Readonly<{
  boundary: AccessBoundary;
  correlationId: CorrelationId;
}>;

type AccessOperation = Readonly<{
  itemId: AccessItemId;
  resource: Resource;
  action: Action;
}>;

type AccessBatchRequest = Readonly<{
  subject: Subject;
  operations: readonly AccessOperation[];
}> & AccessAuditContext;

interface ContentAccess {
  availabilityMany(input: AccessBatchRequest): Promise<readonly AccessAvailability[]>;
  authorizeMany(input: AccessBatchRequest): Promise<readonly AccessDecision[]>;
}
```

Одна operation является batch из одного элемента. Caller сообщает один trusted `Subject`,
bounded collection opaque local `Resource` references с `Action` и audit context
`boundary`/`correlationId`. `itemId` только связывает input и result, не является resource identity
или credential. Audit context не влияет на policy outcome.
`AccessBoundary` — stable lower-snake-case taxonomy enforcement point, запросившей decision. Она
не смешивает transport с resource/action и не моделирует их повторно — для них есть отдельные
fields. Если operational audit должен различать web/REST/MCP origin одного application use case,
transport добавляет отдельный telemetry attribute, не новый policy input.
Module сам читает актуальные Platform facts о Principal, publication/resource mapping и
`MembershipEntitlement`; caller не передаёт роли, access class, publication state, email,
Telegram state или provider claims. IdP аутентифицирует External Identity, а Platform
авторизует каждую operation. Ни IdP role/claim, ни факт login/linking, ни Telegram decision сами
по себе не дают content access.

`availabilityMany` возвращает только `available | locked | sign_in_required | unavailable` для UI и никогда не
разрешает загрузить body, private locator, redirect или credential. `authorizeMany` возвращает
finite reasoned decision для каждой operation; только этот result может немедленно продолжить ту
же application operation к protected load. Ни availability, ни decision не сериализуются как
bearer capability и не кэшируются между requests.

Этот interface заменяет текущий Materials-local baseline `ContentAccess`, а не оборачивает его.
Если module удалить, Principal/resource/entitlement policy, reason ordering, freshness и
fail-closed rules разойдутся по Material Reader, preview и будущим delivery callers; поэтому seam
даёт leverage и locality. Tests проходят через тот же `authorizeMany`, что production callers.
Транспортный `TrustedSubject` из `IdentityPrincipals` сужается до access-oriented
`Subject`; current Principal state и grants проверяются за границей caller и не
переносятся в `ContentAccess` как trusted permission snapshot.

Canonical test surface использует `authorizeMany`; single-operation helpers являются только
caller convenience wrappers. `MembershipEntitlements` остаётся отдельным глубоким Platform module
за внутренним seam
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

| Surface | Реальность на `6c19c05` | Следствие для #50 |
|---|---|---|
| Published Material body | Реальный PostgreSQL-backed [`PublishedMaterialReader`](../../apps/backend/src/modules/materials/application/create-published-material-reader.ts) сначала загружает allowlisted public projection, вызывает Materials-local singular `ContentAccess`, и только после allow загружает exact published revision/body. Closed deny возвращает teaser; интеграционные tests доказывают отсутствие protected bytes и `private-no-store` для allow. | Первый реальный protected consumer уже существует. #50 заменяет injected baseline batch-first module, сохраняет protected-load-after-allow и добавляет read/readMany fixed-I/O proof. #31 закрыт и больше не blocker. |
| Material preview | Реальный `previewRevision` вызывает `ContentAccess` до body load, но сначала читает revision header и передаёт caller-supplied `publication/access` facts в policy. | Первый real privileged consumer существует. #50 переносит resource-fact resolution внутрь `ContentAccess`, чтобы private revision metadata не была pre-authorization dependency caller. |
| Current ContentAccess | [`content-access.ts`](../../apps/backend/src/modules/materials/application/ports/content-access.ts) поддерживает только anonymous/principal, Material body, `preview/read` и baseline public/author outcomes. Static `MaterialsModule` создаёт anonymous/read-only baseline из `AuthorPolicy`; `createMaterials` допускает injection. | Файл является временным seam из #31/#89, не target ownership. Новый Platform-owned module заменяет provider/types/policy; параллельный compatibility policy не сохраняется. #112 меняет реальный static composition после #49. |
| Public projection/cache | `published_materials` и `PublishedMaterialReader` уже отделяют title/summary/taxonomy от body; public/free body может быть `public`, protected result — `private-no-store`. | Сохранить public lookup до authorization, но никогда не добавлять в projection body, private locator, entitlement, decision или credential. |
| Access audit | `material_access_audit_events` записывает только action, actor, resource ids и coarse allow/deny для read/preview. | #50 заменяет или мигрирует этот временный consumer в обязательный ContentAccess audit с stable reason, enforcement boundary, policy/decision/correlation fields; email, provider refs/tokens и credentials не логируются. Audit не становится authorization input. |
| Asset/Image/File | MaterialBody умеет validate/render local `assetId` references и safe labels. Отдельных `Assets` module, persistence, ready-state, private metadata, upload или delivery interface/endpoints нет. | `Resource` vocabulary резервирует `asset`, но #50 не создаёт Asset adapter, signed URL или dummy production resource. Asset slice начинается только с owning real consumer. |
| Video | MaterialBody умеет validate/render local `videoId` и caption. `Videos` module, Kinescope mapping/status, playback-token и callback отсутствуют. Storybook `Video` fixtures — presentation-only. | `Resource` vocabulary резервирует `video`, но #50 не создаёт Video/Kinescope adapter. `play` conformance активируется с первым owning Video consumer. |
| Web page | Closed [#89](https://github.com/sachkov-inside/platform/issues/89) поставил production `/materials/[slug]` RSC route, server-only backend adapter и finished available/access/not-found/unavailable states. Current web call не передаёт authenticated Subject и использует `no-store` до publish invalidation path. | Page является real consumer результата `PublishedMaterialReader`. #112 сохраняет presentation contract и доказывает, что замок/teaser не является delivery permission; authenticated composition приходит после #49. |
| REST | API process имеет production `GET /materials/:slug` controller, exhaustive result mapping и cache headers; `ApiModule` statically imports `MaterialsModule`. Controller пока всегда передаёт `anonymousSubject`. | REST является real enforcement entrypoint и интеграционным consumer #112. Он вызывает owning `PublishedMaterialReader`, не `ContentAccess` implementation; trusted Subject mapping подключается после #49 без route-local policy. |
| MCP | MCP process содержит config, PostgreSQL и readiness; Materials resources/tools отсутствуют. [#29](https://github.com/sachkov-inside/platform/issues/29) владеет future Material MCP adapter. | Не создавать speculative MCP resource. Service Principal и preview/read semantics фиксируются сейчас, adapter появляется consumer-led в #29. |

Page и REST уже являются real code consumers. `Asset`, `Video` и MCP остаются только
подтверждёнными contract consumers; type vocabulary не является разрешением создать их adapters
заранее.

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

### Requirement, grant и activity facts

Policy сопоставляет четыре finite axis:

```ts
type ContentAccessRequirement =
  | Readonly<{ kind: "public" }>
  | Readonly<{ kind: "membership"; membership: "inside" }>;

type ContentGrantScope =
  | Readonly<{ kind: "platform" }>
  | Readonly<{ kind: "series"; seriesId: SeriesId }>
  | Readonly<{ kind: "material"; materialId: MaterialId }>;
```

- owning resource module хранит current publication/attachment facts и requirement;
- `IdentityPrincipals` хранит current Principal state и permissions;
- `MembershipEntitlements` хранит одну bounded `MembershipEntitlement` projection на Principal;
- `ContentAccess` сопоставляет `Subject × Resource facts × Action × current grants` и владеет
  decision semantics.

V1 не создаёт `Principal × Material` access rows: одна active Membership открывает весь
`membership` class независимо от числа Materials. Будущие tier, purchase или manual grants
добавляются consumer-led как compact scoped facts (`platform | series | material`) с source,
version и finite validity; public interface и batch planner от этого не меняются. Generic policy
DSL, JSON boolean tree и заранее материализованная строка на каждый effective Principal/Resource
rejected.

`ReadingState`, будущие `PracticeAttempt`/completion facts и другие activity projections не
являются authorization inputs и сохраняются после окончания Membership. Если activity когда-либо
должна породить доступ, owning module создаёт отдельный explicit grant fact; `ContentAccess` не
читает mutable progress history в policy.

### Availability и finite AccessDecision

```ts
type AccessAvailability = Readonly<{
  itemId: AccessItemId;
  availability: "available" | "locked" | "sign_in_required" | "unavailable";
}>;

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
  itemId: AccessItemId;
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

Batch содержит один Subject, имеет bounded item count и возвращает ровно один ordered result на
каждый unique `itemId`. Implementation может deduplicate одинаковые Resource/Action facts, но
сохраняет input cardinality/order. Empty batch, duplicate `itemId`, malformed operation и
превышение item/aggregate-byte limit являются request errors; неизвестный Resource и unavailable
policy fact остаются per-item fail-closed decisions.

Availability является coarse deterministic projection тех же facts, но намеренно не раскрывает
internal deny reason или resource oracle:

| Authoritative facts/outcome | Availability |
|---|---|
| Published public resource для любого Subject, включая disabled Principal | `available` |
| Protected resource + active Membership или required content/admin permission | `available` |
| Protected resource + anonymous Subject | `sign_in_required` |
| Protected resource + non-member, expired member, disabled Principal или human/service без required permission | `locked` |
| Stale/unavailable required dependency | `unavailable` |
| Unknown/mismatched/unpublished resource или invalid Resource/Action | `unavailable`; owning Library/page omits stale card or shows coarse retry state |

Author/admin preview следует тем же rows: required permission даёт `available`, её отсутствие —
`locked`. `availabilityMany` не эмитит `decisionId`, `validUntil` или reason. Любой subsequent body,
Asset, download или Video delivery вызывает `authorizeMany` заново с authoritative resource facts.

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

## Batch execution, query selection, cache and credentials

### Performance contract

Implementation запрещает database/provider I/O внутри loop по resources. Для batch из `N`
operations и `K` реально присутствующих resource kinds:

```text
database/provider round trips = O(K), not O(N)
policy CPU                     = O(N)
memory                         = O(N)
```

Batch planner validates/deduplicates operations, группирует их по resource kind, bulk-загружает
facts одним query на kind, один раз разрешает Principal/permissions и только при необходимости один
раз Membership, затем pure-evaluates policy и batch-пишет audit. Future scoped grants также
загружаются одним query по Principal и всем relevant Material/Series keys. Integration test для
`N=1` и `N=100` обязан доказать, что query/provider call count не растёт линейно. Большие sets
используют bounded cursor pages; delivery дополнительно ограничивает aggregate protected bytes.

### Library, activity и availability

Library, Topic/Series navigation, search и related Materials читают allowlisted
`PublicMaterialProjection`; это не protected body delivery. Для page projections module вызывает
`availabilityMany` один раз и получает замочки всей страницы. Current site-wide Membership может
быть hidden-optimized до одного viewer-level entitlement resolution и одного in-memory pass;
никаких per-card Membership/provider calls и protected audit events нет.

Availability является presentation hint: `ContentLibrary` может shared-cache public projections и
накладывать personalized availability после cache, но открытие Material всегда создаёт новую
authoritative operation. `ReadingState` или future practice/progress query может set-based join-ить
свои facts с PublishedMaterial projections, а затем одним batch получить availability; activity
остаётся видимой как locked после окончания Membership.

Если будущий query должен найти только доступные resources до pagination, post-filter page
некорректен. Owning query module тогда использует purpose-built PostgreSQL access selection:
set-based `JOIN/EXISTS` compact current grants/requirements или materialized permission projection.
Этот relational matcher остаётся hidden implementation, проходит тот же conformance corpus и не
выдаёт route/frontend SQL fragment, reusable access profile или bearer scope. V1 не строит такой
generic query framework без первого реального per-resource selection consumer.

### Published body, preview и bulk delivery

Published Material order:

1. Resolve optional trusted Subject and load only allowlisted public projection by slug.
2. Call `authorizeMany` с одним `material_body/read` operation либо bounded batch для bulk read.
3. On deny return projection + coarse state; do not load protected body.
4. On allow load all allowed bodies одним bulk query, обязательно связывая exact revision с
   `current_published_revision_id`; stale/unpublished pointer returns no protected bytes.
5. Render through Materials and preserve one ordered outcome per requested item.

Preview использует exact revision IDs в одном `authorizeMany` batch. Safe minimal resource facts
могут быть загружены внутри `ContentAccess` до decision; caller не получает revision metadata или
body на deny. Normal `read/download/play` никогда не превращает preview permission в draft access.

Для Asset/Video batch planner делает не более одного facts query на owning kind, проверяет
attachment/current revision без private locator, затем delivery module одним bulk query загружает
locators только для allow items. Credential bound to exact Subject/Resource/Action expires at
`min(decision.validUntil, adapterDeliveryCap)`; playback callback/renewal re-authorizes. Concrete
object-storage/Kinescope adapters и caps появляются только с real consumers.

Caller не кэширует availability или `AccessDecision` между requests. `ContentAccess` may memoize
subject facts только внутри одной application operation и cache internal entitlement не дольше
authoritative `validUntil`; this profile не экспортируется и не сериализуется. Public projections и
free bodies могут быть shared-cacheable. Membership/permission body, decision и credential всегда
`private, no-store`. Protected speculative prefetch, static generation, shared route/data cache и
`Vary: Cookie` как единственная защита запрещены.

## Audit and correlation

`ContentAccess` обязательно формирует audit event для каждого explicit protected allow/deny,
author/admin preview, credential issue и dependency failure, но сохраняет batch одним append.
Library/activity availability создаёт максимум query-summary metrics/event с counts; database rows,
которые пользователь не запрашивал как protected delivery, не превращаются в сотни artificial
deny events. High-volume `public_resource` allow может быть metrics-only; public deny аудируется,
если он показывает probing или configuration error. Internal `AccessAudit` port получает событие
из того же module, который сформировал decision; route или delivery adapter не собирает duplicate
audit сам.

Minimum event содержит `decisionId`, `decidedAt`, `effect`, `reason`, `action`, `boundary`,
opaque Subject/resource identifiers, `policyVersion`, `correlationId`, latency class и — только
если entitlement участвовал — evidence reference/version/`validUntil`. Email, names, raw
Platform/Telegram identifiers, sessions, authorization headers, signed URLs, JWTs, query strings,
provider tokens, IP и User-Agent запрещены. `boundary` и `correlationId` — audit context, а не
policy inputs.

Audit sink outage не превращает deny в allow и не меняет уже вычисленный decision:
adapter использует bounded buffer/best-effort telemetry и alert. Production protected paths не
получают GO, пока required events не доказаны и не защищены от sensitive data.

## Persistence, composition and tests

Recommended ownership after #49 merge:

```text
apps/backend/src/modules/
  content-access/             # batch availability/authorization + policy implementation
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

V1 хранит requirement в owning immutable MaterialRevision и published projection; отдельная
generic `resource_access_policies` copy не создаётся. Membership остаётся одной current projection
на Principal. Future `content_grants` table появляется только с первым tier/purchase/manual-grant
consumer и хранит compact `Principal × scope`, никогда effective `Principal × every Material`.
Purpose-built query-time access selection может join-ить такую локальную projection через
ContentAccess-owned internal PostgreSQL adapter; owning application interfaces не раскрывают SQL.

The only new remote port is `TelegramMembership`, justified by deterministic test and production
HTTP adapters. Clock/ID sources and contract fixture adapter are internal test seams, not exported
through `ContentAccess`. Nest entrypoints bind one canonical assembly; page/REST/MCP never import
implementation or persistence paths.

Required tests:

- pure exhaustive policy table for every availability/allow/deny outcome through batch interface;
- `N=1`/`N=100` query/provider counters prove no I/O growth per Material and no await in item loop;
- input order, duplicate Resource deduplication, duplicate `itemId`, empty/oversized batch and
  aggregate-byte limit behavior;
- real-PostgreSQL Material Reader/preview acceptance proving no body/private metadata load on deny;
- vendored Workspace fixtures through `MembershipEntitlements.resolveForAccess` and deterministic
  `TelegramMembership` adapter;
- just-before/at/after expiry, removal, rejoin, identical retry, replay, principal mismatch,
  malformed/unsupported evidence and fresh/stale outage;
- concurrent stale requests prove one adapter call, durable lease takeover after failure and
  monotonic final state;
- service Principal never consumes Membership; disabled Principal loses private permissions;
- existing production page/REST path passes the same Material outcome corpus; MCP/Asset/Video
  extend cross-boundary conformance only with their first real adapters;
- cache/response tests prove closed bytes/IDs/credentials absent and Subject A never receives
  Subject B protected result;
- every protected allow/deny, preview и dependency failure проходят через `AccessAudit`
  с exact `boundary`/`correlationId`/reason/policy fields и без prohibited identity, session и provider data.

Old baseline-policy unit tests are deleted once equivalent tests pass through the new external
interface. Existing Materials lifecycle tests are adapted, not layered with a second policy fake.

## Consumer-led slices for #50

1. **Batch contract and real Material proof.** After #49 supplies canonical Principal/Subject
   types, add branded batch/item IDs, `availabilityMany`/`authorizeMany`, deterministic Principal
   and Membership facts adapters, a real-PostgreSQL bulk `MaterialResourceFacts` adapter and one
   PublishedMaterial read/readMany acceptance path. Prove anonymous/non-member/member, teaser/body
   separation, cache scope, ordered outcomes and `N=1`/`N=100` fixed I/O count. This is an enabling
   capability, not login or production Membership.
2. **MembershipEntitlements core.** Vendor exact v1 schema/fixtures with source commit metadata;
   add PostgreSQL projection/migration, strict evidence validation, deterministic adapter, clock,
   monotonic replay/removal/rejoin behavior and durable single-flight tests. It owns consumer-side
   opaque Membership binding and does not create duplicate identity.
3. **Platform ContentAccess completion.** Implement reason precedence against #49
   Principal/permission facts, current Material resource facts and MembershipEntitlements. Prove
   unavailable/disabled/service cases through one batch interface and choose the finite permission
   decision cap before enabling author/admin allows.
4. **Replace the real Material consumers.** Remove `createBaselineContentAccess`, caller-supplied
   access/publication facts and preview header-before-authorization. Bind one production
   `ContentAccess` into `createMaterials`/Nest composition; preserve public teaser, exact published
   pointer, private-no-store and audit behavior.
5. **Cross-surface hardening.** Run focused lifecycle/conformance/concurrency/cache tests through
   existing #89 page/REST consumers, root checks, guardrails and Standards + Spec review. Record
   explicit TODO links to #29 and future Asset/Video owners; do not scaffold absent adapters.

Slices are tracked as dependency-aware child tickets under #50 rather than one blocked monolith.
The first slice may merge as an enabling capability after #49/#84 without production login or
Telegram; later slices replace its deterministic facts adapters at the same seams. The aggregate
stopping condition is one provider-neutral protected Material path on real reader/preview consumers
plus stable batch interfaces for future consumers.

## Blockers, caveats and rejected alternatives

Design #84 не заблокирован. Для #50:

- [#31](https://github.com/sachkov-inside/platform/issues/31) уже closed и real protected Material
  path существует;
- [#49](https://github.com/sachkov-inside/platform/issues/49) design contract уже merged, а production
  implementation supplies canonical trusted human/service Subject, Principal status and current
  permissions. It blocks the first implementation child from inventing duplicate identity, but no
  longer forces Membership persistence/provider delivery into the same slice;
- existing page/REST consumers входят в #112 integration proof и не являются blockers;
  Assets/Videos/MCP отсутствуют, не блокируют core Material implementation и подключаются своими
  owning tickets;
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
- generic RBAC/ABAC/policy DSL, speculative tier/purchase tables or delegated service Membership;
- exported SQL predicate, reusable access profile/capability или policy copied into every query;
- per-resource I/O loop and precomputed effective `Principal × Material` matrix;
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
| One authority for protected resources/callers | Batch-first availability/authorization interface with one policy matrix and non-policy boundary/correlation context; inventory names real and absent consumers. |
| Anonymous/non-member/member/expired/author/admin/service outcomes | Stable matrix and deterministic reason precedence. |
| Authorize before body/private metadata/credentials | Explicit Material/preview/bulk delivery ordering; availability never grants delivery. |
| No N+1 authorization | Bulk facts/grants/audit, `O(K)` I/O for `K` resource kinds, `N=1`/`N=100` counter acceptance. |
| Large accessible queries | Purpose-built relational selection only when filtering must precede pagination; no exported SQL/access scope. |
| Five-minute positive bound | Entitlement validation and `validUntil` cap. |
| Finite author/admin allow | `permissionDecisionCap` обязателен; exact value — explicit #50 owner blocker и policy-version input. |
| Removal/expiry/rejoin/replay | Monotonic projection rules and vendored fixtures. |
| Stale outage fails closed | Fresh-only use, no grace, `entitlement_stale`/`dependency_unavailable`. |
| Single-flight refresh | Durable lease/generation without remote call in transaction. |
| Test and HTTP adapters share one port | Deterministic adapter in #50, production HTTP adapter deferred to #52. |
| No speculative resource adapters | Existing page/REST use the real Reader; absent Asset/Video/MCP adapters remain consumer-led. |
| Provider-neutral implementation stopping condition | Real PublishedMaterialReader + preview use one Platform module; baseline policy removed. |

Owner approval of this specification authorizes #50 implementation only after #49 supplies its trusted
Subject contract. It does not approve provider selection, Telegram HTTP calls, production
credentials/deploy, Asset/Video delivery mechanisms or merge.
