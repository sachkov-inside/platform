# Тестовые identities production

Тестовые Accounts в production нужны проходу доступа (#905, полный проход — #906). Проход
входит ими без владельца и сверяет, что каждый видит и чего не видит. Этот документ перечисляет
identities, объясняет вход, секреты и порядок их замены. Значений секретов здесь нет.

## Перечень

Email каждой identity — алиас ящика владельца: `<ящик>+inside-access-<алиас>@<домен>`. Роли
`learner-product-a/b` используют существующие алиасы `learner-guide-a/b`: переименование ролей
в #1065 не меняет identities Logto (#1118). У остальных ролей алиас совпадает с именем identity.
Сопоставление задаёт `identityEmailAliases` в `apps/web/test/production/pass-config.ts`. Сам ящик
задаёт secret `PRODUCTION_ACCESS_MAILBOX` окружения GitHub `Production`, а в репозитории его нет.
Telegram у тестовых Accounts не используется. Тестового Platform Administrator нет: `platform:admin`
проверяется только локально.

| Identity | Состояние Account | Как выдано |
|---|---|---|
| `no-entitlement` | без прав и доступа | первый вход по коду из письма |
| `learner-product-a` | ученик Product A: `product:<Product A>` без срока | ручной AccessGrant, `sourceRef` `inside-production-access:learner-product-a` |
| `learner-product-b` | ученик Product B: пока без доступа | доступ ждёт второго Product (ниже) |
| `expired` | `product:<Product A>` со сроком в один час, истёк | ручной AccessGrant, `sourceRef` `inside-production-access:expired` |
| `materials-only` | право `materials:manage` | trusted owner bootstrap |
| `billing-only` | право `billing:manage` | trusted owner bootstrap |

Product A («AI Engineering», `ai-engineering`): его id и уроки прохода названы в
`apps/web/test/production/pass-config.ts`: закрытый урок `aie-ch2-modules` для тела и картинки,
закрытый урок `aie-ch2-plan-domain` и бесплатный урок `aie-ch1-agent-choice` для основного видео,
Product Task `aie-ch2-accounts-design` для задания. Эти fixtures принадлежат принятой программе
#1356; её source Content — `2f04e11848b9cc281d67a7b34e51dd83b7370418`, production manifest —
`4fe936c220af33ca7d818b9ce7db38944bf83228aab26437694eab15fb4b7ac1`.
Клетки матрицы с названием `practice` проверяют закрытый Product Task через страницу задания и
read-only `learning_task_read`. Код и заголовок задания публичны; отказ проверяет отсутствие
закрытого текста. Разрешённое MCP-чтение проверяет все закреплённые части, SHA-256 и `END_CONTEXT`.
Account `no-entitlement` проверяет отказ `task_not_available` без контекста на прежний код
снятой практики `aie-github-app` через действующий `learning_task_read`. Это отрицательная
проверка: старую практику не переносят в Product Tasks ради прохода. Положительная клетка
бесплатной практики отложена, как описано ниже. Materials-only и Billing-only проверяют
`billing:manage` через read-only `billing_productPrices_list` для Product A: первый получает
`forbidden`, второй читает цену.

Клетки `video` проверяют основное видео в браузере (#1821). Страница урока сама просит playback
session (`POST /api/material-video-playback-sessions`): сессия проверяет право `play` и подписывает
короткий JWT без записи в базу. Запись защищена у любого урока
([ADR 0041](../adr/0041-protected-recording-serves-any-access.md)), поэтому разрешённая клетка требует
токен в сессии. Затем проход запускает плеер и ждёт ответа Kinescope на запрос лицензии: Kinescope
выдаёт её, только когда authorization backend Platform повторил решение по этому токену. Ученик A
получает сессию и лицензию закрытого урока. Бесплатный урок курса открывается только Account со
связанным Telegram ([ADR 0042](../adr/0042-free-product-lesson-needs-telegram.md)), а у тестовых
identities Telegram нет: гость и Account без entitlement видят заглушку входа и сессии не получают.
Account без entitlement, ученик B, expired и anonymous просят со страницы
закрытого урока сессию того же видео, что получил ученик A, и получают `403 playback_unavailable`.
Гость вдобавок запускает эту запись без токена, и Kinescope отказывает в лицензии: так проверяется,
что authorization backend закрывает запись. Позицию видео проход не сохраняет: запрос записи не
проходит allowlist. Метрики и журналы плеера Kinescope тоже не уходят, но загрузка записи и запросы
лицензии остаются настоящими, поэтому статистика просмотров Kinescope может учитывать прогоны прохода.

Второго опубликованного Product в production нет. По решению владельца в #905 клетки Product B
помечены «отложено до второго Product». Отчёт показывает их отдельным статусом, и они не делают job
красным. Любая другая клетка «не проверено» делает job красным.

Все identities однажды приняли условия использования на первом экране входа. Проход данные Platform
не меняет: каждый его запрос проходит allowlist до отправки, а запрос вне allowlist раннер не
отправляет ([проход доступа после выпуска](production-release.md#проход-доступа-после-выпуска)).
Записи прохода есть только в Logto и в сессиях: one-time token на вход, PAT на прогон (после прогона
удаляется), сессии Logto и BFF тестовых identities. Если identity снова видит экран условий, проход падает: условия принимают
вручную, повторив вход из раздела «Одноразовая настройка».

## Вход прохода

- **Браузер.** Проход выпускает Logto one-time token через Management API и запускает обычный вход
  Platform. К запросу авторизации, который выпустил BFF, он добавляет `one_time_token` и
  `login_hint`. Logto `1.44.0-inside.7` проверяет токен своей страницей `/one-time-token`, и BFF
  получает настоящую сессию `@logto/next`. Страница входа для людей не меняется.
- **API и learner MCP.** Проход выпускает Personal Access Token identity на время прогона и
  обменивает его на два коротких токена (token exchange): Platform API и учебного MCP со scope
  `learning:read`. Scope даёт роль по умолчанию `Inside learner connection`, она есть у каждой
  identity ([учебный доступ](learning-practice-review.md#universal-learner-access-938)). После
  прогона PAT удаляется. Имя PAT
  начинается с `inside-production-access-`; истёкшие PAT прошлых прогонов проход удаляет перед
  выпуском нового. Публичный API ученика в production — learner MCP `/mcp/learning`: других
  публичных маршрутов к API для ученика нет
  ([таблица маршрутов](production-release.md#public-api-routes)). Поэтому клетки «через API»
  проверяются через learner MCP. Токен Platform API принимает владельческий MCP `/mcp`: через него
  Billing-only и Materials-only читают каталог цен. В web каталог цен владельца читает
  `GET /api/authoring/billing/catalog`; роли без `billing:manage` он отвечает отказом 403, а не
  пустым списком.
- **Первое установление Account.** Platform создаёт Account только по подтверждённому email
  (`inside_verified_email`). Вход по one-time token этот claim не даёт, поэтому Account без прав и
  учеников однажды входят по коду из письма. Accounts с правами создаёт owner bootstrap. Дальше хватает
  one-time token: Account уже существует.

## Секреты

| Имя в окружении GitHub `Production` | Вид | Что это |
|---|---|---|
| `PRODUCTION_ACCESS_LOGTO_APP_SECRET` | secret | ключ M2M-приложения Logto `Inside Production Access Pass` |
| `PRODUCTION_ACCESS_LOGTO_APP_ID` | variable | id того же приложения, не секрет |
| `PRODUCTION_ACCESS_MAILBOX` | secret | ящик владельца для алиасов; не variable: GitHub печатает env шага в публичном логе и маскирует только secrets |

Ключ M2M — единственный долгоживущий секрет прохода. У приложения роль
`Logto Management API access` и включён `allowTokenExchange`. Владелец принял риск: этот ключ
позволяет войти за любого пользователя Logto. Окружение `Production` доступно только workflow с
ветки `main`.

## Одноразовая настройка

Настройку выполняют один раз. Каждое её изменение production перечисляет отчёт задачи #905.

1. Создать в production Logto M2M-приложение `Inside Production Access Pass`: роль
   `Logto Management API access`, `customClientMetadata.allowTokenExchange: true`. Консоли Logto
   снаружи нет: приложение создаётся через Management API admin tenant внутри сервера
   (`http://localhost:3002`, seed-приложение `m-default`).
2. Записать ключ и id в окружение `Production` (таблица выше).
3. Создать через Management API пользователей Logto с `primaryEmail` из перечня.
4. Для `materials-only` и `billing-only` выполнить
   [owner bootstrap](production-delivery.md) с их Logto subject и правом.
5. Для остальных identities однажды войти в Platform по коду из письма в ящик владельца.
6. Каждой identity однажды пройти вход и принять условия использования.
7. Выдать доступ учеников от имени `billing-only` существующими операциями `grants.previewBatch` и
   `grants.applyBatch` (MCP `/mcp`): `product:<Product A>` для
   `learner-product-a` без срока и для `expired` со сроком в один час.

Новых публичных путей записи настройка не добавляет.

## Замена ключа M2M

1. Через Management API добавить приложению новый secret.
2. Записать его в `PRODUCTION_ACCESS_LOGTO_APP_SECRET` окружения `Production`.
3. Запустить workflow `Production access pass` и убедиться, что он зелёный.
4. Удалить у приложения старый secret.

Если ключ утёк, сначала удалите старый secret, затем выполните шаги 1–3: до этого ключ даёт вход за
любого пользователя.

## Когда выйдет второй Product

1. Выдать `learner-product-b` доступ `product:<Product B>` тем же ручным AccessGrant.
2. Записать Product B и его закрытый материал в `pass-config.ts`, снять пометку «отложено до второго
   Product» с клеток Product B и добавить их наблюдение в `access.spec.ts`.

## Когда меняются уроки с видео

Если урок `videoMaterialSlug` или `freeVideoMaterialSlug` в `pass-config.ts` снят с публикации,
лишился основного видео или поменял доступ, запишите туда другой закрытый или бесплатный урок
Product A с защищённой записью. Не меняйте доступ урока ради прохода.

## Запуск

`deploy.yml` запускает проход после каждого deploy и rollback и передаёт SHA выпуска; без SHA
такой проход красный. Вручную: GitHub Actions → `Production access pass` → `Run workflow` на `main`.
Вход `deployed-sha` — SHA выпуска, который сейчас в production. Снаружи production его не показывает
(`/_health/*` закрыт на edge), поэтому без входа ручной отчёт пишет «не передан». Job загружает artifact
`production-access-report-<попытка>` с `report.json` и `report.md`. В отчёте для каждой клетки есть
deployed SHA, ожидание, факт и уровень. Cookies, токены и email в отчёт не попадают. Локально тот же
набор запускает `pnpm --filter @inside/web test:production-access` с теми же переменными.

### Бесплатная практика после обновления курса 19.10.2026

Владелец отменил бесплатные главы и поручил убрать старые материалы (#1560, PR #1557).
Прежняя практика `inside-content:aie-github-app` больше не является действующим production-fixture.
Клетка `account-without-entitlement/read-free-practice/practice@learner-mcp` остаётся в отчёте
как отложенная до публикации актуальной бесплатной практики. Это не успешная проверка.
Не публиковать старую практику и не открывать закрытые уроки ради проверки. При появлении новой
бесплатной практики заменить fixture и убрать `freePracticeDeferred`. Отказы для закрытых практик
и автоматические проверки бесплатного доступа остаются обязательными.

### Проверенный объём и пересмотр отсрочек

`pass-config.ts` остаётся источником списка клеток. `report.json` и `report.md` отдельно показывают
`passed`, `failed`, `not_checked`, `skipped/excluded` и `deferred`. Счётчики относятся только к этому
списку, а не ко всем возможным сценариям продукта. В этом проходе разрешённых исключений клеток нет:
`skipped/excluded` равен нулю. Пропущенное наблюдение становится `not_checked` и делает итог красным.
Пустой список или список только из отсрочек также не даёт зелёный результат. Зелёный итог означает,
что наблюдённые клетки совпали и оставшиеся отсрочки ещё действуют. Он не означает полное покрытие.

Отчёт различает `sourceSha` проверяющего кода из checkout, `workflowSha` из контекста GitHub и
`deployedSha` работающего выпуска. Они могут различаться. Время `evaluatedAt` относится к оценке
отчёта, а не к моменту публикации продукта. Отсутствующий или неверный source SHA и неверное время
оценки не дают зелёный результат. Для запуска после deploy по-прежнему обязателен deployed SHA.

Существующие отсрочки Product B (#905) и бесплатной практики (#1540) имеют владельца, причину,
ссылку на решение, fixture и срок пересмотра в `deferralPolicies`. Условие проверяется по
`deferralFacts`: настройка `productB` или `freeTaskCode` сразу делает соответствующую отсрочку
недействующей. Эти факты описывают конфигурацию теста. Они не обнаруживают новую публикацию в
production автоматически. Для этого ограничения установлен срок пересмотра
`2026-11-30T00:00:00Z` в рамках #1858. Начиная с этого момента проход красный даже при неизменной
конфигурации. Срок не продлевается автоматически.

При готовом fixture нужно настроить его наблюдение, проверить доступ и убрать отсрочку. Если
срок истёк, владелец продукта проверяет актуальное состояние публикации; результат и основание
следующего срока фиксируются в связанном issue и изменении конфигурации. Пустые причина, владелец,
ссылка или срок, неизвестный fixture и отсутствующий факт конфигурации дают красный результат.
Наблюдение или ошибка для отсроченной клетки также требуют пересмотра. Публиковать старую практику,
менять права или создавать второй Product ради зелёного отчёта не требуется.

### Карта критических переходов

Эта карта указывает существующие доказательства. Она не заменяет результат проверок на конкретном
source SHA. Модульные проверки доказывают контракт функции; реальные HTTP-проверки также проверяют
транспорт. Навигационные проверки используют production Web с управляемым backend fixture, а
full-stack проверки используют отдельный backend. Production-проход проверяет настроенные клетки
через Chromium и MCP. Он не доказывает полный Telegram flow или полный E2E в WebKit.

| Сценарий | Существующее доказательство | Предел |
|---|---|---|
| Раннее действие до активации страницы, #1824 | [course-reading-handoff.test.ts](../../apps/web/test/browser-engines/course-reading-handoff.test.ts), сохранение главы, фокуса, раскрытия и прокрутки; [course-navigation-frame.spec.ts](../../apps/web/test/navigation/course-navigation-frame.spec.ts), быстрые стрелки и Back/Forward | Первый файл проверяет host handoff в целевых браузерных движках; второй проверяет маршруты production Web с fixture. Отдельное расследование обновления программы #1789 остаётся открытым |
| Обрыв входа, #1783 | [full-stack-session.test.ts](../../apps/web/test/contracts/full-stack-session.test.ts), обрыв сокета, тела и повторного соединения; [full-stack-diagnostics.test.mjs](../../scripts/full-stack-diagnostics.test.mjs), первый отказ и очистка секретов | Это доказательство обработки отказа и диагностики. Причина исторического сбоя не установлена одним успешным повтором |
| Часы устройства на час вперёд/назад и изменение во время входа, #1847 | [telegram-sign-in.test.ts](../../apps/web/test/browser-engines/telegram-sign-in.test.ts), `completes a valid sign-in when the device clock is offset` и `keeps waiting when the device wall clock jumps forward` | Целевой браузерный Telegram sign-in с управляемыми HTTP-ответами. Не полный Telegram approval в production |
| Независимые изменяемые fixture, #1768 | [billing-admin-access.spec.ts](../../apps/web/test/fullstack/billing-admin-access.spec.ts), собственный Product и цена для редактирования; [individual-payment-links.spec.ts](../../apps/web/test/fullstack/individual-payment-links.spec.ts), сохранённая цена отдельного fixture | Проверяет сценарии в disposable full-stack базе. Не изоляция production-данных |
| Завершение принадлежащих запуску процессов, #1621/#1829 | [test_supervisor.py](../../scripts/owned-process/test_supervisor.py), дочерние процессы, сигналы, detached-потомки и сохранение чужих процессов | Локальные контракты supervisor, не гарантия состояния всех процессов на сервере |
| Полнота production-отчёта и пересмотр отсрочек, #1858 | [production-access-pass.test.ts](../../apps/web/test/module/production-access-pass.test.ts), чистый verdict; [production-access-report-cli.test.ts](../../apps/web/test/module/production-access-report-cli.test.ts), exit code и реальные JSON/Markdown-файлы | CLI использует управляемые fixture-факты и время, не production credentials или реальные provider effects |
