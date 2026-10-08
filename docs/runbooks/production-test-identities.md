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

Product A — «AI Engineering» (`ai-engineering`). Его id и закрытые уроки прохода названы в
`apps/web/test/production/pass-config.ts`: урок для тела и урок практики с картинкой и заданием.
Account `no-entitlement` также читает все закреплённые части бесплатной практики
`inside-content:aie-github-app` через learner MCP (#938, решение владельца 06.10.2026).
Проход сверяет версию, SHA-256 полного контекста и `END_CONTEXT`; закрытые уроки Product A
остаются клетками отказа. Бесплатный доступ этой практики должен сохраняться при переносах Content
(inside-content#33).

Второго опубликованного Product и опубликованного видео Product A в production нет. По решениям
владельца в #905 и #906 клетки Product B помечены «отложено до второго Product», а клетки video —
«отложено до первого видео Product A». Отчёт показывает их отдельным статусом, и они не делают job
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
  Billing-only и Materials-only читают каталог тарифов. В BFF нет GET-маршрута Billing: страница
  `/authoring/billing` читает каталог на сервере и любой отказ показывает пустым списком, поэтому
  отказ на ней не отличить от пустого каталога.
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
   `grants.applyBatch` (MCP `/mcp` или `/authoring/billing`): `product:<Product A>` для
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

## Когда выйдет первое видео Product A

1. Записать в `pass-config.ts` закрытый урок с основным видео.
2. Снять пометку «отложено до первого видео Product A» с клеток video и добавить их наблюдение в
   `access.spec.ts`. Видео проверяется выдачей playback session
   (`POST /api/material-video-playback-sessions`): она проверяет право `play` и подписывает короткий
   JWT без записи в базу, и allowlist уже называет её операцией чтения.

## Запуск

`deploy.yml` запускает проход после каждого deploy и rollback и передаёт SHA выпуска; без SHA
такой проход красный. Вручную: GitHub Actions → `Production access pass` → `Run workflow` на `main`.
Вход `deployed-sha` — SHA выпуска, который сейчас в production. Снаружи production его не показывает
(`/_health/*` закрыт на edge), поэтому без входа ручной отчёт пишет «не передан». Job загружает artifact
`production-access-report-<попытка>` с `report.json` и `report.md`. В отчёте для каждой клетки есть
deployed SHA, ожидание, факт и уровень. Cookies, токены и email в отчёт не попадают. Локально тот же
набор запускает `pnpm --filter @inside/web test:production-access` с теми же переменными.
