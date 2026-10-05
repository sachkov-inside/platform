# Telegram bot sign-in through Logto

Дата проверки: 2026-09-06. Связанные задачи: Platform #299, Workspace #116,
inside-telegram #24 / Draft PR #25.

Статус: исследование и предлагаемое направление, не принятое архитектурное решение
и не реализованная сквозная интеграция. Поведение закреплённой версии проверено по
исходникам; эксперимент с реальным Logto для Telegram-входа ещё не выполнен.

## Вывод

Существующий Telegram proof provider можно подключить к Logto через собственный
social connector. Logto остаётся единственным издателем пользовательских сессий и
токенов; Platform сохраняет Account и права доступа. Не нужен второй механизм
сессий, выдающий собственный Telegram JWT в обход Logto.

Это не только настройка кнопки. Основные дополнительные работы — сопоставление
существующих пользователей, допуск нового Account без email, добавление первой
почты и проверка повторных/конкурентных запросов.

## Проверенная локальная основа

- Platform worktree: `feat/299-telegram-sign-in`, исходный commit
  `eace49929710d8cedc8e5644d07ad3e786f7887a`.
- Logto: собственный образ `1.41.0-inside.2`; upstream `1.41.0`, исходники
  `91e55698a42f99438cd41ec2b16a1fc51dbdab8a`.
- Версии и локальные изменения определены в `infra/identity/logto/Dockerfile`;
  web использует `@logto/next` 4.2.10.
- `scripts/identity-proof-bootstrap.mjs` сейчас задаёт регистрацию с обязательным
  email и email verification code как способ входа.
- `infra/identity/logto/custom-access-token.js` выпускает
  `inside_verified_email` только на основании проверенного email в текущем
  authorization-code interaction. Telegram-доказательство там не реализовано.
- `apps/backend/src/modules/accounts/infrastructure/idp/logto/logto-access-token-verifier.ts`
  требует этот email для создания Account; `establish-account` также требует
  проверенную почту. Nullable email в БД не означает готовность продуктового потока.
- `apps/web/src/shared/auth/complete-platform-sign-in.server.ts` сначала разрешает
  существующий Account, затем пробует создать его. Новая политика отключения
  Telegram должна учитывать и первый путь, а не только создание Account.
- Telegram provider в Draft PR #25, commit
  `d46ff7cb6151d4e1225fa0ddf4c80329712b528d`, реализует
  `inside.bot-sign-in.v1`: browser-bound запрос, подтверждение в боте и одноразовое
  получение opaque subject. Он не создаёт Logto session, Account или PlatformLink.

## Предлагаемый поток

1. Сайт предлагает email и Telegram. Оба варианта начинают авторизацию в Logto.
2. Для Telegram Logto вызывает собственный social connector. Он создаёт запрос к
   provider и сохраняет связь с текущей авторизацией на сервере.
3. Страница ожидания открывает deep link нашего бота. Человек подтверждает вход
   в личном чате; исходная вкладка получает только безопасный статус запроса.
4. Исходная вкладка продолжает Logto callback. Connector проверяет state и
   одноразово получает подтверждённую identity через доверенный серверный вызов.
5. Logto находит того же пользователя либо регистрирует нового и выдаёт обычную
   сессию. Platform завершает вход по своим правилам допуска Account.

