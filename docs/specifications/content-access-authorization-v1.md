# ContentAccess authorization specification v1

Статус: decision-ready repository-local specification для
[#84](https://github.com/sachkov-inside/platform/issues/84). Документ подготовлен поверх
`origin/main` после принятия [ADR 0006](../adr/0006-logto-session-and-local-account.md). После
owner approval и merge он становится implementation contract для
[#50](https://github.com/sachkov-inside/platform/issues/50), но сам не добавляет production code.

## Решение

Platform создаёт один глубокий batch-first module `ContentAccess`. Он разделяет:

- `checkAvailabilityMany` — неавторитетную подсказку presentation layer;
- `authorizeMany` — единственный авторитетный путь перед protected delivery.

Обе операции используют одну policy matrix и Platform-owned facts. IdP только аутентифицирует;
provider claims, Logto roles и BFF cookie сами по себе не дают content access.

```ts
type Subject =
  | Readonly<{ kind: "anonymous" }>
  | Readonly<{ kind: "account"; accountId: AccountId }>;

type Resource =
  | Readonly<{ kind: "material_body"; revisionId: MaterialRevisionId }>
  | Readonly<{ kind: "asset"; assetId: AssetId }>
  | Readonly<{ kind: "video"; videoId: VideoId }>;

type Action = "read" | "preview" | "download" | "play";

type EnforcementPoint =
  | "published_material_read"
  | "material_preview"
  | "mcp_material_read"
  | "asset_delivery"
  | "download_delivery"
  | "playback_token_issue"
  | "video_authorization_callback";

type AccessOperation = Readonly<{
  itemId: AccessItemId;
  resource: Resource;
  action: Action;
}>;

type AccessBatchRequest = Readonly<{
  subject: Subject;
  operations: readonly AccessOperation[];
  enforcementPoint: EnforcementPoint;
  correlationId: CorrelationId;
}>;

type AccessBatchError = Readonly<{
  code: "empty_batch" | "duplicate_item_id" | "batch_too_large";
}>;

type AvailabilityBatchResult =
  | Readonly<{ ok: true; items: readonly AccessAvailability[] }>
  | Readonly<{ ok: false; error: AccessBatchError }>;

type AuthorizationBatchResult =
  | Readonly<{ ok: true; items: readonly AccessDecision[] }>
  | Readonly<{ ok: false; error: AccessBatchError }>;

interface ContentAccess {
  checkAvailabilityMany(input: AccessBatchRequest): Promise<AvailabilityBatchResult>;
  authorizeMany(input: AccessBatchRequest): Promise<AuthorizationBatchResult>;
}
```

Одна operation — batch из одного элемента. Batch содержит один trusted `Subject`, не более 100
operations и возвращает один result на каждый input в исходном порядке. Implementation может
deduplicate одинаковые resource/action lookups, но duplicate `itemId`, пустой или oversized batch
возвращают соответствующий transport-neutral `AccessBatchError`; operation их не бросает и не
смешивает с per-item authorization deny.

`itemId`, `enforcementPoint` и `correlationId` нужны только для correlation/audit и не влияют на
policy. `EnforcementPoint` — finite vocabulary application operations, которые запрашивают
решение; transport при необходимости остаётся отдельным telemetry attribute. Opaque local
resource ID — единственное утверждение caller о resource. Publication, access class, attachment,
owner, profile, email, Telegram state и provider claims caller не передаёт.

## Принятые authorities

- [Account identity foundation](identity-principals-session-v1.md) определяет trusted Account,
  Logto proof boundary и единственную текущую permission `materials:manage`;
- [ADR 0006](../adr/0006-logto-session-and-local-account.md) запрещает второй Platform session,
  generic Principal и speculative M2M identity;
- [Platform specification](platform-v1.md) закрепляет Platform-owned `ContentAccess`, отдельный
  `MembershipEntitlement` и protected-load-after-allow;
- Workspace contract `inside.membership-evidence.v1` задаёт внешний evidence format и
  максимальную пятиминутную validity; Platform хранит exact schema/fixtures и не читает соседний
  checkout или GitHub во время build/runtime;
- #50 реализует этот contract, #112 подключает первый реальный Material consumer, #52 позже
  подключает production Telegram adapter, а #29 позже использует user-delegated owner Account.

## Текущие и будущие consumers

| Surface | Состояние | Contract |
|---|---|---|
| Published Material body | Реальный PostgreSQL-backed reader уже отделяет public teaser от protected body. | Сначала public projection, затем `authorizeMany`, затем exact current published body только для allow. |
| Material preview | Реальный privileged path уже существует. | Exact revision preview требует свежей проверки `materials:manage` до body/private metadata load. |
| Web page и REST | Реальные entrypoints используют Published Material reader. | Они передают trusted Account либо anonymous; route-local policy запрещена. |
| MCP | Materials tools ещё отсутствуют. | Первый adapter использует user-delegated owner Account и ту же permission; service identity не создаётся. |
| Asset и Video | Owning modules и delivery adapters отсутствуют. | Vocabulary зарезервирован для conformance, но production adapters появляются только с реальным consumer. |

## Subject и authorization facts

`Subject.accountId` создаёт только trusted composition после Logto JWT verification и
`Accounts.resolveAccount`. Request body, query, cookie payload или provider role не могут создать
authenticated Subject. При optional authentication отсутствие credentials означает anonymous;
невалидный credential на protected transport не превращается в anonymous retry.

`Subject` не содержит permission, Membership, email, issuer/subject или profile. Для каждой
protected application operation `ContentAccess` вызывает:

```ts
Accounts.checkPermission({ accountId, permission: "materials:manage" })
```

Это current indexed DB lookup. Результат можно reuse только внутри текущего вызова
`authorizeMany`; его нельзя переносить в JWT, Logto cookie, React state, следующую request или
`validUntil`-lease. Revocation действует на следующую protected operation.

`MembershipEntitlement` — отдельное time-bounded заключение Platform о доступе Account к closed
content. Оно не является ролью или permission. `Member Profile`, nickname/avatar, `ReadingState`,
practice/progress и Telegram presentation data не участвуют в authorization.

## Resource и Action

Owning resource adapter bulk-разрешает opaque IDs в минимальные internal facts:

- owning Material и exact revision;
- draft/published и соответствие current published pointer;
- `free | membership` requirement;
- attachment relationship и вид Asset/Video, когда такие modules реально появятся.

Caller не передаёт slug, access class, publication state, storage key, signed URL, Kinescope ID или
private locator. Unknown ID, non-current published revision, cross-revision attachment и invalid
resource/action pair fail closed.

Valid pairs:

- Material body: `read | preview`;
- inline Asset: `read | preview`;
- downloadable Asset: `download | preview`;
- Video: `play | preview`.

Normal `read | download | play` никогда не открывают draft. `preview` выбирает exact revision и
требует `materials:manage`. Эта permission также покрывает authoring workflow, но owner GO,
validation и publish invariants остаются в Materials и не становятся частью `ContentAccess`.

## Finite decisions

```ts
type AccessAvailability = Readonly<{
  itemId: AccessItemId;
  availability: "available" | "locked" | "sign_in_required" | "unavailable";
}>;

type DenyReason =
  | "authentication_required"
  | "membership_required"
  | "membership_expired"
  | "entitlement_stale"
  | "permission_required"
  | "resource_unpublished"
  | "resource_not_found"
  | "resource_mismatch"
  | "resource_action_invalid"
  | "dependency_unavailable";

type AccessDecision = Readonly<{
  itemId: AccessItemId;
  decisionId: AccessDecisionId;
  policyVersion: PolicyVersion;
  decidedAt: Instant;
}> & (
  | Readonly<{
      effect: "allow";
      reason: "public_resource" | "materials_manager";
    }>
  | Readonly<{
      effect: "allow";
      reason: "active_membership";
      validUntil: Instant;
    }>
  | Readonly<{ effect: "deny"; reason: DenyReason }>
);
```

`public_resource` и `materials_manager` не получают fabricated expiry. Permission проверяется
заново на следующей operation. Только `active_membership` содержит `validUntil`, не позже current
entitlement. Derived delivery credential обязан быть привязан к exact Account/resource/action и
жить не дольше `min(entitlement.validUntil, adapterDeliveryCap)`; permission-based credential
получает только короткий adapter-owned cap и не превращает permission decision в reusable lease.

Deterministic reason precedence:

1. Resolve resource/action mapping: `resource_not_found`, `resource_mismatch`,
   `resource_action_invalid` или `resource_unpublished`.
2. Published free normal delivery: `public_resource`; Account/Membership lookup не нужен.
3. Protected anonymous operation: `authentication_required`.
4. Read current `materials:manage`; dependency failure: `dependency_unavailable`.
5. Current `materials:manage`: `materials_manager`, включая exact preview.
6. Preview без permission: `permission_required`.
7. Closed normal delivery: resolve current Membership; active даёт `active_membership`, absence —
   `membership_required`, confirmed expiry/removal — `membership_expired`, stale positive после
   failed refresh — `entitlement_stale`, unreadable dependency — `dependency_unavailable`.

| Resource / action | Anonymous | Account без Membership | Active member | Expired member | Account с `materials:manage` |
|---|---|---|---|---|---|
| Published free `read/download/play` | public | public | public | public | public |
| Published membership `read/download/play` | authentication required | membership required | active membership | membership expired | materials manager |
| Exact free/membership `preview` | authentication required | permission required | permission required | permission required | materials manager |
| Draft `preview` | authentication required | permission required | permission required | permission required | materials manager |
| Draft normal delivery | unpublished | unpublished | unpublished | unpublished | unpublished |

Active Membership не даёт preview, authoring или publish. Permission не создаёт fake
`MembershipEntitlement`. Profile и activity facts не меняют ни одну строку matrix.

`checkAvailabilityMany` coarse-проецирует те же current facts:

- allow → `available`;
- anonymous protected resource → `sign_in_required`;
- known authenticated deny → `locked`;
- invalid/unpublished/unknown resource или dependency outage → `unavailable`.

Availability не возвращает reason, decision ID или validity и не разрешает body, private locator,
redirect, signed URL или playback token. Любая последующая delivery вызывает `authorizeMany`
заново. Transport обычно маппит missing authentication в `401`, known deny в `403`, unsafe
unknown/mismatch в `404`, outage в `503`; UI не получает internal resource oracle.

## MembershipEntitlements

`ContentAccess` зависит от узкого access-oriented interface:

```ts
interface MembershipEntitlements {
  resolveForAccess(accountId: AccountId): Promise<MembershipAccessState>;
}

interface TelegramMembership {
  check(input: Readonly<{
    membershipRef: MembershipRef;
    afterEvidenceVersion?: number;
  }>): Promise<unknown>;
}
```

`MembershipAccessState` — finite internal state `active | required | expired | stale |
unavailable`, а не provider DTO. `TelegramMembership.check` возвращает `unknown`: owning module
strict-validates vendored schema, Account binding, clock, version and validity before accepting
evidence. Opaque `AccountId -> MembershipRef` binding принадлежит Membership integration, не
Accounts и не Profile.

Rules:

- positive evidence создаёт `inside_membership` entitlement с
  `validUntil <= checkedAt + 5 minutes` и не позже evidence validity;
- более новое removal evidence немедленно убирает current entitlement;
- identical retry idempotent, older version/replay/binding mismatch rejected;
- rejoin требует более новой accepted version и создаёт новый bounded interval;
- current positive projection используется только пока `now < validUntil`; grace extension,
  local role fallback и allow-on-error запрещены;
- stale/missing evidence triggers refresh; provider/store outage после expiry fails closed.

Concurrent stale requests используют durable PostgreSQL lease/generation keyed by Account binding:
один owner вызывает adapter вне transaction, waiters bounded-wait и reread, apply выполняется
monotonic compare-and-set, expired lease восстанавливается после crash. Один process-local Promise
недостаточен для multi-instance backend.

#50 добавляет deterministic adapter и vendored conformance corpus. Production HTTP credentials,
timeouts/retries и Telegram transport принадлежат #52 и реализуют тот же port.

## Batch execution и protected loading

В loop по operations запрещён database/provider I/O. Для `N` operations и `K` реально
присутствующих resource kinds:

```text
database/provider round trips = O(K), not O(N)
policy CPU                     = O(N)
memory                         = O(N)
```

Planner validates/deduplicates input, bulk-loads resource facts одним query на kind, один раз на
batch читает current Account permission и только при необходимости один раз Membership, затем
pure-evaluates policy и batch-appends audit. Tests для `N=1` и `N=100` доказывают, что query/provider
call count не растёт на каждый Material; order, duplicates и cardinality сохраняются.

Published Material delivery order:

1. Resolve optional trusted Subject и загрузить только allowlisted public projection by slug.
2. Вызвать `authorizeMany` для `material_body/read`.
3. На deny вернуть teaser/coarse state без protected body.
4. На allow одним bulk query загрузить allowed bodies, повторно связывая revision с exact current
   published pointer.
5. Render через Materials и вернуть один ordered outcome на item.

Preview передаёт exact revision ID и также загружает body только после allow. Будущие Asset/Video
adapters сначала bulk-load safe relationship facts, а private locator/credential получают только
для allow items.

Public projections и free bodies могут быть shared-cacheable. Personalized availability
накладывается после public cache. Membership body, protected decision, credential и permission
path всегда `private, no-store`; protected prefetch, static generation и shared route/data cache
запрещены. Caller не кэширует availability или decision между requests.

## Audit и privacy

`authorizeMany` формирует event для каждого explicit protected allow/deny, preview, credential
issue и dependency failure и сохраняет их одним batch append. Availability создаёт только summary
metrics, а не сотни artificial deny rows. Public allows могут быть metrics-only.

Minimum protected event: decision ID/time, effect/reason, action, enforcement point, opaque
Account/resource IDs, policy version, correlation ID и — если Membership участвовал — evidence
version/validity.
Email, profile, issuer/subject, JWT, Logto cookie, Telegram raw ID, authorization header, signed URL,
provider token, IP и User-Agent запрещены. Audit context не является policy input. Sink failure не
может превратить deny в allow; production readiness отдельно доказывает bounded delivery и alerting.

## Module ownership

```text
apps/backend/src/modules/
  accounts/                  # trusted Account resolution + current materials:manage
  content-access/            # batch orchestration + policy + audit
  membership-entitlements/  # bounded projection + refresh coordination
  materials/                 # resource facts adapter + reader/preview consumers
```

`ContentAccess` объявляет access-oriented `MaterialResourceFacts` port; Materials реализует его
поверх своей persistence и возвращает только minimal policy facts. `ContentAccess` не читает
Materials tables напрямую, а Materials transport не импортирует policy implementation.
Asset/Video ports появляются только вместе с owning real consumers.

V1 не создаёт generic RBAC/ABAC DSL, `Account × Material` matrix, `content_grants`, exported SQL
predicate, generic repository/UoW или speculative service Account. Future tier/purchase/manual
grant получает собственный compact fact и ADR/consumer; Membership не подменяется таким grant.

## Verification

Required evidence:

- exhaustive pure policy matrix через batch interface;
- `N=1`/`N=100` fixed-I/O counters, ordering, duplicate/resource dedup and batch limits;
- real-PostgreSQL reader/preview tests: deny не загружает body/private facts;
- current `materials:manage` grant/revoke changes the next protected operation;
- provider role/claim and Profile/ReadingState never alter decisions;
- vendored Membership fixtures: boundary time, removal, expiry, rejoin, retry, replay, mismatch,
  malformed evidence and outage;
- concurrency proof: one refresh across instances, lease takeover and monotonic state;
- page/REST conformance, private-no-store and no cross-Account cache leakage;
- audit batch contains exact stable fields and none of the prohibited identity/provider data;
- repository checks, architecture fitness functions and Standards + Spec review.

## Consumer-led implementation slices

1. **#112 — real Material proof.** Add batch types/module, deterministic Account/Membership facts,
   real-PostgreSQL bulk Material facts, reader/readMany integration and `N=1`/`N=100` proof.
2. **#119 — Membership core and refresh.** Vendor exact contract fixtures; add bounded PostgreSQL
   projection, strict validation, deterministic adapter, monotonic expiry/removal/rejoin behavior
   and durable single-flight lease/generation without a remote call inside transaction.
3. **#120 — policy matrix and batch audit.** Complete the finite Account/resource/action reason
   matrix, current permission/Membership coordination and one redacted audit append per batch.
4. **#121 — production convergence.** Bind one canonical ContentAccess into reader/preview,
   remove baseline/caller-supplied policy facts and prove current permission/audit/cache behavior.
5. **#29 and future delivery owners.** Add user-delegated MCP and Asset/Video adapters only when
   their real consumer exists; all use the same module and conformance corpus.

#50 stops when one provider-neutral protected Material path uses this module on real consumers,
Membership validity is bounded/fail-closed, and the temporary Materials-local baseline is removed.
It does not include IdP setup, Profile UI, production Telegram credentials, service/M2M identity,
tier/purchase persistence or speculative delivery adapters.

## Rejected alternatives

- IdP/Telegram roles, cookie claim or route-local middleware as content authority;
- permission/Membership snapshots in JWT, BFF session or frontend state;
- caller-supplied publication/access facts;
- generic Principal, service identity, author/admin roles or permission decision lease;
- per-resource I/O, provider call inside long transaction or precomputed effective access matrix;
- stale-positive grace, allow-on-error or shared caching of protected outcomes;
- fake Asset/Video/MCP production adapters before an owning consumer.

Owner approval of this specification authorizes implementation planning for #50. It does not
approve production credentials/deploy, Telegram HTTP calls, new identity kinds or merge of PR #85.
