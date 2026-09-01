# ContentAccess authorization specification v1

Статус: repository-local implementation contract для
[#50](https://github.com/sachkov-inside/platform/issues/50), уточнённый решением
[#132](https://github.com/sachkov-inside/platform/issues/132) о едином mutable `Material` и
owner decision в [#120](https://github.com/sachkov-inside/platform/issues/120) не создавать
persistent authorization audit в v1.

## Решение

Platform создаёт один глубокий module `ContentAccess`. Он разделяет:

- `checkAvailabilityMany` — неавторитетную batch-подсказку presentation layer для карточек;
- `authorize` — единственный авторитетный single-resource путь перед protected delivery.

Обе операции используют одну policy matrix и Platform-owned facts. IdP только аутентифицирует;
provider claims, Logto roles и BFF cookie сами по себе не дают content access.

```ts
type Subject =
  | Readonly<{ kind: "anonymous" }>
  | Readonly<{ kind: "account"; accountId: AccountId }>;

type Resource =
  | Readonly<{ kind: "material"; materialId: MaterialId }>
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

type AccessRequest = Readonly<{
  subject: Subject;
  resource: Resource;
  action: Action;
  enforcementPoint: EnforcementPoint;
  correlationId: CorrelationId;
}>;

type AccessBatchError = Readonly<{
  code: "empty_batch" | "duplicate_item_id" | "batch_too_large";
}>;

type AvailabilityBatchResult =
  | Readonly<{ ok: true; items: readonly AccessAvailability[] }>
  | Readonly<{ ok: false; error: AccessBatchError }>;

interface ContentAccess {
  checkAvailabilityMany(input: AccessBatchRequest): Promise<AvailabilityBatchResult>;
  authorize(input: AccessRequest): Promise<AccessDecision>;
}
```

Availability batch содержит один trusted `Subject`, не более 100 operations и возвращает один
result на каждый input в исходном порядке. Implementation может deduplicate одинаковые
resource/action lookups, но duplicate `itemId`, пустой или oversized batch возвращают
соответствующий transport-neutral `AccessBatchError`; operation их не бросает и не смешивает с
per-item authorization deny. Полные тела не имеют `readMany`, а `authorize` не имитируется batch из
одного элемента.

`itemId` нужен только для сопоставления availability results. `enforcementPoint` и `correlationId`
описывают контекст вызова, не влияют на policy и не требуют persistent write. `EnforcementPoint` —
finite vocabulary application operations, которые запрашивают решение; transport context остаётся
за пределами policy. Opaque local resource ID — единственное утверждение caller о resource.
Publication, access class, attachment, owner, profile, email, Telegram state и provider claims
caller не передаёт.

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
  подключает production evidence-ingestion adapter к независимо реализованному Telegram provider,
  а #29 позже использует user-delegated owner Account.

## Текущие и будущие consumers

| Surface | Состояние | Contract |
|---|---|---|
| Published Material body | Реальный PostgreSQL-backed reader уже отделяет public teaser от protected body. | Сначала public projection, затем single-resource `authorize`, затем current body только для allow и неизменившейся `contentVersion`. |
| Material preview | Реальный privileged path уже существует. | Preview текущего сохранённого Material требует свежей проверки `materials:manage` до body/private metadata load. |
| Web page и REST | Реальные entrypoints используют Published Material reader. | Они передают trusted Account либо anonymous; route-local policy запрещена. |
| MCP | Materials tools ещё отсутствуют. | Первый adapter использует user-delegated owner Account и ту же permission; service identity не создаётся. |
| MaterialAsset | Production upload/read/download adapters реализованы в #180. | `assetId` разрешается в safe owner/kind facts; private locator загружается только после exact Asset/Action allow; Membership presign ограничен `validUntil`. |
| Video | Owning module и delivery adapter отсутствуют. | Vocabulary зарезервирован для conformance, production adapter появляется только с реальным consumer. |

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

Это current indexed DB lookup. Результат можно reuse только внутри текущего вызова `authorize` или
одного availability batch; его нельзя переносить в JWT, Logto cookie, React state, следующую request или
`validUntil`-lease. Revocation действует на следующую protected operation.

`MembershipEntitlement` — отдельное time-bounded заключение Platform о доступе Account к closed
content. Оно не является ролью или permission. `Member Profile`, nickname/avatar, `ReadingState`,
practice/progress и Telegram presentation data не участвуют в authorization.

## Resource и Action

Owning resource adapter разрешает opaque IDs в минимальные internal facts:

- owning Material, его `draft | published | unpublished` state и current `contentVersion`;
- `free | membership` requirement;
- attachment relationship и вид Asset/Video, когда такие modules реально появятся.

Caller не передаёт slug, access class, publication state, content version, storage key, signed URL,
Kinescope ID или private locator. Unknown ID, unpublished resource, attachment другого Material и
invalid resource/action pair fail closed.

Valid pairs:

- Material body: `read | preview`;
- inline Asset: `read | preview`;
- downloadable Asset: `download | preview`;
- Video: `play | preview`.

Normal `read | download | play` никогда не открывают `draft` или `unpublished`. `preview` выбирает
текущее сохранённое состояние Material и требует `materials:manage`. Эта permission также покрывает
полный authoring workflow, включая publish, unpublish и смену access class; validation и lifecycle
invariants остаются в Materials и не становятся частью `ContentAccess`.

## Finite decisions

```ts
type AccessAvailability = Readonly<{
  itemId: AccessItemId;
  availability: "available" | "locked" | "unavailable";
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
  decisionId: AccessDecisionId;
  policyVersion: PolicyVersion;
  decidedAt: Instant;
}> & (
  | Readonly<{
      effect: "allow";
      reason: "public_resource" | "materials_manager";
      checkedContentVersion: ContentVersion;
    }>
  | Readonly<{
      effect: "allow";
      reason: "active_membership";
      validUntil: Instant;
      checkedContentVersion: ContentVersion;
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
5. Current `materials:manage`: `materials_manager`, включая current saved preview и обычное чтение
   published membership-материала без Membership.
6. Preview без permission: `permission_required`.
7. Closed normal delivery: resolve current Membership; active даёт `active_membership`, absence —
   `membership_required`, confirmed expiry/removal — `membership_expired`, stale positive после
   `validUntil` без принятого нового evidence — `entitlement_stale`, unreadable local projection —
   `dependency_unavailable`.

| Resource / action | Anonymous | Account без Membership | Active member | Expired member | Account с `materials:manage` |
|---|---|---|---|---|---|
| Published free `read/download/play` | public | public | public | public | public |
| Published membership `read/download/play` | authentication required | membership required | active membership | membership expired | materials manager |
| Current free/membership `preview` | authentication required | permission required | permission required | permission required | materials manager |
| Draft `preview` | authentication required | permission required | permission required | permission required | materials manager |
| Draft normal delivery | unpublished | unpublished | unpublished | unpublished | unpublished |

Active Membership не даёт preview, authoring или publish. Permission не создаёт fake
`MembershipEntitlement`. Profile и activity facts не меняют ни одну строку matrix.

`checkAvailabilityMany` coarse-проецирует те же current facts:

- allow → `available`;
- любой известный published membership-resource без доказанного allow, включая dependency outage,
  → `locked`;
- invalid/unpublished/unknown resource → `unavailable`.

Availability не возвращает reason, decision ID или validity и не разрешает body, private locator,
redirect, signed URL или playback token. Любая последующая delivery вызывает `authorize` заново.
Public reader маппит deny известного published membership-материала в индексируемый teaser со
статусом `locked` и успешным page response; draft/unpublished/unknown остаются `404`, outage —
тот же fail-closed `locked`. UI не получает internal Membership reason или resource oracle.

Safe public projection содержит author-controlled `title`, `description`, `cover`, author,
taxonomy и `publishedAt`. Library и внутренний search показывают такие published membership-
материалы с замком, а внешний индекс может индексировать их teaser. Body, inline media, downloads,
video locators и иные связанные с body ресурсы в projection не входят. Любой locked teaser
показывает один CTA «Получить доступ» на общую Platform-owned Tribute URL setting; эта ссылка не
является полем Material и не доказывает Membership.

## MembershipEntitlements

`ContentAccess` зависит от узкого access-oriented interface:

```ts
interface MembershipEntitlements {
  resolveForAccess(accountId: AccountId): Promise<MembershipAccessState>;
}
```

`MembershipAccessState` — finite internal state `active | required | expired | stale |
unavailable`, а не provider DTO. `resolveForAccess` читает только bounded Platform projection в
PostgreSQL: он не вызывает Telegram, не запускает provider check и не ждёт background
reconciliation.
Owning module отдельно strict-validates vendored evidence schema, Account binding, clock, version
and validity before applying link-time check, member-status event или reconciliation result. Opaque
`AccountId -> MembershipRef` binding принадлежит Membership integration, не Accounts и не Profile.

Rules:

- positive evidence создаёт `inside_membership` entitlement с
  `validUntil <= checkedAt + 5 minutes` и не позже evidence validity;
- более новое removal evidence немедленно убирает current entitlement;
- identical retry idempotent, older version/replay/binding mismatch rejected;
- rejoin требует более новой accepted version и создаёт новый bounded interval;
- current positive projection используется только пока `now < validUntil`; grace extension,
  local role fallback и allow-on-error запрещены;
- stale/missing evidence возвращает `stale | unavailable` и fails closed; user-facing request не
  обращается к provider;
- Telegram member-status event после durable provider acceptance создаёт новое normalized evidence;
  projection и доступ меняются только после monotonic acceptance его новой версии в Platform;
- background reconciliation внутри Telegram application проверяет due known linked identities и
  создаёт evidence, исправляющее пропущенные events;
- free public read не зависит от состояния event ingestion/reconciliation.

Concurrent Platform consumers принимают evidence через durable inbox/deduplication keyed by binding
и version; apply выполняется monotonic compare-and-set, повторная доставка идемпотентна. Они никогда
не проверяют Telegram. Provider-side reconciliation worker/lease принадлежит Telegram application
под Workspace #60. User-facing requests не ждут ни ingestion, ни reconciliation.

#119 добавляет deterministic evidence-acceptance adapters, local projection и vendored shared
conformance corpus. #52 добавляет production authenticated evidence ingestion и end-to-end
convergence с отдельно реализованным provider. Durable Telegram member-status ingestion и
`getChatMember` reconciliation transport принадлежат Telegram application под Workspace #60.

## Availability batch и protected loading

В availability loop по operations запрещён database/provider I/O. Для `N <= 100` operations и `K`
реально присутствующих resource kinds:

```text
resource database round trips = O(K), not O(N)
subject-fact database reads    = O(1) per batch
request-path provider calls    = 0
policy CPU                     = O(N)
memory                         = O(N)
```

Planner validates/deduplicates input, bulk-loads resource facts одним query на kind, один раз на
batch читает current Account permission и только при необходимости один раз Membership, затем
pure-evaluates policy. Tests для `N=1` и `N=100` доказывают, что query/provider call count не растёт
на каждый Material; order, duplicates и cardinality сохраняются. Batch никогда не читает полные
bodies, поэтому aggregate body-byte limit и `readMany` в v1 не нужны.

Published Material delivery order:

1. Resolve optional trusted Subject и загрузить только allowlisted public projection by slug.
2. Вызвать `authorize` для `material/read` по `materialId`.
3. На deny вернуть индексируемый public teaser, `locked` и общий CTA без запроса protected body.
4. На allow получить `checkedContentVersion` и одним conditional query загрузить ровно один body,
   только если Material всё ещё `published` и его `contentVersion` не изменился.
5. При mismatch ограниченно повторить resolve/authorize либо fail closed; затем render через
   Materials.

Preview передаёт `materialId`, требует current `materials:manage` и загружает текущее сохранённое
состояние только после allow. Обычный public reader даже для manager не открывает draft/unpublished:
для них используется Preview. MaterialAsset adapter сначала load-ит только safe owner/kind facts,
вызывает single-resource authorize с exact `assetId` и `read | download | preview`, затем получает
private locator; Membership presign живёт меньше `validUntil` с clock-safety margin. Будущий Video
adapter следует тому же порядку. Cover остаётся частью public projection; inline media, downloads
и video наследуют защиту owning Material.

Public projections и free bodies могут быть shared-cacheable. Personalized availability
накладывается после public cache. Membership body, protected decision, credential и permission
path всегда `private, no-store`; protected prefetch, static generation и shared route/data cache
запрещены. Caller не кэширует availability или decision между requests.

## Decision metadata и privacy

`authorize` возвращает finite reason вместе с `decisionId`, `policyVersion` и `decidedAt`; bounded
Membership allow также возвращает `validUntil`. Эти значения делают одно решение различимым и
проверяемым, но сами по себе не создают side effect.

V1 не создаёт authorization audit schema/table, retention policy/job, telemetry event contract или
mandatory sink и не выполняет audit write из `authorize`/`checkAvailabilityMany`. К этому контуру
можно вернуться только при конкретной operational или security потребности с отдельным owner
decision. Если diagnostics добавятся позже, email, profile, issuer/subject, JWT, Logto cookie,
Telegram raw ID, authorization header, signed URL и provider token не должны становиться policy
inputs или persistent authorization facts.

## Module ownership

```text
apps/backend/src/modules/
  accounts/                  # trusted Account resolution + current materials:manage
  content-access/            # batch orchestration + policy
  membership-entitlements/  # bounded projection + monotonic evidence application
  materials/                 # resource facts adapter + reader/preview consumers
```

`ContentAccess` объявляет access-oriented `MaterialResourceFacts` port; Materials реализует его
поверх своей persistence и возвращает только minimal policy facts без protected body. Port
поддерживает bulk facts для availability и single facts для authorize. `ContentAccess` не читает
Materials tables напрямую, а Materials transport не импортирует policy implementation.
Asset/Video ports появляются только вместе с owning real consumers.

V1 не создаёт generic RBAC/ABAC DSL, `Account × Material` matrix, `content_grants`, exported SQL
predicate, generic repository/UoW или speculative service Account. Future tier/purchase/manual
grant получает собственный compact fact и ADR/consumer; Membership не подменяется таким grant.

## Verification

Required evidence:

- exhaustive pure policy matrix для single `authorize` и coarse availability projection;
- availability `N=1`/`N=100` fixed-I/O counters, ordering, duplicate/resource dedup and batch limits;
- real-PostgreSQL reader/preview tests: deny не загружает body/private facts, allow загружает ровно
  один body только при совпадающих `published` state и `contentVersion`;
- Library/search показывают published membership cards как locked, manager — как available;
- public locked reader возвращает индексируемые metadata, единый CTA и ни одного body/resource byte;
- current `materials:manage` grant/revoke changes the next protected operation;
- provider role/claim and Profile/ReadingState never alter decisions;
- vendored Membership fixtures: boundary time, removal, expiry, rejoin, retry, replay, mismatch,
  malformed evidence and outage;
- concurrency proof: duplicate/out-of-order evidence consumers converge monotonically, inbox retry
  is idempotent and user-facing requests make zero provider calls;
- page/REST conformance, private-no-store and no cross-Account cache leakage;
- Prisma schema/migrations не содержат authorization audit table, retention job или mandatory
  sink; `authorize`/availability не выполняют audit writes;
- repository checks, architecture fitness functions and Standards + Spec review.

## Consumer-led implementation slices

1. **#133 — mutable Material migration.** Remove persisted revision lifecycle, introduce atomic
   full-state Save with optimistic `contentVersion`, and expose body-free current Material facts.
2. **#112 — real Material proof.** Add availability batch plus single authorize, deterministic
   Account/Membership facts, real-PostgreSQL Material facts, conditional one-body reader integration
   and availability `N=1`/`N=100` proof.
3. **#119 — Membership core and projection.** Vendor exact contract fixtures; add bounded
   PostgreSQL projection, strict validation, deterministic evidence-acceptance adapters, monotonic
   expiry/removal/rejoin behavior and durable inbox/deduplication without any provider call from
   Platform consumers or user-facing reads.
4. **#120 — policy matrix.** Complete the finite Account/resource/action reason matrix and current
   permission/Membership coordination without a persistent authorization audit subsystem.
5. **#121 — production convergence.** Bind one canonical ContentAccess into reader/preview and
   Library/search availability, remove baseline/caller-supplied policy facts and prove current
   permission/cache behavior.
6. **#29 and future delivery owners.** Add user-delegated MCP and Asset/Video adapters only when
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
- batch authorization/body delivery, `readMany` или aggregate protected-body byte budget;
- revision ID как authorization resource или caller-supplied `contentVersion`;
- разные публичные denial CTA/reasons, per-Material purchase URL или скрытие published membership
  cards от Library/search;
- stale-positive grace, allow-on-error or shared caching of protected outcomes;
- fake Asset/Video/MCP production adapters before an owning consumer.

Owner approval of this specification authorizes implementation planning for #50. It does not
approve production credentials/deploy, Telegram HTTP calls, new identity kinds or merge of an
implementation PR.
