# Перенос приложения на sachkov.dev

Владелец запросил замену лендинга приложением в
[инициативе #857](https://github.com/sachkov-inside/platform/issues/857).
[Platform #421](https://github.com/sachkov-inside/platform/issues/421) готовит маршруты;
[Platform #416](https://github.com/sachkov-inside/platform/issues/416) доставляет принятую гостевую
главную. Этот runbook описывает переключение; наличие файла не означает, что production уже перенесён.

## Адреса и совместимость

| Адрес | После переключения |
| --- | --- |
| `https://sachkov.dev` | Web, `WEB_BASE_URL=https://sachkov.dev` |
| `https://www.sachkov.dev/<path>?<query>` | 302 без кэширования на основной адрес с теми же path/query |
| `https://inside.sachkov.dev/<path>?<query>` | 302 без кэширования на соответствующую страницу основного адреса |
| Старый `/callback` | 303 на `https://sachkov.dev/?authentication=failed`, без code/state, `Cache-Control: no-store`; пользователь повторяет вход |
| Разрешённые `/integrations/*` | Прямой proxy на API на обоих доменах; адреса провайдеров остаются прежними |
| Авторский и учебный MCP с их discovery | Только прежний `inside.sachkov.dev`; на основном домене 404 |
| `/health`, `/health/*`, `/_health/*`, неизвестные `/integrations/*` | 404 на основном и старом доменах |

`auth.sachkov.dev`, Telegram `platformUrl`, Kinescope callbacks, `MCP_SERVER_URL`, Logto issuer,
API audience и идентификатор Logto application сохраняются. Не менять `LOGTO_AUDIENCE` вместе
с доменом сайта: это идентификатор API resource. База, Account, Membership и прогресс не мигрируют.
Cookie браузера на старом hostname не становится сессией на новом: потребуется повторный вход
в ту же учётную запись. Вход, начатый до переключения, безопасно начинается заново.

Fragment (`#...`) не отправляется HTTP-серверу. Браузер сохраняет его при обычном переходе;
совместимость якорей зависит от целевой страницы, а не от Caddy.

## Исходное состояние перед применением

Сигнал владельца «Да, переносим» записан 09.10.2026 в [#421](https://github.com/sachkov-inside/platform/issues/421).
Этот PR готовит конфигурацию. Координатор выполняет DNS, Logto и серверные действия после merge и выпуска.
Снимок PR #422 от 08.09.2026 устарел: его IP, TTL и версия не являются текущими доказательствами.
Перед применением координатор записывает текущий выпуск/SHA, deployment state, VPS IP,
A/AAAA/CNAME и TTL apex/www/inside, binding лендинга, Logto redirect/logout URI и разрешённые домены видео.
IP берётся из действующей конфигурации production, а не из исторического PR.

## Подготовка до переключения

1. Завершить review/CI. Координатор ставит PR в merge queue и назначает единственный выпуск.
   Выбранный immutable release должен содержать гостевую главную #416, маршруты #421
   и порядок pre-pull до maintenance из [#1285](https://github.com/sachkov-inside/platform/pull/1285).
2. В Timeweb прочитать текущие A/AAAA/CNAME, TTL и привязку apex/www к приложению лендинга.
   Сохранить точные значения для возврата. Снизить TTL заранее, если панель позволяет; дождаться
   прежнего TTL. Не менять MX/TXT, `auth`, `telegram`, `inside` и другие поддомены.
3. В существующем Logto application добавить `https://sachkov.dev/callback` в redirect URIs
   и `https://sachkov.dev/` в post sign-out redirect URIs. Старые значения временно оставить для
   возврата. Не создавать новый client, не менять user identities и не запускать тестовый bootstrap.
   Проверить фактические настройки Kinescope на ограничения домена embedding; при наличии allowlist
   добавить `sachkov.dev` до переключения и сохранить прежний домен.
4. Получить TLS для apex/www **до переключения**: Caddy HTTP/TLS challenge на VPS не сможет
   проверить имя, пока DNS ведёт на лендинг. Использовать поддерживаемый DNS challenge или
   перенаправление ACME challenge с текущего хостинга, если панель это позволяет. Проверить
   выбранный способ в живой панели. Если заранее выпустить сертификат невозможно, координатор фиксирует
   короткое окно недоступности для DNS → ACME; не обещать бесшовное переключение.
5. Сохранить root-only копии `/etc/inside/runtime/{web,api,mcp,notifications-worker}.env`, активного Caddy fragment и настроек
   Logto. Не выводить секреты и не коммитить копии. Записать текущий успешный deployment state.

## Окно переключения

Сначала DNS должен привести посетителей к VPS, пока приложение ещё работает на старом адресе.
Это исключает переход старой ссылки материала на лендинг из-за устаревшего DNS.

1. Установить временный [bridge fragment](../../infra/production/host/primary-domain-stage.caddy)
   в `/srv/inside/runtime/caddy/primary-domain-stage.caddy`. Он возвращает 302 с `Cache-Control:
   no-store` от apex/www на старый адрес с сохранением path/query. Существующий `active.caddy`
   и `WEB_BASE_URL` остаются прежними. Проверить конфигурацию перед reload:

   ```bash
   sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
   sudo systemctl reload caddy
   ```

2. Переключить A apex и www на production VPS из нового снимка; конфликтующие AAAA/CNAME обработать по
   фактическому снимку панели. Отвязать apex/www от лендинга в порядке, который требует Timeweb.
   Приложение лендинга сохранить на техническом адресе на время наблюдения и возврата.
   Если сертификат не получен заранее, это согласованное окно DNS → ACME; старое приложение
   на `inside.sachkov.dev` продолжает работать и никуда не перенаправляет своих посетителей.
3. Дождаться как минимум прежнего TTL (значение из нового снимка) после последнего
   изменения. Через независимые DNS resolvers и обычный интернет проверить apex/www → old app,
   HTTPS, реальную серию/материал и вход. С `--resolve` проверить именно VPS; не использовать `-k`
   как TLS proof. Старый хостинг сохраняет ответы для оставшихся DNS-кэшей. Если несколько
   resolvers всё ещё видят лендинг, не включать финальный redirect со старого домена.
4. Подготовить Logto URI из предыдущего раздела. Заменить только `WEB_BASE_URL` в server-owned
   `/etc/inside/runtime/web.env` на `https://sachkov.dev`, сохранив владельца и mode 0600.
   Env-файл сам по себе не меняет работающий контейнер.
   Явно задать `LEARNER_MCP_URL=https://inside.sachkov.dev/mcp/learning` в `web.env`: иначе
   Web выводит адрес учебного MCP из нового `WEB_BASE_URL` и показывает закрытый endpoint.
   В `api.env` и `mcp.env` заменить браузерные `PUBLIC_SITE_ORIGIN`,
   `TELEGRAM_COMMUNICATIONS_PUBLIC_ORIGIN`, `TELEGRAM_TRACKING_ORIGIN` на `https://sachkov.dev`;
   в `api.env` и `notifications-worker.env` заменить `NOTIFICATIONS_PLATFORM_ORIGIN`.
   В `/etc/inside/telegram/application.env` заменить публичный
   `TELEGRAM_SIGN_IN_RETURN_URL` на `https://sachkov.dev/` для кнопки «Открыть Inside» после входа.
   Если настроена другая публичная страница, сохранить её путь при замене origin.
   Адрес не содержит OAuth code/state или токенов; query и fragment эта настройка не принимает.
   Применение к Telegram и проверка новой кнопки описаны в
   [runbook Telegram](../../apps/telegram/docs/operations/production.md#смена-публичного-адреса-кнопки-после-входа).
   В Telegram также проверить браузерный `PLATFORM_ACCOUNT_URL` и адреса переходов
   `PLATFORM_TRACKING_REDIRECT_URL` / `PLATFORM_TRACKING_TARGET_PREFIXES`: при старом origin
   заменить его на `https://sachkov.dev`, сохранив pathname и правила разрешённых префиксов.
   В `TBANK_CONFIG_JSON` файлов `api.env`, `mcp.env` и `billing-worker.env` обновить только
   `returnUrl` до `https://sachkov.dev/payment/return` (или сохранить иной согласованный path/query).
   `notificationUrl` банка остаётся прежним.
   Сохранить копии всех изменённых env. Адрес notification банка и `MCP_SERVER_URL` не менять;
   sales flags и каталог не менять. Прежний `returnUrl` банка совместим со старым redirect,
   но новые настройки задают основной домен.
5. Убрать **только созданную нами временную копию** `primary-domain-stage.caddy` из импортируемой
   директории без reload. Иначе она конфликтует с доменами финального/maintenance fragment.
   Текущий Caddy сохраняет загруженный bridge до следующего reload.
6. Запустить обычный deploy выбранного immutable release по [production delivery](production-delivery.md).
   Gateway включает maintenance всех трёх доменов, пересоздаёт Web с новым env и устанавливает
   финальные маршруты после readiness/smoke. Не редактировать staged release, manifest или журнал.
   Перед deploy назвать ожидаемый простой. Порядок: preflight → pre-pull → maintenance → schema
   → workers → migrations → start → readiness → smoke → routes → journal. Загрузка образов
   проходит до maintenance. Если preflight или pre-pull отказал **до maintenance**, вернуть bridge-файл и прежний env: живые процессы
   ещё работают на старом адресе. Если отказ произошёл после maintenance, следовать retry/repair
   процедуре деплоя; не возвращать bridge поверх частично применённого релиза.
7. Проверить через обычный интернет apex → приложение, www/inside → apex и отсутствие циклов.
   На этапе переноса используются 302 с `no-store`, поэтому браузеры не сохраняют постоянный
   обратный маршрут. Постоянные SEO redirects можно включить отдельным изменением после наблюдения.

## Проверки DNS и TLS

Команды ниже выполняет координатор. `production_ip` — адрес VPS из текущего снимка.
Сохранить ответы вместе с датой и выпуском. Не использовать `curl -k`.

```bash
production_ip=АДРЕС_ИЗ_СНИМКА
for host in sachkov.dev www.sachkov.dev inside.sachkov.dev; do
  dig @1.1.1.1 "$host" A +noall +answer
  dig @8.8.8.8 "$host" A +noall +answer
  dig @1.1.1.1 "$host" AAAA +noall +answer
  curl --fail --silent --show-error --resolve "$host:443:$production_ip" --dump-header - --output /dev/null "https://$host/"
  curl --fail --silent --show-error --location --max-redirs 5 --output /dev/null "https://$host/map?q=typescript"
done
```

До финального deploy apex/www направлены на inside. После него inside/www направлены на apex.
Обе проверки `curl` используют доверенную цепочку TLS и проверяют имя сертификата.
Сопоставить каждый `Location` с таблицей адресов; итоговый URL должен иметь ожидаемые path/query.

## Приёмка и завершение

- HTTPS apex/www/inside: доверенные сертификаты; apex открывает принятую главную, www и old web
  ведут на соответствующий путь; query сохраняется, цикл redirect отсутствует.
- Гость: главная → карта `/map` → продукт/руководство → открытый материал; поиск и видео.
  `/library` удалён (#614) и должен отвечать 404. Проверить `/series/<slug>` и `/guides/<slug>` → `/products/<slug>`
  для существующего продукта (#448, затем #808), включая разрешённые query/hash. Продажи не включать.
- Реальный вход email и Telegram, callback на apex, выход и повторный вход. Не считать открытие
  формы Logto подтверждением входа. Проверить действующего участника: тот же Account и доступ,
  история чтения и member-only материал. Тест Telegram-сообщений требует разрешённого сценария.
- Проверить Kinescope playback/authorize и входящие integrations на прежних URL, MCP discovery
  и авторизованный read-only запрос. Не запускать массовые уведомления или платежи для smoke.
- DNS с нескольких resolvers, TLS и HTTP/2/HTTP/3 на доступном клиенте; проверка владельцем без VPN.
- После прохождения прежнего DNS TTL и согласованного наблюдения убрать привязку главного домена
  к Timeweb App Platform и его автоматический деплой, если не сделано при переключении. Сохранение
  исходников/технического preview не мешает условию «лендинг больше не обслуживает главный домен».
- Приложить реальные результаты к #857; закрывать инициативу только после этих проверок.

## Возврат при отказе

До финального deploy старое приложение работает без изменений: можно вернуть прежние DNS и
binding лендинга, сохраняя временный bridge на VPS до истечения нового TTL. Это оставляет
доступ к материалам через `inside.sachkov.dev`.

После успешного финального deploy сначала восстановить сохранённые env-файлы и пересоздать Web
и затронутые API/MCP/billing/notifications процессы с прежними env по [процедуре изменения настройки](production-release.md#изменение-настройки-без-нового-выпуска).
В её команде указать `--pull never` и список `web api mcp billing-worker notifications-worker`. Восстановить прежний проверенный
`active.caddy` вместе с bridge. Проверить `caddy validate` перед reload, затем старую страницу,
вход и apex → old app без цикла. После этого при необходимости вернуть DNS/binding лендинга.
302 `no-store` не закрепляет противоположные маршруты в браузере. На время восстановления
runtime-конфигурации использовать maintenance; не выдавать промежуточное состояние за готовое.

Это возврат адресов и runtime-конфигурации, не откат базы. Если сам deploy не завершился успешно,
следовать его журналу и правилам retry/repair forward, не заменять maintenance обходным proxy.
Откат версии приложения допустим только при разрешённой manifest/schema compatibility.

Перед возвратом записать текущую версию из `state.json`; она не меняется при возврате адресов.
Последовательность для координатора:

1. Скопировать maintenance текущего выпуска в `/srv/inside/runtime/caddy/active.caddy`.
   Проверить `caddy validate`, затем выполнить `systemctl reload caddy`.
2. Восстановить все сохранённые env в `/etc/inside/runtime`, включая `billing-worker.env`,
   с владельцем `root:root` и mode `0600`.
3. Пересоздать перечисленные процессы образами текущего выпуска по ссылке выше.
   Убедиться в readiness всех пяти процессов; при отказе сохранить maintenance.
4. Восстановить сохранённый старый `active.caddy` и bridge в импортируемой директории.
   Проверить `caddy validate`, затем выполнить `systemctl reload caddy`.
5. Проверить старый вход, доступ участника и apex/www → inside без цикла.
   При необходимости восстановить DNS/binding из снимка; сохранить bridge до истечения TTL.

Если при переносе менялась конфигурация Telegram, восстановить сохранённый
`/etc/inside/telegram/application.env` и применить его с текущим immutable Telegram release,
проверив readiness и прежние значения кнопок/tracking. Telegram имеет свой Compose и блокировку:
следовать [его порядку применения и отката](../../apps/telegram/docs/operations/production.md#смена-публичного-адреса-кнопки-после-входа)
под координацией #854; он не входит в список пяти процессов Platform.

При возврате удалить `LEARNER_MCP_URL`, если его не было в сохранённом env; прежний
`WEB_BASE_URL` снова задаёт правильный fallback.

Старые Logto redirect/logout URI остаются на всё окно возврата. Добавленные URI удалить только
после завершения возврата и проверки старого входа; issuer/application/audience не менять.

## Локальное доказательство

`pnpm compose:production:smoke` проверяет реальные Caddy/TLS/Next/API/MCP с изолированными
данными: новый домен, совместимость старых endpoints, redirect path/query, безопасный старый
callback, временный bridge без кэширования, закрытые маршруты и maintenance всех доменов. Тест не проверяет Timeweb DNS,
публичный ACME, реальный Logto, Telegram или Kinescope.

Семантика redirect с сохранением URI: [Caddy redir](https://caddyserver.com/docs/caddyfile/directives/redir).
Настройка base URL и callback: [Logto Next.js](https://docs.logto.io/quick-starts/next-app-router).

## Где проверять публичный домен

Поиск старого hostname сам по себе не означает, что адрес устарел. Проверить назначение ссылки
и её владельца, затем сопоставить server-owned env с работающим контейнером. Шаблоны репозитория
не подтверждают фактические значения production. Проверка runtime и применение проходят через
существующего координатора #854; не выводить целые env или настройки терминала с секретами.

| Пользовательский адрес | Где задаётся | После переноса |
| --- | --- | --- |
| Сайт, callback и выход | Web `WEB_BASE_URL` | `https://sachkov.dev` |
| Новые ссылки юридических согласий | API/MCP `PUBLIC_SITE_ORIGIN` | `https://sachkov.dev`; прежние сохранённые согласия не переписывать |
| Ссылки в рассылках и tracking Platform | API/MCP `TELEGRAM_COMMUNICATIONS_PUBLIC_ORIGIN`, `TELEGRAM_TRACKING_ORIGIN` | `https://sachkov.dev` |
| Ссылки уведомлений | API и notifications worker `NOTIFICATIONS_PLATFORM_ORIGIN` | `https://sachkov.dev` |
| Возврат из банка | API/MCP/billing worker `TBANK_CONFIG_JSON.returnUrl` | `https://sachkov.dev/payment/return`; сохранить согласованный path/query |
| Кнопка после входа через бота | Telegram `TELEGRAM_SIGN_IN_RETURN_URL` | `https://sachkov.dev/` или согласованный pathname; query/fragment не допускаются |
| Кнопка аккаунта при активации курса | Telegram `PLATFORM_ACCOUNT_URL` | основной домен с прежним pathname; query/fragment не допускаются |
| Tracking Telegram | Telegram `PLATFORM_TRACKING_REDIRECT_URL`, `PLATFORM_TRACKING_TARGET_PREFIXES` | основной домен с прежними путями и разрешёнными префиксами; query/fragment не допускаются |
| Поддержка при конфликте Account | Backend `MEMBERSHIP_SUPPORT_URL`, если он указывает на сайт | основной домен; отдельный согласованный канал поддержки сохраняется |

Проверенные шаблоны Web/API/MCP/notifications worker уже задают основной домен для этих origins.
Шаблоны `TBANK_CONFIG_JSON` и production smoke задают основной `returnUrl` и прежний
`notificationUrl`. Адрес Telegram проверяется отдельно в его server-owned конфигурации.

Сохраняют старый домен: банковский `notificationUrl`, разрешённые server-to-server API,
Logto connector `platformUrl`, авторский и учебный MCP с discovery и authoring transfer.
`LOGTO_AUDIENCE=https://api.inside.sachkov.dev` — идентификатор ресурса, не адрес сайта.
`BILLING_CONTACT_FROM` — проверенный почтовый отправитель; смена Web hostname не меняет его.
Конфигурация старого redirect, временного DNS bridge, rollback и тесты их совместимости также
содержат старый hostname намеренно. Исторические документы, сохранённые согласия, выпущенные
сообщения и опубликованные юридические редакции не переписываются при смене env.

### Наблюдение юридических страниц 13 октября 2026 года

Read-only HTTP GET главной и `/legal/privacy`, `/legal/cookies`, `/legal/terms` на
`https://sachkov.dev` вернули 200. В атрибутах href/src/content этих HTML не обнаружены
абсолютные ссылки на `inside.sachkov.dev`; текст трёх юридических страниц содержит старый домен.
Это не проверка всех страниц, входа или настроек production. Текущие тексты принадлежат
`packages/legal/src/editions/privacy-v4.ts`, `cookies-v2.ts` и `terms-v1.ts` и соответствующим
редакциям в `docs/legal`. Их адресные формулировки требуют отдельных новых редакций по
[правилам юридического комплекта](../legal/README.md); опубликованный текст под прежним номером
не изменять. Учебный MCP внутри политики сохраняет свой служебный адрес.
