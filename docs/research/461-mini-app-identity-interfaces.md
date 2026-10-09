# Mini App и первая login email: закреплённые interfaces

Задача: [Platform #461](https://github.com/sachkov-inside/platform/issues/461).
Дата проверки исходников: 2026-10-10. Telegram принадлежит `apps/telegram` в Platform.

## Статус доказательств

Это **source facts**, а не runtime proof. Network reads официальных документов и исходников
выполнены без запуска Logto, PostgreSQL, Docker, браузера или Storybook. Проверка cookies,
OAuth callback в Telegram WebView, конкурентных transactions и доставки пока не выполнена.

Исходный main закреплял Logto `1.44.0`, upstream
`79e9e3b0d9f505260d09c80d8a015e56fbc0ec01`, fork `inside.7`. Текущий draft в
`infra/identity/logto/versions.json` готовит fork `inside.8`, сохраняя тот же upstream, `@logto/next` `5.0.0`,
`@logto/node` `4.0.0`. Чтение upstream всегда использует этот revision.

## Mini App proof и обычный sign-in

[Telegram validation](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
задаёт HMAC-SHA-256: ключ `HMAC(WebAppData, botToken)`, затем HMAC строки полей без `hash`,
отсортированных по имени и разделённых LF. Backend проверяет подпись, `user.id`, `auth_date`
и свежесть. `initDataUnsafe`, username, имя и `start_param` не доказывают ownership.
Bot token остаётся у Telegram provider. Его bot/environment configuration выбирает ключ проверки.

Принятый локальный предел свежести: пять минут; future clock skew: не более 30 секунд.
Replay key строится из проверенной canonical строки и подписи, поэтому порядок query fields
не создаёт другой proof. Durable replay arbitration относится к provider transaction.

Существующий connector `infra/identity/logto/connector-inside-telegram/index.ts` сохраняет
`state`, `redirectUri`, `requestRef`, `browserSecret`, `expiresAt` в Logto connector session.
`getUserInfo` проверяет `inside_state`, request reference и срок, затем server-to-server consume.
Mini App использует этот же connector target `inside-telegram`, provider `subjectRef`,
`sign_in_subjects` и reservation/finalization. Добавление Mini App approval не создаёт новый subject.
Подпись запуска подтверждает Telegram identity; request и browser secret связывают её с interaction.

В pinned upstream
[social verification](https://github.com/logto-io/logto/blob/79e9e3b0d9f505260d09c80d8a015e56fbc0ec01/packages/core/src/routes/experience/classes/verifications/social-verification.ts)
получает user по connector target и social identity. Существующий Platform patch разрешает
подтверждённый `existingLink` через Platform, затем прикрепляет identity к этому Logto user.
Normal OIDC callback и official encrypted BFF cookie остаются владельцами сессии.

Локальные исходники SDK `@logto/client` `3.2.0` (зависимость Node `4.0.0`) показывают:
`signIn` генерирует state, codeVerifier и S256 challenge; сохраняет их через SDK storage;
возвращает authorization URL через `@logto/next/server-actions` `handleSignIn`. Поддерживаются
`directSignIn` и `extraParams`. Официальный
[direct sign-in](https://docs.logto.io/end-user-flows/authentication-parameters/direct-sign-in)
использует тот же normal authorization endpoint и social callback, с обычным fallback.

Pinned `oidc/init.ts` содержит whitelist `extraParams: Object.values(ExtraParamsKey)`.
`inside.8` добавляет только opaque Mini App reference. Helper социальной авторизации читает
original `provider.interactionDetails(...).params`, а не context из client social payload.
Provider получает SHA-256 digest штатных state/PKCE/client/redirect; после approval связывает
attempt ровно с одним новым Logto browser secret. Raw initData не нужен после redirect.
Точный draft contract и portable vector принадлежат
[Mini App protocol](../contracts/mini-app-sign-in-v1/protocol.md). BFF initiation ещё не подключён;
native cookie/redirect proof **PENDING**. Нельзя считать passing VM adapter tests proof Logto runtime.

Upstream `getConnectorSessionResult` удаляет connector storage перед HTTP consume. Draft patch
сохраняет storage для exact `inside-telegram` до окончания native interaction. Это позволяет
читать защищённый persisted receipt после неизвестного consume outcome, без второго consume.
Native callback retry и дальнейший Logto commit после network outage пока не проверены.

Перед implementation WebView continuation требуется Storybook catalog inspection после отдельного
сигнала координатора. Нельзя предполагать общую cookie Safari/Chrome и Telegram WebView.
Если текущий Account отличается, переход требует явного действия пользователя.
Logout не запускает автоматический sign-in при следующем render.

## Первая почта: native Experience interaction

Обычный Account API не решает Telegram-only owner verification на этом revision.
[`koa-oidc-auth.ts`](https://github.com/logto-io/logto/blob/79e9e3b0d9f505260d09c80d8a015e56fbc0ec01/packages/core/src/middleware/koa-auth/koa-oidc-auth.ts)
принимает для `identityVerified` password либо email/phone record с `UserPermissionValidation`.
Social record не подходит. Pinned
[`email-and-phone.ts`](https://github.com/logto-io/logto/blob/79e9e3b0d9f505260d09c80d8a015e56fbc0ec01/packages/core/src/routes/account/email-and-phone.ts)
требует `identityVerified` у **POST** `/api/my-account/primary-email`.
Живая [документация Account API](https://docs.logto.io/end-user-flows/account-settings/by-account-api)
содержит также PATCH и `verificationId` в примерах; wire shape берётся из pinned source.

Выбранный путь использует новую обычную sign-in interaction и существующие Experience APIs:

| Шаг | Pinned wire interface | Владелец проверки |
| --- | --- | --- |
| Проверить владельца заново | Telegram social verification в normal interaction | Logto connector и provider |
| Запросить код нового адреса | `POST /api/experience/verification/verification-code`, `{identifier:{type:"email",value},interactionEvent:"SignIn"}` | Logto |
| Проверить код | `POST /api/experience/verification/verification-code/verify`, `{identifier:{type:"email",value},verificationId,code}` | Logto |
| Подготовить первую identity | `POST /api/experience/profile`, `{type:"email",verificationId}` | Logto interaction |
| Применить profile | Interaction submit после проверки текущего user, MFA и availability | Logto |
| Согласовать Account | Тот же exact issuer/subject и проверенный email; reservation/finalization | Platform |

[`verification-code.ts`](https://github.com/logto-io/logto/blob/79e9e3b0d9f505260d09c80d8a015e56fbc0ec01/packages/core/src/routes/experience/verification-routes/verification-code.ts)
возвращает `verificationId`; record находится внутри interaction.
[`profile-routes.ts`](https://github.com/logto-io/logto/blob/79e9e3b0d9f505260d09c80d8a015e56fbc0ec01/packages/core/src/routes/experience/profile-routes.ts)
требует идентифицированного пользователя и MFA для email staging при SignIn.
[`Profile.setProfileByVerificationId`](https://github.com/logto-io/logto/blob/79e9e3b0d9f505260d09c80d8a015e56fbc0ec01/packages/core/src/routes/experience/classes/profile.ts)
использует `consumeForBind`, проверяет тип record, blocklist, отсутствие поля у текущего user
и уникальность адреса. `ExperienceInteraction.submit` повторяет availability и обновляет
`user.id`, а не создаёт другой user. Коды не проходят через Platform и не сохраняются в нём.

Implementation должна связать исходный authenticated Account, intent операции и свежую
interaction. Клиент не выбирает target subject. Перед provider commit резервируется fingerprint;
после commit finalization сохраняет прежние Account и Telegram link. Lost response требует
reconciliation по operation reference и фактическому provider результату, без общей DB transaction.
Нельзя освобождать reservation только по timeout неизвестной операции.

После attachment следующий email sign-in использует native `findUserByEmail`, поэтому source
path разрешает тот же user ID. Это ещё не доказательство runtime journey.

## TTL, limits, errors и проверки, которые остаются

Native Experience record принадлежит interaction. Account API records отдельно имеют десять минут
в `queries/verification-records.ts`; этот срок нельзя автоматически приписывать Experience.
Pinned `schemas/src/consts/verification-code.ts` задаёт default passcode TTL 600 секунд и
`maxRetryAttempts=10`. `schemas/src/consts/message-rate-limit.ts` задаёт default 10 отправок
за rolling window 600 секунд на нормализованный recipient. Это policy source facts, не измерения.
Текущий fork patch #116 делает reserve отправки атомарным и сохраняет его при неизвестном SMTP
результате. Его применение и runtime enforcement в этой сессии пока не доказаны.
`libraries/passcode.ts` проверяет срок и одноразовый результат. Message rate guard и Sentinel
принадлежат Logto. Configured пределы и attempt enforcement нужно проверить на isolated runtime.

Ошибки pinned profile path включают `session.verification_session_not_found`,
`user.email_already_in_use`, `user.missing_profile`; точное HTTP mapping проверяется conformance.
Публичная Platform UI показывает безопасный конфликт без раскрытия чужого Account.
Billing contact и его consent/code flow не участвуют в login proof.

Следующие обязательные runtime proofs: pinned Logto callback, прежний Account при обоих путях,
same-subject first email attachment, replay/TTL/limits, конкурентные первые входы и email race,
lost consume/attachment response, provider/application partial commit, switches и logout.
Physical Telegram iOS/Android/Desktop и внешняя email delivery остаются отдельной живой приёмкой.
