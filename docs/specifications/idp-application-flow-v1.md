# IdP application flow specification v1

Статус: owner утвердил Logto OSS application flow и proof gates: отдельная IdP topology, fork
Logto Experience UI, state + S256 PKCE без nonce, balanced lifetime profile 7d/5m/5m и blocked
equal-email conflict; Better Auth исключён,
[Platform #82](https://github.com/sachkov-inside/platform/issues/82), 2026-08-24.

Документ проверяет Logto OSS на primary sources, определяет application contract и exact proof
gates для будущего implementation ticket
[Platform #49](https://github.com/sachkov-inside/platform/issues/49). Это не ADR, не production
implementation и не production operational acceptance. Provider direction, UX ownership, nonce
policy, lifetime contract, target topology, identity-conflict policy и итоговый protocol contract
подтверждены. Production code первого #49 slice, credentials, deploy и merge остаются отдельными
owner gates.

## 1. Authority, результат и граница

### Repository-owned authority

- [Platform MVP brief](../product/platform-mvp-brief.md) требует email sign-in, private Platform
  Account и связь с Telegram Membership.
- [Platform v1 specification](platform-v1.md) первоначально оставляла identity
  choice provisional. Owner decision 2026-08-24: Logto OSS является единственным proof target;
  Better Auth не остаётся fallback.
- [Platform #48](https://github.com/sachkov-inside/platform/issues/48) задаёт границу: IdP
  authenticates, Platform authorizes; provider roles/claims не дают Membership или content access.
- [`CONTEXT.md`](../../CONTEXT.md) определяет `External Identity`, `Principal` и `Platform Session`.
  `Platform Session` — application term, а не имя Logto session, grant или SDK cookie.
- #82 сформулировал и зафиксировал owner choice. Production code, credentials, IdP deployment и
  Platform persistence входят только в последующие implementation/infrastructure tickets.

### Проверяемый результат

Будущий proof считается application-ready, только если он демонстрирует один путь:

```text
email proof -> provider identity -> BFF authentication context -> audience-bound JWT
            -> Nest trusted token mapping -> (issuer, subject) -> local Principal
```

Provider подтверждает личность. Nest adapter принимает только проверенный token identity, а
application-owned `IdentityPrincipals` возвращает local `Principal`. Email, provider role, scope и
profile claim не являются merge key или Platform permission.

### Не исследуется как принятое решение

- Production domain, capacity, SLO, backup/PITR, alerting, incident response, email deliverability,
  secret custody и release topology.
- Account recovery, Telegram linking, Membership, `ContentAccess`, private Account/Profile UI.
- Exact Logto package/image versions сейчас не находятся в repository manifest или lockfile.
  Version и image digest должен заморозить сам proof.

## 2. Decision handoff

### Принятое owner decision

1. **Logto OSS — единственный target для #49 proof. Better Auth исключён и не поддерживается как
fallback.** Причина: отдельный OIDC provider сохраняет принятую provider/application seam,
redirect-based email-code UX, официальный Next App Router BFF SDK, resource-audience JWT и
официальный Nest/JWKS validation path
([Next App Router quick start](https://docs.logto.io/quick-starts/next-app-router),
[Nest JWT guide](https://docs.logto.io/api-protection/nodejs/nestjs)).

2. **Первый proof использует owner-maintained fork Logto Experience UI**, а не prebuilt UI с
видимым Logto branding. Proof обязан pin-ить upstream commit/version, минимизировать fork diff и
доказать repeatable build, upgrade/rebase и security-update path. Успешный proof станет входом для
application ADR; текущее решение ещё не объявляет fork production-ready.

3. **Proof принимает pure authorization-code flow со state + S256 PKCE без nonce.** Pinned client
не патчится ради nonce; вместо этого callback transaction, state/verifier binding, replay и ID
token issuer/audience/signature/time validation проходят negative corpus ниже. Если выбранная
package version неожиданно отправляет nonce, matching nonce validation становится обязательной.

4. **Balanced lifetime contract:** BFF session имеет absolute maximum 7 days; Platform API JWT —
maximum 5 minutes; recent re-auth fact — maximum 5 minutes. Logout немедленно удаляет local BFF
context и отзывает refresh capability best-effort; owner явно принимает residual offline-JWT
window не более 5 minutes. Refresh выполняется server-side, single-flight и с максимум одним retry.

5. **Target topology использует отдельные Logto deployable, IdP database/migration authority,
owner-maintained Experience UI fork и external email connector.** Platform не применяет миграции к
Logto schema, не читает её напрямую и не импортирует IdP runtime code в application modules.
Production DNS/TLS, backup/PITR, SLO, alerting, secrets, deliverability и rollout остаются будущей
infrastructure specification и отдельными release gates.

6. **Разные external identities с одинаковым verified email дают `identity_conflict`.** Platform не
создаёт второй authenticated Subject, не merge-ит Principals и не переносит identity автоматически.
Разрешение требует отдельного audited recovery flow; email остаётся mutable account attribute, а не
identity key.

7. **Owner утвердил flow и proof gates этого документа как implementation contract #49.** Approval
разрешает перейти к совместной ticket decomposition и коду после выбора первого slice; оно не даёт
production deployment, credentials, merge или autonomous-delivery permission.

Провал Logto hard gate останавливает #49 и возвращает вопрос provider strategy владельцу; он не
запускает автоматическую реализацию другого auth stack. Logto остаётся proof target, а не
production-accepted provider: infrastructure proof и release gates ниже всё ещё обязательны.

### Material caveats

- Full `Bring your UI` upload и `Hide Logto branding` перечислены как Cloud-only; для полного OSS
  UI control официальный matrix предлагает fork исходников. Owner выбрал fork для proof. Basic
  logo/color/custom CSS в prebuilt experience не удовлетворяют выбранному ownership contract
  ([OSS limitations](https://docs.logto.io/logto-oss),
  [brand customization](https://docs.logto.io/customization/match-your-brand),
  [custom CSS](https://docs.logto.io/customization/custom-css)).
- Logto `ENDPOINT` влияет на OIDC issuer. Смена branded endpoint после появления Principals меняет
  ключ `issuer + subject` и требует явной identity migration; endpoint следует зафиксировать до
  proof/cutover
  ([deployment configuration](https://docs.logto.io/logto-oss/deployment-and-configuration),
  [OIDC stable identifier](https://openid.net/specs/openid-connect-core-1_0.html#ClaimStability)).
- Исследованный Logto JS source snapshot — commit
  [`b873b8a`](https://github.com/logto-io/js/tree/b873b8ae067b87a1f8a0184605b753690216a349),
  а не ещё не выбранная package version. Он генерирует state и S256 PKCE, но не `nonce`, и его ID
  token verifier проверяет signature/issuer/audience/time, но не nonce
  ([sign-in source](https://github.com/logto-io/js/blob/b873b8ae067b87a1f8a0184605b753690216a349/packages/client/src/client.ts#L322-L358),
  [callback source](https://github.com/logto-io/js/blob/b873b8ae067b87a1f8a0184605b753690216a349/packages/client/src/client.ts#L574-L614),
  [ID token verifier](https://github.com/logto-io/js/blob/b873b8ae067b87a1f8a0184605b753690216a349/packages/client/src/adapter/defaults.ts#L9-L40)).
  Pinned version должен быть проверен заново; HEAD snapshot не является version selection.
- `nonce` является OPTIONAL в OIDC authorization request; если client его отправляет, он обязан
  проверить тот же claim в ID token. Owner принял для proof pure code flow со state + S256 PKCE без
  nonce; это решение не разрешает частичную схему «отправили, но не проверили»
  ([OIDC request](https://openid.net/specs/openid-connect-core-1_0.html#AuthRequest),
  [ID token validation](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation)).
- Любой self-contained JWT, уже выданный до logout/revocation, остаётся пригодным для offline
  проверки до `exp`, если resource server не делает дополнительную online/session проверку.
  Поэтому local Platform disable обязан проверяться после identity mapping на каждом request, а
  access-token TTL — отдельный owner security/availability choice.

## 3. Protocol facts и Platform invariants

### Primary protocol facts

1. OIDC определяет `sub` как locally unique, never reassigned identifier внутри issuer; только
   комбинация `iss + sub` гарантированно является устойчивым user identifier. Email такой гарантии
   не имеет
   ([OIDC Core §5.7](https://openid.net/specs/openid-connect-core-1_0.html#ClaimStability)).
2. ID token client обязан проверить exact issuer, audience, signature, expiry и, когда nonce был
   отправлен, matching nonce
   ([OIDC Core §3.1.3.7](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation)).
3. OAuth Security BCP распространяет PKCE на web applications, требует non-leaking challenge
   method; сейчас таким методом является `S256`. Authorization server обязан связать code с
   verifier
   ([RFC 9700 §2.1.1](https://www.rfc-editor.org/rfc/rfc9700.html#section-2.1.1)).
4. JWT verifier должен allowlist-ить допустимые algorithms и не принимать другой `alg` из
   недоверенного header
   ([RFC 8725 §3.1](https://www.rfc-editor.org/rfc/rfc8725.html#section-3.1)).
5. Discovery issuer должен точно совпасть с issuer, из которого построен well-known URL
   ([RFC 8414 §3.3](https://www.rfc-editor.org/rfc/rfc8414.html#section-3.3)).
6. OAuth resource indicator даёт audience restriction для конкретного API
   ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html)).

### Normative Platform application invariants

Это application contract, выведенный из repository authority, а не provider facts:

- `ExternalIdentityKey = { issuer, subject }`; unique constraint не допускает двух Principals для
  одного key.
- Verified/mutable email — account attribute. Changed email сохраняет Principal; одинаковый email
  у разных `issuer + subject` не merge-ит и не transfer-ит Principal.
- BFF владеет browser redirect, transient protocol state, provider tokens и secure cookie. Browser
  JavaScript не получает refresh token или Platform API bearer token.
- Nest token adapter проверяет cryptography и protocol claims и строит только соответствующий
  typed verified identity value. Provider roles/scopes/email не превращаются в `Subject`
  permissions.
- Application mapping проверяет local Principal state. Disabled Principal не становится
  authenticated application `Subject` даже с валидным provider JWT.
- Human и service Principal разрешаются разными application commands/ports. M2M `sub` нельзя
  случайно принять за human identity.
- Authentication dependency failure не становится anonymous success и не создаёт Principal или
  session частично.

## 4. Logto OSS: проверенные факты

### Email-code и branded redirect

- После подключения email connector Logto позволяет выбрать `Email address` + email verification
  code как sign-in method. Удаление connector немедленно ломает такой flow
  ([email connectors](https://docs.logto.io/connectors/email-connectors)).
- Sign-in email template получает verification code; code истекает через 10 минут, и TTL сейчас не
  настраивается
  ([email templates](https://docs.logto.io/connectors/email-connectors/email-templates)).
- OSS не включает built-in email service, поэтому нужен внешний SMTP или HTTP email service;
  официальный SMTP connector поддерживает `SignIn` template и `{{code}}`
  ([OSS limitations](https://docs.logto.io/logto-oss),
  [SMTP connector](https://docs.logto.io/integrations/smtp),
  [HTTP email connector](https://docs.logto.io/integrations/http-email)).
- Prebuilt UI настраивает logo, favicon, light/dark colors и custom CSS. Полное Bring Your UI и
  скрытие `Powered by Logto` для OSS недоступны как hosted switches
  ([match your brand](https://docs.logto.io/customization/match-your-brand),
  [OSS limitations](https://docs.logto.io/logto-oss)).
- Self-hosted `ENDPOINT=https://auth.example.com` задаёт public endpoint и OIDC issuer; HTTPS может
  завершаться на reverse proxy
  ([deployment configuration](https://docs.logto.io/logto-oss/deployment-and-configuration)).

### Next BFF, callback, state, PKCE и nonce

- Официальный App Router SDK конфиг требует `appId`, confidential `appSecret`, Logto endpoint,
  Next base URL и cookie secret не короче 32 characters. Production example включает
  `cookieSecure`
  ([Next quick start](https://docs.logto.io/quick-starts/next-app-router)).
- SDK route handles exact registered callback and exchanges authorization code server-side. Для API
  resource SDK получает JWT access token и обновляет его refresh token-ом после expiry
  ([callback](https://docs.logto.io/quick-starts/next-app-router#handle-callback),
  [API resources](https://docs.logto.io/quick-starts/next-app-router#api-resources)).
- В source snapshot client генерирует random state и verifier, отправляет S256 challenge, хранит
  `{redirectUri, codeVerifier, state}`, сравнивает callback state и посылает verifier при token
  exchange
  ([client source](https://github.com/logto-io/js/blob/b873b8ae067b87a1f8a0184605b753690216a349/packages/client/src/client.ts#L322-L358),
  [callback verification](https://github.com/logto-io/js/blob/b873b8ae067b87a1f8a0184605b753690216a349/packages/js/src/utils/callback-uri.ts#L13-L49),
  [token exchange](https://github.com/logto-io/js/blob/b873b8ae067b87a1f8a0184605b753690216a349/packages/js/src/core/fetch-token.ts#L54-L82)).
- Snapshot не генерирует nonce. OIDC разрешает это для pure authorization-code flow, а RFC 9700
  считает проверенный PKCE самостоятельной robust CSRF defense; Platform всё равно вправе задать
  более строгую owner policy
  ([OIDC nonce](https://openid.net/specs/openid-connect-core-1_0.html#AuthRequest),
  [RFC 9700 §4.7](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.7)).
- SDK по умолчанию хранит encrypted session data в `HttpOnly`, `SameSite=Lax`, optionally `Secure`
  cookie с 14-day max age. Это container для provider tokens и protocol state, а не local Principal
  authorization
  ([cookie source](https://github.com/logto-io/js/blob/b873b8ae067b87a1f8a0184605b753690216a349/packages/node/src/utils/cookie-storage.ts#L41-L85)).
- RSC не может записать refreshed cookie: без external session storage expired cached token может
  refresh-иться заново на каждом RSC request. SDK предлагает mutation-capable Server Action либо
  external `sessionWrapper`/Redis/database
  ([RSC limitation](https://docs.logto.io/quick-starts/next-app-router#fetch-access-token-for-the-api-resource),
  [external storage](https://docs.logto.io/quick-starts/next-app-router#use-external-session-storage)).

### Nest JWT boundary, session и logout

- Logto выдаёт JWT для зарегистрированного API resource; resource identifier становится `aud`.
  API должен проверить signature/JWKS, `iss`, `aud`, `exp` и нужные protocol scopes
  ([global API resource](https://docs.logto.io/authorization/global-api-resources)). В Platform
  scopes не становятся business authorization; proof просит только identity-bearing token для
  exact Platform API audience.
- Официальный Nest guide использует `jose`, remote JWKS, exact issuer и explicit audience checks
  ([Nest guide](https://docs.logto.io/api-protection/nodejs/nestjs)). Его RBAC examples не являются
  Platform permission model.
- Logto OSS позволяет trusted operator добавить private claims в user access token через
  `getCustomJwtClaims`; result сливается с payload и подписывается как один access JWT
  ([custom access token](https://docs.logto.io/developers/custom-token-claims),
  [script context](https://docs.logto.io/developers/custom-token-claims/create-script)). Platform
  использует только `inside_verified_email` и `inside_interactive_at`: оба выдаются лишь при direct
  authorization-code issuance с matching newly submitted verified interaction; interactive time
  создаётся trusted script рядом с final JWT `iat`. Refresh grant и silent SSO continuation не
  получают interactive claim. Это сохраняет BFF → Nest presentation ровно как Platform-audience
  access JWT + opaque local sessionRef.
- API resource access-token TTL настраивается в seconds; default — 3600 seconds
  ([RBAC API resource properties](https://docs.logto.io/authorization/role-based-access-control#api-resources)).
- Logto различает central sign-in session, app grant и app-local session/tokens. Default central
  session TTL — 14 days; access continuity может идти через refresh tokens отдельно
  ([sessions](https://docs.logto.io/sessions),
  [session configuration](https://docs.logto.io/sessions/session-configs)).
- Current SDK sign-out пытается revoke refresh token, очищает local tokens и redirect-ит на Logto
  end-session. Revocation failure намеренно не блокирует local clear
  ([SDK source](https://github.com/logto-io/js/blob/b873b8ae067b87a1f8a0184605b753690216a349/packages/client/src/client.ts#L381-L412)).
- End-session удаляет central session, но при `offline_access` app grant/refresh chain может жить до
  explicit revocation или expiry. Existing JWT также не меняется задним числом; short access-token
  TTL ограничивает residual bearer window
  ([sign-out semantics](https://docs.logto.io/end-user-flows/sign-out),
  [JWT permission change behavior](https://docs.logto.io/authorization/global-api-resources#optional-handle-user-permission-change)).
- `prompt=login` принудительно обходит SSO и подходит для future re-auth primitive
  ([re-authentication](https://docs.logto.io/end-user-flows/sign-out#enforce-re-authentication-on-every-access)).

### Self-hosted operations

- Mandatory runtime dependencies: Logto core/container и PostgreSQL 14+; production endpoint/TLS,
  persistent DB и external email connector нужны для выбранного journey. Demo Compose прямо
  запрещён для production и может потерять bundled database data при повторном запуске
  ([OSS start](https://docs.logto.io/logto-oss/get-started-with-oss),
  [deployment](https://docs.logto.io/logto-oss/deployment-and-configuration)).
- Multi-instance deployment должен одинаково конфигурировать instances и разделять connector
  folder; Redis 6 central cache optional и сейчас хранит well-known data, а не auth/session data
  ([multi-instance connector folder](https://docs.logto.io/logto-oss/deployment-and-configuration#shared-connectors-folder),
  [central cache](https://docs.logto.io/logto-oss/central-cache)).
- Upgrade состоит из version update, Logto CLI database alterations и restart/gradual swap.
  Alteration scripts транзакционны и имеют down path
  ([upgrade](https://docs.logto.io/logto-oss/upgrading-oss-version),
  [database alteration](https://docs.logto.io/logto-oss/using-cli/database-alteration)).
- OSS audit logs покрывают authentication events, но Management API operations не записываются;
  OSS operator сам чистит устаревшие audit records
  ([audit logs](https://docs.logto.io/developers/audit-logs)).
- Official docs не закрывают для Platform production backup/PITR, restore drill, capacity, alerting,
  secret rotation, image-digest policy, disaster recovery и email delivery reputation. Это
  operational unknowns, а не отрицательные product facts.

## 5. Rejected alternative: Better Auth

Owner исключил Better Auth из #49. Раздел сохраняет собранные primary-source facts только как
историю рассмотренной альтернативы; они не задают fallback, implementation scope или proof gates.

### Same-origin email OTP и UI

- Better Auth монтируется в Next catch-all route `/api/auth/[...all]`; application сама владеет
  sign-in UI и вызывает client/server endpoints
  ([Next integration](https://better-auth.com/docs/integrations/next)). Branded provider redirect
  для email OTP не нужен.
- Email OTP plugin требует application-supplied `sendVerificationOTP`; send и verify являются
  отдельными POST endpoints. Default OTP: 6 digits, 300-second expiry, 3 attempts; storage default
  указан как plaintext и должен быть явно заменён hash/encryption option для proof
  ([Email OTP options](https://better-auth.com/docs/plugins/email-otp#options)).
- `signIn.emailOtp` автоматически создаёт user, если его нет, если только `disableSignUp` не
  включён. Текущий source atomically consumes OTP, создаёт user/session и устанавливает cookie
  ([Email OTP sign-in](https://better-auth.com/docs/plugins/email-otp#sign-in-with-otp),
  [source snapshot `45e6d0e`](https://github.com/better-auth/better-auth/blob/45e6d0e889e95214a36a7b29d8134c1f4b90daf3/packages/better-auth/src/plugins/email-otp/routes.ts#L613-L712)).
- Поскольку flow same-origin и не использует OAuth authorization response, callback/state/PKCE/
  nonce tests для этого path имеют результат `not applicable`, а не `passed`.

### Session и Nest token boundary

- Primary session — opaque `session_token` cookie, связанный с server-side session row. Default
  expiry — 7 days и sliding refresh после default 1-day update age
  ([session management](https://better-auth.com/docs/concepts/session-management)).
- JWT plugin не заменяет primary session: он выдаёт отдельный JWKS-verifiable JWT для external
  service. Default issuer/audience — `BASE_URL`, subject — Better Auth user ID, expiry — 15 minutes
  ([JWT plugin](https://better-auth.com/docs/plugins/jwt#modify-issuer-audience-subject-or-expiration-time)).
- По умолчанию JWT payload содержит весь user object. Если решение когда-либо будет пересмотрено,
  Platform была бы обязана использовать
  `definePayload` allowlist и explicit issuer/audience; provider role/email не должны попасть в
  permission boundary
  ([JWT payload option](https://better-auth.com/docs/plugins/jwt#modify-jwt-payload)).
- Nest может offline verify JWT через JWKS, exact issuer и audience. JWT plugin хранит signing key
  material в отдельной `jwks` table, key rotation выключена по умолчанию и требует явного
  `rotationInterval`/grace period
  ([JWT verification and rotation](https://better-auth.com/docs/plugins/jwt)).
- Sign-out/revoke удаляет Better Auth session, но independently verified JWT не делает database
  check и живёт до `exp`. Это тот же residual bearer class, что у Logto API JWT
  ([session revoke](https://better-auth.com/docs/concepts/session-management#revoke-session),
  [offline JWT verification](https://better-auth.com/docs/plugins/jwt#verifying-the-token)).

### Operations и application ownership

- Better Auth использует database для users, sessions, accounts, verification records и plugin
  tables. PostgreSQL adapter поддерживается; secondary storage optional
  ([database](https://better-auth.com/docs/concepts/database),
  [PostgreSQL adapter](https://better-auth.com/docs/adapters/postgresql)).
- CLI может `migrate` built-in Kysely database или `generate` SQL/schema. Platform specification
  требует checked-in migrations as authority, поэтому такой вариант потребовал бы
  generate/review/check-in SQL
  и применять его repository migration path, а не выполнять floating `npx auth@latest migrate` в
  production
  ([Better Auth CLI](https://better-auth.com/docs/concepts/cli),
  [Platform data authority](../specifications/platform-v1.md#production-baseline-и-provisional-choices)).
- Внешние runtime dependencies для email journey: Platform Next runtime, PostgreSQL, выбранный
  email service, persistent auth secret и JWT keys. Отдельного Logto service/connector volume нет,
  но security flow, UI, schema upgrades, rate limits и auth availability становятся Platform
  ownership.
- Better Auth security defaults включают origin validation, `SameSite=Lax`, Fetch Metadata defense
  для first-login CSRF и production rate limiting. Proof всё равно должен зафиксировать trusted
  origins/proxy headers и отдельные email abuse limits
  ([security](https://better-auth.com/docs/reference/security),
  [rate limit](https://better-auth.com/docs/concepts/rate-limit)).

## 6. История выбора topology

| Concern | Logto OSS target | Rejected Better Auth alternative | Application conclusion |
|---|---|---|---|
| Runtime shape | Separate OIDC provider + Postgres + email connector | Library/routes inside Next + Postgres + email sender | Logto лучше сохраняет provider/application seam; Better Auth уменьшает services, но усиливает coupling |
| Email journey | Hosted redirect, fixed 10-minute code | Same-origin UI, configurable 5-minute default OTP | UX owner должен увидеть оба real journeys; docs screenshot недостаточен |
| Branding | Logo/color/CSS; full UI/hide mark ограничены в OSS | Полностью application-owned page | Branding остаётся Logto owner gate, но не включает автоматический fallback |
| Callback defense | Authorization code + state + S256 PKCE; researched snapshot без nonce | Email OTP не имеет OAuth callback | Сравнивать `nonce passed` нельзя; сначала owner выбирает security policy/topology |
| BFF state | Encrypted token cookie, optional external wrapper | Opaque session cookie + server session row | Оба скрывают durable credential от browser JS; expiry/refresh различаются |
| Nest interface | OIDC issuer/JWKS/resource audience JWT | JWT plugin issuer/JWKS/audience JWT | Один provider-neutral Nest verifier port может иметь два contract-tested adapters |
| Stable mapping | OIDC `issuer + sub` | Explicit JWT issuer + Better Auth user ID `sub` | Platform unique key одинаков для обоих; email всегда attribute |
| Logout | Local clear + refresh revoke + end-session; JWT residual до exp | Session revoke/local cookie clear; JWT residual до exp | Local disable и short TTL нужны независимо от provider |
| Upgrade authority | Logto CLI alterations в отдельной IdP DB | Checked-in Platform migration generated from plugin schema | Нельзя смешивать две migration authorities в одной schema |
| Outage blast radius | Login/refresh IdP outage; warm-JWKS Nest can verify unexpired JWT | Next/auth route or auth DB outage; warm-JWKS Nest can verify unexpired JWT | Exact degradation matrix обязателен; ни один вариант не даёт magic availability |

Строки таблицы являются **выводами из cited facts разделов 4–5**. Owner decision поверх сравнения:
Logto OSS выбран, Better Auth исключён.

## 7. Application flow contract

### Logto target: first sign-in

1. Browser отправляет same-origin mutation в Next BFF. BFF создаёт one-time transaction со state,
   PKCE verifier и exact callback URI и redirect-ит на frozen branded Logto issuer.
2. Logto собирает email и подтверждает verification code через configured external email connector.
   Ни email, ни code не проходят через Platform backend.
3. Logto возвращает только `code + state` на registered callback. BFF сравнивает transaction/state,
   redeem-ит code вместе с verifier, проверяет ID token и уничтожает transaction.
4. BFF устанавливает encrypted `HttpOnly; Secure; SameSite=Lax` local cookie. Refresh/access/ID
   tokens не возвращаются Client Component.
5. Для Nest BFF получает JWT точно для Platform API resource и посылает его в `Authorization:
   Bearer` server-to-server.
6. Nest allowlist-ит algorithm, проверяет JWKS signature, exact issuer, exact audience, `exp` и
   non-empty `sub`; для первого human sign-in он также требует Logto-signed
   `inside_verified_email` и валидный `inside_interactive_at`, затем строит `VerifiedHumanSignIn` без
   role/scope.
7. `IdentityPrincipals.establishHumanSession` в одной transaction либо создаёт один Principal +
   External Identity, либо возвращает существующий. Только после local active-state check adapter
   выдаёт application `TrustedSubject` и opaque sessionRef.

Шаги 1–4 опираются на Logto SDK behavior, а 5–7 — на repository-owned application contract. Они не
утверждают, что provider token сам является Platform authorization.

### Returning sign-in и email change

- Active BFF cookie использует cached unexpired API token; near/after expiry refresh происходит
  server-side. RSC path не должен бесконечно повторять refresh из-за невозможности записать cookie.
- После нового sign-in с тем же `issuer + sub` mapping возвращает тот же Principal.
- Изменённый verified email обновляет только account attribute через отдельный safe path; identity
  key не меняется.
- Два разных `issuer + sub` с одинаковым email дают explicit `identity_conflict`: второй
  authenticated Subject не создаётся. Provider-real и deterministic fake tests доказывают отсутствие
  second Principal, silent merge и transfer.

### Expiry, logout, disable и re-auth

- BFF session имеет absolute maximum 7 days. API JWT и bounded recent re-auth fact живут не более
  5 minutes; production implementation не может молча расширить эти значения.
- Expired/invalid BFF context не становится authenticated; refresh success обновляет server-side
  state, `invalid_grant` очищает local context и требует sign-in.
- Logout сначала гарантированно удаляет local BFF cookie/tokens, затем best-effort завершает
  provider session/revokes refresh capability. Уже украденный API JWT может жить до `exp`, но не
  более принятого 5-minute residual window.
- Disabled local Principal блокируется после cryptographic token validation и до любого use case.
  Это даёт немедленный Platform deny независимо от provider outage/JWT residual window.
- Sensitive future action начинает новую authorization request с `prompt=login`; успешный result
  даёт новый Platform-audience JWT с `inside_interactive_at`, который принимается только вместе с
  one-time Platform attempt, заранее связанным с текущей sessionRef и state/PKCE transaction.
  Refresh grant не получает interactive claim и не повышает assurance.

### Provider outage matrix

| Failure point | Required application outcome |
|---|---|
| Before sign-in transaction | Branded safe `authentication unavailable`; no cookie/Principal |
| Email connector unavailable | Bounded retry; no account/session/Principal; no account enumeration |
| Authorization callback before token exchange | Fail closed; consume/clear transaction; retry starts a new transaction |
| Valid BFF context + unexpired token + warm known JWKS | Existing protected request may continue; no provider online call |
| Expired token and refresh unavailable | No Nest call with expired token; safe unavailable/re-auth state, not anonymous content |
| Nest cold JWKS or unknown `kid` and issuer unavailable | No `Subject`; dependency-unavailable or unauthorized response, never allow |
| Local Principal disabled while provider unavailable | Immediate local deny despite valid JWT |
| Logout while provider unavailable | Local cookie removed; provider/global logout reported incomplete; no silent success claim |

Это **proposed application behavior**. Local proof обязан измерить его; production availability не
следует из offline-JWT properties автоматически.

## 8. Exact proof gates для #49

Каждый gate должен быть executable и сохранять machine-readable evidence в tests/CI. Manual owner
UX gate дополняет, но не заменяет automated assertions.

### A. Frozen environment and UX

| ID | Setup/action | Pass condition |
|---|---|---|
| A1 | Pin Logto image by version + digest, matching CLI, `@logto/next`, JWT library, Experience UI upstream commit/fork revision, Postgres image and email test service | Lock/config evidence names exact artifacts; no `latest`, floating `npx`, real credential or machine-local dependency |
| A2 | Configure one immutable HTTPS-like issuer, exact callback/post-logout URI and exact Platform API resource | Discovery `issuer`, configured expected issuer and token `iss` match byte-for-byte; `aud` is only the Platform API resource |
| A3 | Build forked Experience UI and render email entry, code entry, wrong/expired/resend/rate-limited/error states on branded domain at mobile and desktop | Owner accepts actual redirect continuity and forked composition; no Logto branding remains; keyboard/screen-reader smoke passes |
| A3a | Rebase the minimal fork onto the next compatible upstream patch in a disposable branch | Build/tests pass, fork delta stays inventoried and conflicts/update steps are recorded; an unmaintainable rebase fails the UX ownership gate |
| A4 | Capture a test email through fake SMTP/HTTP connector | Recipient, locale, SignIn template and code render correctly; secrets/code are absent from application logs |
| A5 | Stop email connector during send, then restore it | No provider/BFF/Principal session is created; retry is bounded and exactly one later code succeeds |

### B. Authorization callback and browser boundary

| ID | Setup/action | Pass condition |
|---|---|---|
| B1 | Inspect authorization redirect produced by the **pinned package** | `response_type=code`, exact redirect, high-entropy state, `code_challenge_method=S256`, challenge and Platform `resource`; no token or verifier in URL |
| B2 | Complete callback once, then replay same URL | First exchange succeeds; replay fails and creates neither second BFF context nor second Principal |
| B3 | Remove state, replace state, remove code, use wrong callback path | Every case fails before authenticated context; transaction is cleared/redacted |
| B4 | Redeem captured code with missing/wrong verifier, then correct verifier | Missing/wrong verifier fails; code cannot be converted into a usable token by attacker path |
| B5 | Inspect callback/session cookies in browser and server tests | Protocol state/provider tokens live only in host-bound `HttpOnly; Secure; SameSite=Lax` cookie or approved external wrapper; browser JS cannot read them |
| B6 | Run two interleaved browser sign-in transactions | State/verifier cannot be swapped or clobbered; each callback binds only to its initiating browser context |
| B7 | Inspect pinned SDK source and runtime request for nonce | Pinned client не отправляет nonce, что соответствует approved pure-code policy; если runtime всё же отправляет nonce, отсутствие matching validation fails |
| B8 | Inject provider errors and malicious query values; inspect structured logs | Stable redacted error taxonomy; no code, state, verifier, token, email, cookie or raw provider response in logs |

### C. JWT and Principal mapping

| ID | Setup/action | Pass condition |
|---|---|---|
| C1 | Request Platform resource token after verified email sign-in without Platform business roles in IdP | JWT is issued for exact API audience and contains only built-ins plus `inside_verified_email` and `inside_interactive_at`; custom script source is versioned and Logto roles never become Platform authority |
| C2 | Verify valid JWT in Nest with warm JWKS | Sign-in adapter emits `VerifiedHumanSignIn`; ordinary request emits `VerifiedHumanSessionIdentity`. Email is used only as changeable conflict observation, while scopes/roles never become permissions |
| C3 | Mutate signature, `alg`, issuer, audience, expiry/not-before and remove subject | Each token fails closed; accepted algorithms are explicit; ID token and token for another resource are rejected as API bearer |
| C4 | Sign first valid human token and call mapping concurrently N times | Exactly one Principal and one External Identity exist; every successful call returns the same Principal ID |
| C5 | Sign in again with same issuer/subject after changing `inside_verified_email` | Same Principal is returned; mutable email cannot alter identity key |
| C6 | Use deterministic fake tokens with different subjects and equal email | `identity_conflict`; no second authenticated Subject, Principal creation, merge or transfer; audited recovery is the only future resolution path |
| C7 | Disable local Principal, retain valid provider token | Nest verifies identity but application returns disabled deny and never emits authenticated `Subject` |
| C8 | Present M2M token whose `sub` is app ID | Human resolver rejects it; explicit service resolver maps only pre-provisioned service Principal and permissions |
| C9 | Put provider role/scope granting “admin/member” into otherwise valid token | Platform permissions do not change; tests prove authorization is local and provider-neutral |

### D. Expiry, logout, outage and key rotation

| ID | Setup/action | Pass condition |
|---|---|---|
| D1 | Use test access-token TTL, advance controlled clock past `exp` | Nest rejects expired JWT; BFF refreshes server-side once, persists refreshed state and retries at most once |
| D2 | Revoke/expire refresh capability | BFF clears local context and requires sign-in; no refresh loop or anonymous downgrade |
| D3 | Logout with provider healthy | Local cookie is gone, refresh is revoked and end-session completes; returning protected request requires auth |
| D4 | Reuse JWT captured immediately before logout | Result documents residual acceptance only until configured `exp`; no claim of instant JWT revocation |
| D5 | Stop Logto with a valid cached JWT and warm JWKS | Nest can validate until `exp`; local Principal disable still denies |
| D6 | Stop Logto before login, during exchange and during refresh | Outcomes match outage matrix; no partial Principal/session or duplicate on recovery |
| D7 | Stop issuer with cold JWKS, then present known and unknown `kid` tokens | Both fail closed without a key; response distinguishes dependency outage where safe but never allows |
| D8 | Rotate signing key with overlap/grace and refresh JWKS | New `kid` triggers bounded JWKS refresh; old unexpired token works only through declared overlap; unknown key never falls back to another algorithm |
| D9 | Keep session A stale; try authorization without `prompt=login`; re-auth session B; refresh A; then run `prompt=login` for A | Silent authorization, B re-auth and A refresh do not raise A assurance and carry no acceptable `inside_interactive_at`; only A's bound one-time attempt plus fresh interactive authorization-code JWT raises A without changing Principal/permissions |
| D10 | Exercise Next RSC after token expiry under load | No refresh-per-render storm: mutation-capable refresh or approved external session wrapper persists the new token |

### E. Self-hosted lifecycle

| ID | Setup/action | Pass condition |
|---|---|---|
| E1 | Seed empty dedicated Logto database with pinned CLI, restart instance | Deterministic healthy discovery/email/sign-in; no Platform migration touches Logto schema |
| E2 | Apply one representative pinned Logto upgrade and DB alteration in disposable copy | Pre/post sign-in corpus passes; rollback/down or restore path is rehearsed and timings captured |
| E3 | Run two Logto instances against shared DB/connector assets; optionally enable Redis | Both issue/verify consistently; restart/rolling replacement preserves flow; Redis failure behavior is measured |
| E4 | Restart/kill Logto, Postgres and connector independently | Health/readiness and user-visible outcomes are distinct; no secret/PII/token appears in logs |
| E5 | Export/restore disposable IdP database and required connector/config/key material | Restored issuer, subjects and signing continuity pass corpus. This remains local recovery evidence, not production DR approval |

## 9. Что local proof подтверждает и чего не подтверждает

### Подтверждает локально

- Exact versioned email sign-in, callback/session/JWT chain и negative protocol corpus.
- Stable `issuer + subject` mapping, idempotency, duplicate/changed email behavior и local disable.
- Separation provider claims from Platform permissions.
- Cookie/token redaction, expiry/refresh/logout residual и controlled outage/JWKS rotation behavior.
- Disposable initialization, upgrade, multi-instance и restore mechanics.
- Provider-neutral fake/test seam и Logto Nest/application contract без provider claims в
  Platform authorization.

### Остаётся до infrastructure/production acceptance

- Production DNS/TLS/reverse proxy, immutable issuer/domain cutover и redirect allowlist.
- Email provider credentials, SPF/DKIM/DMARC, delivery latency/reputation, bounce handling, quotas,
  abuse/CAPTCHA policy и support workflow.
- Secret/JWK custody and rotation, backup/PITR/restore RPO/RTO, capacity/load, multi-zone behavior,
  observability/alerting, audit retention, privacy requests и incident response.
- Image supply-chain/digest update policy, production upgrade/rollback/canary and release GO.
- Owner UX acceptance on real devices и production evidence, что утверждённые nonce/lifetime/logout
  policies выдерживают реальные availability и security constraints.

## 10. Owner decisions status

Owner decisions в scope #82 подтверждены 2026-08-24. Future infrastructure specification и каждый
implementation/merge gate остаются отдельными решениями; #49 начинается только с согласованного
первого slice.

## 11. Implementation gate

#49 production code начинается только после отдельного owner GO на этот contract и первый thin
end-to-end slice. Logto остаётся не production-ready до прохождения local proof gates и future
infrastructure acceptance. Если pinned Logto OSS не может
детерминированно выдать описанные minimal custom access-token claims, seam не расширяется ID token
или BFF assertion-ом: proof останавливается и возвращает решение owner.