Logto OSS документирует `getAuthorizationUri` и `getUserInfo` как обязательные методы
social connector. Результат требует стабильный внешний `id`; email необязателен,
а передавать его можно только после проверки. Следовательно, Telegram username
не должен становиться ключом, а выдуманный email не нужен.
[Официальный контракт connector](https://docs.logto.io/logto-oss/develop-your-connector/implement-connectors),
[типы закреплённой версии](https://github.com/logto-io/logto/blob/91e55698a42f99438cd41ec2b16a1fc51dbdab8a/packages/toolkit/connector-kit/src/types/social.ts).

Сайт может направить пользователя сразу к выбранному social provider параметром
`direct_sign_in`; это всё равно Logto authorization, а не обход Logto. Точную
форму вызова следует проверить на установленном SDK перед реализацией.
[Direct sign-in](https://docs.logto.io/end-user-flows/authentication-parameters/direct-sign-in).

Секрет браузерного запроса нельзя помещать в social user info, rawData, URL или
аудитируемые callback data. Connector должен сам проверять state; сессионные
данные в проверенном helper читаются с последующим удалением. Нужен отдельный
разбор восстановления после сбоя между consume и завершением авторизации.
[Session helpers](https://github.com/logto-io/logto/blob/91e55698a42f99438cd41ec2b16a1fc51dbdab8a/packages/core/src/libraries/verification-helpers/social-verification.ts).

## Существующий Account не должен раздваиваться

Logto ищет пользователя по паре `connector.metadata.target` и внешнему identity id.
Возвращаемый connector `id` не задаёт внутренний Logto `sub`. Существующая связь
Telegram → Platform Account сама по себе не создаёт social identity в Logto.
Нужно связать её с точным прежним Logto user до автоматической новой регистрации.
[Social verification](https://github.com/logto-io/logto/blob/91e55698a42f99438cd41ec2b16a1fc51dbdab8a/packages/core/src/routes/experience/classes/verifications/social-verification.ts).

Пути, требующие проверки в реализации:

- Пользователь уже вошёл по email: Account API поддерживает social linking с
  подтверждением новой identity и дополнительной проверкой текущего пользователя.
  Нужны включённые permissions и scopes.
  [Account identities](https://github.com/logto-io/logto/blob/91e55698a42f99438cd41ec2b16a1fc51dbdab8a/packages/core/src/routes/account/identities.ts).
- Перенос ранее подтверждённой PlatformLink: серверный Management
  `PUT /users/:userId/identities/:target` позволяет записать identity в прежнего
  пользователя. Endpoint доверяет административному доступу, а не доказывает
  владение аккаунтом. Наш сервер обязан проверить свежий Telegram proof,
  актуальную связь и точный subject, исключить подмену и конфликт, сохранить аудит.
  Нельзя дать браузеру выбирать целевой Account или Logto user.
  [Management handlers](https://github.com/logto-io/logto/blob/91e55698a42f99438cd41ec2b16a1fc51dbdab8a/packages/core/src/routes/admin-user/social.ts).

Management POST identities не эквивалентен этому PUT: в закреплённой реализации
он передаёт `notImplemented` вместо session getter в `getUserInfo`, поэтому не
является готовым путём для проектируемого session-bound connector.

## Регистрация без почты и добавление почты позже

Logto 1.41 поддерживает `socialSignIn.skipRequiredIdentifiers`: проверенный social
вход может пропустить обязательные identifiers регистрации. Можно сохранить
email-вход и отдельно разрешить Telegram-регистрацию без email. Platform при этом
нужен явный доверенный тип допуска по Telegram, а не ослабление проверки всех JWT.
[Проверка обязательных полей](https://github.com/logto-io/logto/blob/91e55698a42f99438cd41ec2b16a1fc51dbdab8a/packages/core/src/routes/experience/classes/profile.ts#L210).

Но добавление первой почты не является готовым стандартным Account API сценарием
для social-only пользователя этой версии. Email endpoint безусловно требует
`identityVerified`. Middleware принимает пароль либо verified email/phone proof
типа `UserPermissionValidation`, связанный с текущим user. Proof нового email
имеет тип `BindNewIdentifier` и не подтверждает текущий аккаунт; Telegram social
proof middleware не принимает.
[Email endpoint](https://github.com/logto-io/logto/blob/91e55698a42f99438cd41ec2b16a1fc51dbdab8a/packages/core/src/routes/account/email-and-phone.ts),
[проверка текущего пользователя](https://github.com/logto-io/logto/blob/91e55698a42f99438cd41ec2b16a1fc51dbdab8a/packages/core/src/middleware/koa-auth/koa-oidc-auth.ts),
[создание email proof](https://github.com/logto-io/logto/blob/91e55698a42f99438cd41ec2b16a1fc51dbdab8a/packages/core/src/routes/verification/index.ts).

Возможный путь — узкий серверный процесс: свежая повторная Telegram-проверка,
проверка новой почты, контролируемое обновление того же Logto user и синхронизация
Platform. Он требует отдельного проектирования и проверки конфликтов. Совпадение
с email другого Account не разрешает автоматическое объединение.

## Надёжность и выключатель

В рассмотренных Account/Management handlers проверка наличия identity и запись —
разные операции; identities хранятся в JSONB. Эти проверки сами по себе не
доказывают безопасность двух одновременных привязок. Полный аудит всех внутренних
защит Logto не проводился, поэтому отсутствие глобальной защиты не утверждается.
Для нашей интеграции нужны сериализация, проверка результата после timeout и тест
двух одновременных первых входов.
[Management handlers](https://github.com/logto-io/logto/blob/91e55698a42f99438cd41ec2b16a1fc51dbdab8a/packages/core/src/routes/admin-user/social.ts),
[users schema](https://github.com/logto-io/logto/blob/91e55698a42f99438cd41ec2b16a1fc51dbdab8a/packages/schemas/tables/users.sql).

Выключатель должен блокировать начало и завершение нового Telegram-входа, включая
callback и путь существующего Account. Уже выданные сессии сохраняются согласно
требованию функции. Отказ Telegram не должен отключать email-вход. Mini App может
стать ещё одной поверхностью взаимодействия, но не должен создавать независимую
систему Account или сессий; для первого сквозного сценария он не требуется.

## Следующая проверка до полного интерфейса

С реальным локальным Logto и синтетическим Telegram proof проверить:

1. Новый Telegram пользователь получает обычную Logto session без email.
2. Повторный вход возвращает тот же Logto subject и Platform Account.
3. Старый email Account с подтверждённой Telegram-связью сохраняет subject и Account.
4. Добавление первой почты и последующий email-вход возвращают тот же Account.
5. Конфликты, два параллельных входа, timeout после consume не создают двойную связь.
6. Выключение во время ожидания не позволяет завершить новый вход.
7. Прежний email-вход работает без изменений; мобильный переход через бот проверен.

Все эти сквозные проверки на момент записи — **Not tested**. Проверенная работа
отдельного Telegram provider не доказывает готовность интеграции с Logto.
