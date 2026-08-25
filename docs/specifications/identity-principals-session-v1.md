# IdentityPrincipals and Platform Session specification v1

Статус: canonical v1 application contract: key choices подтверждены owner, remaining
implementation defaults зафиксированы после explicit delegation по
[Platform #83](https://github.com/sachkov-inside/platform/issues/83), часть
[Identity specification #48](https://github.com/sachkov-inside/platform/issues/48) и вход в
[implementation #49](https://github.com/sachkov-inside/platform/issues/49).

Дата: 2026-08-24.

## Решение и граница

Рекомендуется один глубокий `IdentityPrincipals` module: он принимает уже доказанную внешним
provider identity, стабильно сопоставляет `(issuer, subject)` с одним local `Principal`, владеет
конечным `Platform Session`, проверяет актуальный security state и Platform permissions и только
после этого возвращает trusted `Subject`.

Малый application interface состоит из шести conceptual operations:

1. открыть human или service session по соответствующей verified external identity;
2. разрешить session в актуальный trusted Subject;
3. начать one-time re-auth attempt для этой session;
4. завершить attempt недавней повторной аутентификацией;
5. завершить session;
6. проверить explicit Platform permission для application consumer.

Logto protocol, Next cookie и Nest token являются adapters вокруг этого interface. BFF передаёт
Nest только Logto access JWT для exact Platform audience вместе с opaque local `sessionRef`; JWT
доказывает external identity, а sessionRef выбирает finite Platform Session. Ни provider claims,
ни cookie/JWT types, ни Nest/Next types не входят в application interface. Опциональный
verified email входит только как provider-neutral PII observation: без него нельзя дать explicit
safe outcome changed/duplicate-email scenarios, но он никогда не становится identity key.
Production Logto adapter и deterministic fake adapter создают реальную внешнюю seam; PostgreSQL
остаётся internal local-substitutable dependency и проверяется через real PostgreSQL, а не через
repository port.

Specification намеренно:

- фиксирует Logto OSS как единственный IdP target; Better Auth исключён;
- следует owner-approved flow и proof gates из
  [`idp-application-flow-v1.md`](idp-application-flow-v1.md), но не объявляет Logto
  production-ready;
- не проектирует `ContentAccess`, Membership, Telegram linking, Account/Profile UI или recovery;
- не добавляет production code, migration или ADR;
- фиксирует thin end-to-end milestone #49 до production app-shell signed-in/signed-out state без
  Account/Profile UI.

## Authority и факты текущего repository

Design следует repository-local
[application specification](platform-v1.md),
[MVP brief](../product/platform-mvp-brief.md), [`CONTEXT.md`](../../CONTEXT.md) и принятым
[ADR 0001](../adr/0001-one-backend-multiple-entrypoints.md) /
[ADR 0002](../adr/0002-deep-materials-module.md). Инвентаризация обновлена на `origin/main`
`5fb0025` от 2026-08-24.

| Concern | Реальный current seam | Следствие для #49 |
|---|---|---|
| Backend topology | один `apps/backend`, process entrypoints `api` и `mcp`; generic worker удалён | identity остаётся capability module, новый process/package не появляется |
| Composition | `ApiModule.forRoot` и `McpModule.forRoot` получают один immutable `PlatformConfig`, импортируют один `PostgresModule` | `IdentityPrincipalsModule` становится static capability import только у реального consumer; provider options не передаются через application module |
| PostgreSQL | один `PLATFORM_DATABASE` / `PostgresModule` lifecycle на process | identity persistence использует тот же Kysely pool; собственного pool или generic repository нет |
| Migrations | `src/migrations/index.ts` — единый authority; capability migrations импортируются от owning module | identity migration живёт под `modules/identity-principals/.../migrations`, затем явно включается следующим ordered key в central provider |
| Generated types | один checked-in `infrastructure/postgres/generated/database.ts` | новые tables добавляются через migration, затем generated types регенерируются и проверяются на drift |
| Application tests | Testcontainers PostgreSQL 18.4 один на integration run, отдельная migrated database на suite | interface scenarios идут через real PostgreSQL и independent connections для races; fake нужен только внешнему proof port |
| Materials | один `createMaterials`; временный `AuthorPolicy` и dynamic `MaterialsModule.register` ожидают production identity owner | #49 даёт реальный permissions adapter и переводит Materials на static composition без route-local policy |
| Web | один server-only `apps/web/src/shared/api/backend/index.server.ts`, `no-store`, bounded timeout и typed errors | BFF session adapter расширяет эту server-only seam; browser graph не получает provider secret, token или authorization rule |
| Guardrails | backend strict TypeScript, typed lint и architecture import checks уже действуют | public index остаётся единственной точкой импорта, framework/provider/storage imports остаются internal/adapters |

Frozen migrations не редактируются. Identity получает новую migration после
`0002_material_lifecycle`; semantic name и номер выбираются на реализации по актуальному migration
head. `migrations.test.ts` должен ожидать полный ordered list и новый table set. Compose для design
не нужен; implementation tests используют изолированный Testcontainers lifecycle.

## Module depth и seams

Удаление `IdentityPrincipals` заставило бы каждого API/MCP/web caller повторить issuer/subject
mapping, disabled/expired checks, permission hydration, re-auth recency, transaction/idempotency и
audit. Значит эта сложность действительно принадлежит одному глубокому module, а не pass-through.

```text
external provider                    Platform-owned trust

browser callback / bearer proof
          |
          v
  IdP proof adapter  ---------> typed verified identity value
  (production or fake)                    |
                                         v
                               +----------------------+
                               | IdentityPrincipals   |
                               | issuer/subject map   |
                               | Principal state      |
                               | Platform Session     |
                               | permissions + audit  |
                               +----------+-----------+
                                          |
                                          v
                                    TrustedSubject
                                     /          \
                         Materials AuthorPolicy  future ContentAccess

Next BFF adapter: Logto flow + protected cookie + Logto access JWT + local sessionRef
Nest adapter: validate JWT -> issuer/subject + sessionRef -> the same resolveSubject path
```

Seams классифицируются так:

- **External application seam:** `IdentityPrincipals`; callers и application acceptance tests
  используют один interface.
- **True-external internal seam:** proof adapter к IdP. Production и deterministic fake adapters
  оправдывают variation. Module получает только normalized verified fact.
- **Local-substitutable internal seam:** PostgreSQL. Kysely transaction и semantic persistence
  functions остаются implementation details; tests используют real PostgreSQL.
- **Transport seams:** Next BFF cookie/session и Nest trusted-token adapters. BFF server graph
  предъявляет Logto access JWT + local sessionRef; Nest проверяет exact issuer/audience/signature/
  time/subject, после чего module связывает external identity и session. Ни JWT, ни sessionRef по
  отдельности не являются trusted Subject или вторым identity policy.

## Предлагаемый application interface

Ниже wire sketch, а не обещание exact TypeScript names. Public DTO serializable; implementation
валидирует `unknown`, canonicalizes provider-neutral values и использует branded IDs внутри.

```ts
type PrincipalKind = "human" | "service";

type PlatformPermission =
  | "materials:author"
  | "materials:publish"
  | "identity:admin";

interface VerifiedExternalIdentityKey {
  readonly issuer: string;
  readonly subject: string;
}

interface VerifiedHumanSignIn extends VerifiedExternalIdentityKey {
  readonly type: "human_sign_in";
  readonly authenticatedAt: string;
  readonly verifiedEmail: string;
}

interface VerifiedHumanSessionIdentity extends VerifiedExternalIdentityKey {
  readonly type: "human_session";
}

interface VerifiedServiceSessionIdentity extends VerifiedExternalIdentityKey {
  readonly type: "service_session";
  readonly authenticatedAt: string;
}

interface VerifiedHumanReauthentication extends VerifiedExternalIdentityKey {
  readonly type: "human_reauthentication";
  readonly reauthenticatedAt: string;
  readonly attemptId: string;
  readonly tokenId: string;
}

interface TrustedSubject {
  readonly principalId: string;
  readonly principalKind: PrincipalKind;
  readonly sessionRef: string;
  readonly authenticatedAt: string;
  readonly permissions: readonly PlatformPermission[];
}

interface IdentityPrincipals {
  establishHumanSession(command: {
    readonly identity: VerifiedHumanSignIn;
    readonly idempotencyKey: string;
  }): Promise<HumanSessionEstablishmentResult>;

  establishServiceSession(command: {
    readonly identity: VerifiedServiceSessionIdentity;
    readonly idempotencyKey: string;
  }): Promise<ServiceSessionEstablishmentResult>;

  resolveSubject(query: {
    readonly sessionRef: string;
    readonly identity:
      | VerifiedHumanSessionIdentity
      | VerifiedServiceSessionIdentity;
    readonly reauthenticatedAfter?: string;
  }): Promise<ResolveSubjectResult>;

  beginHumanReauthentication(command: {
    readonly sessionRef: string;
    readonly identity: VerifiedHumanSessionIdentity;
    readonly idempotencyKey: string;
  }): Promise<BeginReauthenticationResult>;

  completeHumanReauthentication(command: {
    readonly sessionRef: string;
    readonly proof: VerifiedHumanReauthentication;
    readonly idempotencyKey: string;
  }): Promise<CompleteReauthenticationResult>;

  endSession(command: {
    readonly sessionRef: string;
    readonly identity:
      | VerifiedHumanSessionIdentity
      | VerifiedServiceSessionIdentity;
    readonly idempotencyKey: string;
  }): Promise<EndSessionResult>;

  checkPermission(query: {
    readonly principalId: string;
    readonly permission: PlatformPermission;
  }): Promise<PermissionDecision>;
}
```

Verified identity values являются trusted internal values, не DTO публичного HTTP endpoint. Human
sign-in, human re-auth и service session имеют разные constructors и application commands; caller
не может передать `kind` и выбрать ветку. Только соответствующий proof adapter строит value после
strict validation. Constructor/parser закрыт внутри identity composition, чтобы arbitrary
controller не мог принять JSON с `issuer`/`subject` и назвать его verified.

В текущей двухпроцессной topology этот value не пересекает web → backend network как обычный JSON.
Next BFF server graph передаёт Logto access JWT для exact Platform audience и opaque local
sessionRef. Production Logto adapter внутри trusted Nest composition проверяет credential и только
затем строит value; `resolveSubject` проверяет exact identity/session ownership. `sessionRef` —
public name opaque branded PlatformSessionId, но не bearer credential. Browser JavaScript не
получает JWT или sessionRef.

`resolveSubject` — единственная trusted mapping path для web, API, MCP и будущих application
callers. Он каждый раз сопоставляет verified `(issuer, subject)` с owner Principal, проверяет, что
sessionRef принадлежит тому же Principal, и читает current Principal/session state и current
Platform permission grants. JWT/cookie не переносят permission, role, Membership или disabled
status как authority.

`checkPermission` — единственный узкий facet для application modules, которые уже принимают
trusted `PrincipalId`, как current Materials `AuthorPolicy`. Он повторно проверяет active state и
current explicit grant, поэтому revocation между request mapping и protected write fails closed.
Route handler не вызывает его вместо owning application module и не собирает из него role matrix.

`reauthenticatedAfter` — малый primitive, а не recovery policy. Sensitive owning module задаёт
нижнюю границу не старше 5 minutes. BFF начинает новую Logto authorization request с `prompt=login`
и после callback получает новый access JWT для exact Platform audience. Logto-owned custom access
token script добавляет в этот же signed JWT только private claims `inside_verified_email` и
`inside_interactive_at`. Оба появляются только для direct authorization-code token issuance с
matching newly submitted verified interaction; `inside_interactive_at` равен времени выполнения
trusted script и обязан быть близок к final JWT `iat`. Refresh grant и silent SSO continuation не
получают interactive claim. До redirect module
создаёт one-time re-auth attempt, связанный с текущими sessionRef и identity, а BFF связывает тот же
attempt со state/PKCE transaction. Nest валидирует один access JWT и передаёт его `jti`, signed
interactive time и attempt ID в `VerifiedHumanReauthentication`; module atomically проверяет и
consume-ит exact attempt. Missing, malformed, replayed или старый fact даёт
`reauthentication_required`. Поэтому re-auth в session B и последующий refresh session A не могут
повысить assurance A.

Каждая operation получает собственный discriminated error union. Общий stable vocabulary:

- `invalid_input` — malformed provider-neutral value после protocol adapter;
- `identity_conflict` — безопасно разрешить mapping нельзя;
- `principal_disabled` — local Principal не может стать Subject;
- `session_expired` / `session_ended` / `session_not_found` — distinct finite states;
- `identity_mismatch` — re-auth доказал не ту external identity;
- `reauthentication_required` — session валидна, но assurance слишком старая;
- `idempotency_key_reused` — тот же key, другой canonical fingerprint;
- `dependency_unavailable` — retryable proof/transport adapter outcome до trusted application call;
  module не превращает это в allow, а unexpected storage failure возвращает как `internal_error`;
- `internal_error` с opaque correlation ID — unexpected invariant/storage failure без leakage.

Public result не возвращает raw provider claims, email, token, cookie или audit record. Successful
`establishHumanSession`/`establishServiceSession` возвращают local sessionRef, expiry и
`TrustedSubject`; credential material создаёт adapter. Successful retry воспроизводит тот же local
session effect.

## Invariants и state model

### External Identity и Principal

1. Canonical `(issuer, subject)` уникален и навсегда принадлежит ровно одному Principal.
2. `issuer` — validated canonical absolute HTTPS identifier от adapter и сравнивается exact.
   Module не lower-case-ит и не удаляет path/trailing slash; allowlist, discovery и canonical form
   принадлежат production adapter/config.
3. `subject` — opaque case-sensitive provider value. Его нельзя trim/lowercase, вычислять из email
   или показывать caller.
4. `kind` (`human` / `service`) после создания Principal неизменяем. Изменение требует explicit
   future administrative migration, не sign-in side effect.
5. Unknown verified human identity может atomically создать один active Principal. Unknown service
   identity никогда auto-provision не делает: service Principal и exact permission grants заранее
   создаются owner-controlled operation/migration.
6. Email — changeable verified observation, не lookup/merge/transfer key. Mapping сначала и всегда
   идёт по `(issuer, subject)`.
7. Изменившийся verified email у известной identity не меняет Principal. Если email не конфликтует,
   observation можно обновить; если совпадает с другой identity, текущий mapping сохраняется,
   observation не переносит state и оставляет redacted conflict audit.
8. Новая unknown identity с email, уже наблюдаемым у другого Principal, не merge-ится и не создаёт
   второй Principal автоматически: возвращается `identity_conflict` до отдельного recovery
   решения. Это подтверждённый owner contract.

Uniqueness `(issuer, subject)` и transaction являются final race arbitration. Application branch,
увидевший concurrent insert, перечитывает winner и возвращает тот же Principal/session outcome либо
explicit conflict; случайный unique violation не течёт в transport.

### Principal, account security и permissions

Минимальный `Principal` state для #49: `active | disabled`. Disabled — security state, а не удаление:
External Identity, audit и historical sessions сохраняются, но `establishHumanSession`,
`establishServiceSession`, обе re-auth operations и `resolveSubject` fail closed; active
sessions считаются ended/revoked в той же administrative transaction. Re-enable/recovery/delete/
export не входят в #49.

Human `Platform Account` позже является private projection над human Principal. #49 не создаёт
profile/member-visible fields и не выдаёт service Principal ни Platform Account, ни Member Profile,
ни Membership. Identity module владеет только identity/security facts, которые эта projection
сможет безопасно прочитать через будущий narrow facet.

Permissions принадлежат Platform и хранятся как explicit grants:

- обычный human получает пустой permission set; active Membership позже определяется не здесь;
- human author получает `materials:author`, publisher — отдельно `materials:publish`;
- admin получает перечисленные permissions, а не magic bypass через provider role;
- service Principal получает только явно provisioned grants, необходимые MCP consumer; он никогда
  не наследует human Membership или permissions из IdP token;
- permission grant/revoke виден на следующем `resolveSubject`, даже если cookie/token ещё не истёк.

`identity:admin` резервирует narrow owner-controlled administrative capability; наличие этого
permission не означает implicit access ко всем Materials. Production bootstrap/grant transport не
входит в #49: tests используют explicit owner-controlled fixtures, а public unauthenticated route
запрещён.

Current Materials `AuthorPolicy` adapter вызывает `checkPermission(principalId,
"materials:author")` и отдельно `"materials:publish"`; он не доверяет permission snapshot из
transport. Future `ContentAccess` может принимать freshly resolved `TrustedSubject`, но Membership
policy всё равно остаётся в owning module.

### Platform Session

1. Session принадлежит ровно одному Principal, имеет absolute maximum 7 days и хранит `createdAt`,
   `expiresAt`, `authenticatedAt`, `endedAt?` и rotation/security version. Обычный request не
   продлевает absolute expiry.
2. Local sessionRef сам по себе не bearer credential. BFF хранит его только в protected server-side
   context, а Nest принимает его лишь вместе с valid Logto access JWT и проверяет ownership внутри
   module.
3. Expired, ended, unknown или disabled session никогда не возвращает Subject.
4. Sign-out сначала копирует JWT/sessionRef в request-local memory и немедленно уничтожает
   persisted BFF context/cookie; затем bounded best-effort вызывает local `endSession` и provider
   refresh revoke/end-session. Если backend/provider недоступен, signed-out response не ждёт их;
   захваченная пара JWT + sessionRef не живёт дольше принятого five-minute JWT window.
5. Re-auth требует того же `(issuer, subject)` и Principal, обновляет `authenticatedAt`, при
   необходимости rotates adapter credential и не создаёт новый Principal.
6. Session expiry не зависит от provider role/Membership и не продлевается простым request. Logto
   access JWT и recent re-auth fact имеют maximum 5 minutes; refresh выполняется server-side,
   single-flight и с максимум одним retry.
7. Subject — current short-lived application fact. Caller не сохраняет его как durable permission
   cache и не сериализует целиком в browser/shared cache.

## Transaction и idempotency contract

`establishHumanSession` владеет одной Kysely transaction:

1. canonicalize и fingerprint trusted command;
2. claim `(operation, idempotencyKey)` с bounded caller/attempt scope;
3. lock/read External Identity by canonical issuer/subject;
4. для unknown human проверить safe email conflict и atomically insert Principal + identity;
5. проверить active state и загрузить current grants;
6. insert finite Platform Session;
7. append redacted identity audit fact;
8. complete idempotency effect с Principal/session IDs;
9. commit и только затем разрешить adapter выдать credential/cookie.

`establishServiceSession` является отдельным command: он разрешает только заранее provisioned
service External Identity/Principal и никогда не проходит human email/auto-create branch.

`beginHumanReauthentication` в одной transaction проверяет current identity/session/Principal и
создаёт short-lived single-use attempt. `completeHumanReauthentication` блокирует session и attempt,
проверяет exact identity mapping, fresh `prompt=login` authorization-code fact и unused JWT `jti`,
обновляет assurance/rotation, consume-ит attempt, пишет audit и сохраняет idempotency effect.
`endSession` является idempotent: повтор возвращает то же ended state. Permission/disable admin
write в будущем блокирует Principal, меняет grants/state и invalidates sessions atomically.

Idempotency key для browser flow — stable opaque attempt ID, созданный до redirect и привязанный к
state/PKCE transaction. Если provider или network падает до получения verified identity, database
effect отсутствует. Если response потерян после commit, callback/retry использует тот же key и
получает тот же local session effect. Тот же key с другим canonical issuer/subject/kind либо mode
возвращает `idempotency_key_reused`.

Хранить replayable raw callback, authorization code, PKCE verifier, token или cookie в idempotency
table запрещено. One-time protocol artifacts принадлежат BFF/IdP adapter и удаляются/истекают
отдельно. Identity idempotency table capability-specific; существующий `authoring_idempotency` не
расширяется в generic command bus.

## Adapter contracts

### Logto production и deterministic fake

Internal proof port минимально умеет начать Logto authentication interaction и завершить/verify
его в соответствующий typed verified identity value. Owner-approved shape — authorization code,
high-entropy state, S256 PKCE без nonce, exact issuer/audience и access JWT maximum 5 minutes;
application interface выше от этого не меняется.

Production Logto adapter обязан:

- allowlist-ить issuer и строго проверять signature, exact Platform audience, expiry, subject,
  state/S256 PKCE и callback binding; nonce не отправляется, а если pinned runtime неожиданно его
  отправляет, matching validation становится обязательной;
- для `establishHumanSession` требовать `inside_verified_email` из того же валидированного access
  JWT. Logto custom access-token script выдаёт claim только когда primary email совпадает с
  verified email interaction; произвольный raw email от BFF запрещён, missing/mismatch fail closed;
- для re-auth требовать `inside_interactive_at` из того же JWT только при direct
  authorization-code issuance после newly submitted verified interaction, сверять его с JWT
  `iat`/`jti`, exact subject, one-time attempt и maximum five-minute recency; refresh grant и
  authorization без нового interactive verification обязаны не содержать этот claim;
- ограничивать timeout/retry и различать invalid proof от provider unavailable;
- отбрасывать roles/groups/permissions и не передавать raw claims в application;
- не логировать secrets, token, code, state, PKCE verifier, email или full subject.

Deterministic fake реализует тот же proof port, а не `IdentityPrincipals`. Он принимает explicit
fixture identities и scripted outcomes (`verified`, `invalid`, `expired`, `unavailable`) без clock,
randomness или network, скрытых от test. Он нужен protocol/application orchestration tests; core
acceptance всё равно вызывает настоящий `IdentityPrincipals` с real PostgreSQL.

Contract corpus проходит production adapter на protocol fixtures и fake adapter на теми же
normalized successful/failure outcomes. Fake не должен уметь создавать Subject или обходить
Principal/session mapping.

### Next BFF cookie/session adapter

Next adapter живёт только в server graph и:

1. для sign-in создаёт bounded BFF attempt; для re-auth сначала вызывает
   `beginHumanReauthentication` с current JWT + sessionRef, затем связывает returned attempt ID со
   state/S256 PKCE material и safe same-origin return path;
2. начинает provider interaction через approved proof adapter/endpoint;
3. на sign-in callback проверяет browser binding, получает Logto access JWT для exact Platform
   audience и передаёт только JWT + stable attempt ID в narrow backend proof endpoint; stable
   attempt ID является idempotency metadata, не credential. Trusted Nest adapter валидирует JWT,
   требует signed `inside_verified_email` и вызывает `establishHumanSession`. Re-auth callback после
   `prompt=login` передаёт такой же access JWT + существующий sessionRef и bound attempt ID; Nest
   требует fresh signed `inside_interactive_at` и только затем строит
   `VerifiedHumanReauthentication`;
4. после commit сохраняет encrypted provider context и opaque local sessionRef в protected BFF
   cookie/session wrapper; browser JavaScript не видит ни одно значение;
5. использует `Secure`, `HttpOnly`, explicit `SameSite`, narrow Path, bounded Max-Age; mutations
   проверяют Origin и CSRF; callback не принимает arbitrary external return URL;
6. при logout сначала уничтожает persisted BFF context/cookie на exact attributes, сохранив
   credential только в request-local memory; затем bounded best-effort завершает local/provider
   sessions;
7. для последующего backend call передаёт server-to-server только current Logto access JWT + local
   sessionRef; refresh происходит single-flight, server-side и не более одного retry.

BFF может показывать coarse authenticated/reauth-required state, но не решает permissions,
Membership или ContentAccess. Protected response остаётся `private, no-store`.

### Nest Logto JWT + sessionRef adapter

Nest adapter проверяет Logto access JWT до application call: signature, exact Logto issuer, exact
Platform audience, expiry/not-before, non-empty subject, algorithm/key allowlist и bounded payload.
Отдельный opaque sessionRef приходит от BFF server graph. Adapter строит
verified session identity, затем обязательно вызывает `resolveSubject({ identity, sessionRef })`;
module проверяет identity/session ownership. Permission claims, provider roles или copied Subject
из token игнорируются.

Обычный interactive access JWT строит только human session identity. На первой sign-in operation
тот же JWT обязан нести минимальные Logto-signed private claims `inside_verified_email` и
`inside_interactive_at`; последующие resolve operations не используют email как identity key или
permission fact. Service adapter является
отдельной composition/command path: он принимает только pre-provisioned M2M identity с собственным
token-class/audience contract и вызывает `establishServiceSession`; human resolver никогда не
интерпретирует app/client `sub` как человека. Re-auth endpoint принимает согласованную пару access
JWT + sessionRef и non-credential attempt metadata, требует `inside_interactive_at` от нового
`prompt=login` authorization-code interaction и atomically consume-ит attempt/JWT `jti`. Token,
полученный refresh grant-ом, не содержит interactive claim и не может обновить `authenticatedAt`.

Один request-scoped mapping используется REST/OpenAPI и MCP adapters. Controllers/guards могут
отклонить unauthenticated request и передать trusted Subject дальше, но не реализуют role/access
matrix. `AuthorPolicy` становится узким adapter от Materials operations к
`IdentityPrincipals.checkPermission`; static `MaterialsModule` импортирует production identity
provider вместо передачи policy object через `register()`.

Platform не выпускает второй JWT и не вводит собственный signing-key lifecycle. JWT без active
matching sessionRef и sessionRef без valid Logto JWT fail closed.

## Audit, privacy и redaction

Capability append-only audit фиксирует минимум:

- event ID/time, operation и outcome/reason code;
- opaque local Principal, External Identity и Session IDs, когда они уже известны;
- permission/security-state change actor в будущей owner-controlled operation;
- opaque correlation/attempt ID и adapter kind/version, достаточные для расследования.

В application audit и structured logs запрещены raw email, issuer/subject pair, provider claims,
authorization code, access/id/refresh token, cookie, session presentation, PKCE verifier, state,
nonce, secrets и raw request/response. Для provider diagnostics разрешён non-reversible bounded
fingerprint внешней identity только при documented key/retention policy; по умолчанию audit
ссылается на internal external-identity ID.

Operational logs получают stable result code и correlation ID. Unexpected errors становятся
`internal_error`; database constraint name, SQL, stack или provider body не уходят transport
caller. Exact retention, encryption-at-rest, support access и erasure/export policy остаются
future security/operations decisions. Protected audit query не входит в #49.

## Scenario contract

| Scenario | Observable outcome через interfaces |
|---|---|
| Первый human sign-in | одна transaction создаёт один Principal, одну External Identity и одну session; Subject active с current explicit grants |
| Concurrent first sign-in | unique issuer/subject + retry/read winner дают один Principal; ни orphan session, ни raw constraint error |
| Returning sign-in | existing mapping возвращает тот же Principal и новую finite session; новый Principal не создаётся |
| Changed email, тот же issuer/subject | mapping не меняется; safe observation update/audit, никаких merge/transfer |
| Duplicate email, новая identity | `identity_conflict`, no Principal/session creation до recovery decision |
| Changed email конфликтует с другой identity | исходный Principal остаётся authority; observation не переносит account state, conflict redacted/audited |
| Callback retry после uncertain response | тот же key/fingerprint replay-ит тот же session effect; другой fingerprint даёт `idempotency_key_reused` |
| Provider outage до proof | distinct retryable unavailable, никакой database mutation |
| Invalid issuer/audience/signature/expiry/state/PKCE | proof adapter fail closed, `IdentityPrincipals` не вызывается |
| Local session expiry | `session_expired`, Subject отсутствует; cookie/token expiry не может продлить local expiry |
| Logout и повтор logout | local session ended atomically; повтор успешен как idempotent replay; cookie удаляется adapter-ом |
| Disabled Principal | новая/существующая session не разрешается в Subject; active sessions invalidated, audit использует opaque IDs |
| Permission revoke при живой cookie | следующий `resolveSubject` возвращает current reduced set; token claim не сохраняет доступ |
| Unknown service identity | no auto-provision, explicit conflict/unrecognized outcome |
| Known service Principal | Subject kind `service`, только explicit grants, без Platform Account/Member Profile/Membership |
| Successful re-auth | exact same identity/session, updated assurance/rotation; sensitive retry проходит after threshold |
| Re-auth другой identity | `identity_mismatch`, исходная session не повышает assurance и не меняет Principal |
| Re-auth в session B и refresh session A | A остаётся stale; только unconsumed attempt, начатый из A и завершённый fresh interactive JWT, повышает A |
| Replay re-auth JWT/attempt | consumed attempt или keyed `jti` fingerprint fail closed; assurance другой session не меняется |
| Storage failure before commit | rollback Principal/identity/session/audit/idempotency вместе; retry с тем же key безопасен |

## Persistence и code placement для implementation

Topology следует current capability convention; exact filenames могут упроститься, но ownership и
import direction обязательны:

```text
apps/backend/src/modules/identity-principals/
  index.ts                              # public DTO/results/token/module only
  identity-principals.module.ts         # static Nest composition
  create-identity-principals.ts         # canonical assembly for Nest + tests
  application/
    identity-principals.interface.ts
    establish-session.ts
    resolve-subject.ts
    begin-reauthentication.ts
    complete-reauthentication.ts
    end-session.ts
    ports/external-identity-proof.ts     # internal true-external seam
  domain/
    principal.ts
    external-identity.ts
    platform-session.ts
    permissions.ts
  infrastructure/
    postgres/
      migrations/0003_identity_principals.ts
      principal-persistence.ts
      session-persistence.ts
      idempotency.ts
      audit.ts
    idp/logto/                           # owner-approved production adapter
    idp/fake/
  adapters/
    nest/trusted-session.ts

apps/web/src/shared/auth/                # server-only BFF adapter; no domain policy
apps/backend/test/integration/identity-principals.test.ts
apps/backend/test/adapters/identity-*.test.ts
apps/web/test/module/auth-session.test.ts
```

Logical table ownership:

- `principals`: immutable kind, active/disabled state, timestamps/security version;
- `external_identities`: canonical issuer + opaque subject unique, Principal FK, versioned keyed
  verified-email HMAC без raw email;
- `principal_permissions`: unique Principal/permission explicit grants;
- `platform_sessions`: Principal FK, finite times, end/rotation/security version;
- `identity_reauthentication_attempts`: session FK, expiry не более 5 minutes, consumed time и
  keyed JWT `jti` fingerprint для one-time completion;
- `identity_idempotency`: operation/key/fingerprint + stable Principal/session effect;
- `identity_audit_events`: append-only opaque IDs + finite event/outcome codes.

PostgreSQL owns uniqueness, FKs, valid finite states/times and final race arbitration. Application
owns workflow and transaction. Semantic persistence functions centralize lock order and constraint
mapping; generic `PrincipalRepository`, fake database или Unit of Work не вводятся.

Для #49 verified email canonicalizes как trimmed Unicode NFC + lower-case comparison value и
хранится только как versioned keyed HMAC lookup/fingerprint; raw email не попадает в identity
tables или audit. Это достаточно для changed/duplicate conflict и не обещает будущую Account
projection. Session хранит fixed `expiresAt <= createdAt + 7 days`, re-auth timestamp и end state;
request не sliding-продлевает expiry. Первый human получает empty grants. Admin/service bootstrap и
grant/revoke transport не входят в thin vertical: schema/interface поддерживают explicit grants,
tests используют owner-controlled fixtures, public unauthenticated bootstrap route запрещён. Audit
retention и production key custody остаются infrastructure gates, не меняя module seam.

## Dependency-aware implementation slices для #49

После отдельного owner GO на этот contract и первый slice все slices остаются commits/stopping
points одного #49 PR, а не отдельными packages или deployables. Следующий slice начинается только
после focused gates предыдущего.

1. **Thin end-to-end milestone.** Pin Logto runtime/SDK, Experience UI upstream + minimal fork,
   disposable IdP PostgreSQL и fake email connector; добавить minimal Platform migrations,
   `establishHumanSession`/`resolveSubject`/`endSession`, Next BFF и Nest Logto JWT + sessionRef
   adapter.
   Production app shell показывает только sign-in, safe signed-in state и sign-out без Account/
   Profile/provider claims. Stop, когда один real email-code journey создаёт ровно один Principal и
   finite session, returning request возвращает trusted Subject, sign-out очищает BFF context и
   заканчивает local session при доступном backend, а browser graph/logs не содержат token/PII.
2. **Identity safety.** Добавить concurrent first sign-in, changed/duplicate email outcomes,
   disabled state, session expiry/end, idempotency replay/mismatch, rollback и redacted audit. Stop,
   когда core scenario corpus проходит через тот же interface и independent DB connections.
3. **Protocol and fork hardening.** Добавить callback replay/state/S256 PKCE/JWT negative corpus,
   provider/email/JWKS outage, bounded refresh, key rotation и disposable Experience UI upstream
   patch rebase. Stop, когда invalid protocol never calls module, retry не дублирует effect и fork
   имеет repeatable security-update path.
4. **Permissions and consumer convergence.** Добавить explicit grants, human author/admin и service
   fixtures, re-auth assurance, Materials `AuthorPolicy`, API/MCP static composition. Stop, когда
   web/API/MCP используют одну mapping path, disabled/revoked permission fails closed и service не
   наследует human Membership.
5. **Final #49 proof.** Полный adapter/application/real-PG/composition corpus, migration/generated
   type drift, app-shell evidence и repository gates. Stop, когда все #49 criteria трассируются
   evidence, а deployment/credentials/operations остаются единственными перечисленными unknowns.

Provider claim или raw token в `IdentityPrincipals` остаются architectural mismatch; Logto details
живут только в adapters. Thin milestone — первый retained commit/stopping point того же #49 PR, а
не отдельно merged half-vertical.

## Verification matrix и traceability к #49

| #49 criterion | Design contract | Обязательное evidence в #49 |
|---|---|---|
| issuer/subject создаёт или восстанавливает ровно один Principal | immutable unique mapping, one transaction, race reread | real-PG first/returning/concurrent tests |
| email change не создаёт merge/transfer | email только observation; issuer/subject authority | changed-email application tests |
| duplicate email и identity conflict explicit | new identity fails `identity_conflict`; known mapping never transfers | duplicate/conflicting-email tests + audit assertion |
| invalid/expired issuer/audience/signature/state/PKCE fail closed | production proof adapter validates before module | protocol fixture matrix; assert module spy untouched |
| secrets/tokens/PII redacted | strict audit/log allowlist, opaque IDs | log/audit snapshot negative assertions |
| web/API используют один trusted mapping interface | BFF sends Logto JWT + sessionRef; Nest validates identity; module checks session ownership | BFF/Nest mapping + composition tests |
| route handlers не владеют roles/access policy | current grants loaded inside module; AuthorPolicy adapter | architecture guardrail + exhaustive adapter tests |
| disabled Principal не получает Subject | disabled checked on establish/re-auth/resolve; sessions invalidated | real-PG disable/live-session scenario |
| service Principal не наследует human Membership | immutable kind, pre-provision only, explicit grants | service fixture + MCP/material permission tests |
| provider outage/retry не дублирует Principal/session | no call before proof; atomic idempotency replay after proof | scripted fake outage + uncertain-response retry tests |
| focused application/protocol/real-PG tests | test placement and slices above | unit/adapter/integration/composition reports |
| migration/composition соответствует repository | central migration authority, generated types, one pool, static modules | migration replay/drift + API/MCP composition tests |

## Решения и remaining risks

Owner-approved choices:

1. Logto OSS — единственный IdP; Better Auth исключён. Proof использует owner-maintained Experience
   UI fork, state + S256 PKCE без nonce и отдельную IdP topology.
2. BFF предъявляет Nest Logto access JWT для exact Platform audience + opaque local sessionRef.
   Platform JWT/signing-key lifecycle не вводится.
3. New identity с duplicate verified email возвращает hard `identity_conflict`; auto-merge,
   auto-transfer и second Principal запрещены до audited recovery.
4. Platform Session absolute maximum — 7 days без sliding extension; access JWT и recent re-auth —
   maximum 5 minutes; refresh server-side single-flight с максимум одним retry.
5. First retained milestone — thin end-to-end до production app-shell sign-in/safe signed-in state/
   sign-out, без Account/Profile UI. Все slices остаются одним #49 branch/PR.

Implementation defaults, выбранные после explicit owner delegation продолжить без detail gates:

6. Первый human имеет empty grants; `materials:author`, `materials:publish` и `identity:admin` — exact
   v1 permission vocabulary. Production bootstrap/grant transport не создаётся до real owner
   consumer; service Principal не auto-provisionится.
7. Identity хранит только versioned keyed email HMAC для conflict detection; raw email/claims не
   входят в identity persistence/audit.

Remaining risks не меняют application interface: production issuer/domain, secrets/HMAC key
custody, fork/security updates, email deliverability, backup/PITR, audit retention/support access,
timeout/rate-limit/clock-skew и JWKS key lifecycle доказываются local gates и future infrastructure
specification. Они запрещают объявлять Logto production-ready в #49, но не блокируют thin local
vertical.

Материальный hard-to-reverse provider/deployment/key-management trade-off после proof может
потребовать focused ADR в implementation PR. Сейчас ADR преждевременен: module interface и local
invariants provider-neutral, а deployment решения ещё не доказаны.

## Verifiable stopping condition

#49 готов к owner merge review, когда один retained sign-in → Principal → finite Platform Session →
current trusted Subject path проходит через approved production proof adapter, Next BFF и Nest API,
а тот же application interface с deterministic fake и real PostgreSQL доказывает весь scenario и
traceability corpus выше. Permissions и disabled state проверяются при каждом mapping, adapters не
содержат authorization rules, route handlers не обходят module, migrations/generated types и static
composition соответствуют current repository conventions.

Provider при этом не называется production-ready: deployment, credentials, monitoring, recovery,
data-retention и operational proof остаются явно перечисленными future decisions. `ContentAccess`,
Membership, Telegram linking, Account/Profile UI и merge также остаются за stopping condition.
