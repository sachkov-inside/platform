# Перенос приложения на sachkov.dev

Владелец запросил замену лендинга приложением в
[Workspace #146](https://github.com/sachkov-inside/workspace/issues/146).
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
| `/mcp` и `/.well-known/oauth-protected-resource/mcp` | Только прежний `inside.sachkov.dev`; на основном домене 404 |
| `/health`, `/health/*`, `/_health/*`, неизвестные `/integrations/*` | 404 на основном и старом доменах |

`auth.sachkov.dev`, Telegram `platformUrl`, Kinescope callbacks, `MCP_SERVER_URL`, Logto issuer,
API audience и идентификатор Logto application сохраняются. Не менять `LOGTO_AUDIENCE` вместе
с доменом сайта: это идентификатор API resource. База, Account, Membership и прогресс не мигрируют.
Cookie браузера на старом hostname не становится сессией на новом: потребуется повторный вход
в ту же учётную запись. Вход, начатый до переключения, безопасно начинается заново.

В старом лендинге внутренние ссылки — `/#inside`, `/#pipeline`, `/#levels`, `/#author`, `/#faq`.
Fragment не отправляется HTTP-серверу: эти URL открывают новую главную; прежние секции лендинга
не воспроизводятся. Внешние ссылки Tribute, Telegram, YouTube и GitHub остаются рабочими.
Отдельных пользовательских страниц в текущем Astro `src/pages` нет, кроме главной.

## Проверенный исходный снимок, 8 сентября 2026

- Production Platform: `inside-production`, VPS `201.24.126.23`, Caddy 2.11.4,
  приложение v6, SHA `82fdc092e8d82dd66ac450a5a6fa1f62a6f34eba`.
- Caddy импортирует `/srv/inside/runtime/caddy/*.caddy`; приложение принадлежит `active.caddy`.
- Web слушает `127.0.0.1:13000`; в server-owned `web.env` пока старый `WEB_BASE_URL`.
- Read-only проверка существующего Logto `Inside Web`: callback `https://inside.sachkov.dev/callback`,
  post logout `https://inside.sachkov.dev/`. Нового домена в списках пока нет.
- Публичный DNS, прочитанный с VPS через `1.1.1.1`: A для apex и www — `178.209.127.53`,
  AAAA apex отсутствует. Это адрес лендинга Timeweb App Platform.
- Timeweb UI: приложение `Inside Landing`, ID `239791`; apex A record `90746329`, TTL 600 секунд.
  Отдельная www-запись среди 14 записей панели не показана, хотя публичный www разрешается в адрес
  лендинга: проверить автоматический alias при изменении binding.
- PR #418 с гостевой главной на момент проверки ещё открыт. Перед переключением заново проверить
  его merge, наличие в выбранном релизе и реальное отображение принятой главной.

## Подготовка до переключения

1. Выполнить review/CI и получить явное разрешение владельца на merge и релиз по `WORKFLOW.md`.
   Выбранный immutable release должен содержать гостевую главную #416 и маршруты #421.
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
   выбранный способ в живой панели. Если заранее выпустить сертификат невозможно, согласовать
   короткое окно недоступности для DNS → ACME; не обещать бесшовное переключение.
5. Сохранить root-only копии `/etc/inside/runtime/web.env`, активного Caddy fragment и настроек
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

2. Переключить A apex и www на VPS `201.24.126.23`; конфликтующие AAAA/CNAME обработать по
   фактическому снимку панели. Отвязать apex/www от лендинга в порядке, который требует Timeweb.
   Приложение лендинга сохранить на техническом адресе на время наблюдения и возврата.
   Если сертификат не получен заранее, это согласованное окно DNS → ACME; старое приложение
   на `inside.sachkov.dev` продолжает работать и никуда не перенаправляет своих посетителей.
3. Дождаться как минимум прежнего TTL (в проверенном снимке — 600 секунд) после последнего
   изменения. Через независимые DNS resolvers и обычный интернет проверить apex/www → old app,
   HTTPS, реальную серию/материал и вход. С `--resolve` проверить именно VPS; не использовать `-k`
   как TLS proof. Старый хостинг сохраняет ответы для оставшихся DNS-кэшей. Если несколько
   resolvers всё ещё видят лендинг, не включать финальный redirect со старого домена.
4. Подготовить Logto URI из предыдущего раздела. Заменить только `WEB_BASE_URL` в server-owned
   `/etc/inside/runtime/web.env` на `https://sachkov.dev`, сохранив владельца и mode 0600.
   Env-файл сам по себе не меняет работающий контейнер.
5. Убрать **только созданную нами временную копию** `primary-domain-stage.caddy` из импортируемой
   директории без reload. Иначе она конфликтует с доменами финального/maintenance fragment.
   Текущий Caddy сохраняет загруженный bridge до следующего reload.
6. Запустить обычный deploy выбранного immutable release по [production delivery](production-delivery.md).
   Gateway включает maintenance всех трёх доменов, пересоздаёт Web с новым env и устанавливает
   финальные маршруты после readiness/smoke. Не редактировать staged release, manifest или журнал.
   Если preflight отказал **до maintenance**, вернуть bridge-файл и прежний env: живые процессы
   ещё работают на старом адресе. Если отказ произошёл после maintenance, следовать retry/repair
   процедуре деплоя; не возвращать bridge поверх частично применённого релиза.
7. Проверить через обычный интернет apex → приложение, www/inside → apex и отсутствие циклов.
   На этапе переноса используются 302 с `no-store`, поэтому браузеры не сохраняют постоянный
   обратный маршрут. Постоянные SEO redirects можно включить отдельным изменением после наблюдения.

## Приёмка и завершение

- HTTPS apex/www/inside: доверенные сертификаты; apex открывает принятую главную, www и old web
  ведут на соответствующий путь; query сохраняется, цикл redirect отсутствует.
- Гость: главная → серия → материал, Library/search, видео/гайд/заметка и CTA подписки.
- Реальный вход email и Telegram, callback на apex, выход и повторный вход. Не считать открытие
  формы Logto подтверждением входа. Проверить действующего участника: тот же Account и доступ,
  история чтения и member-only материал. Тест Telegram-сообщений требует разрешённого сценария.
- Проверить Kinescope playback/authorize и входящие integrations на прежних URL, MCP discovery
  и авторизованный read-only запрос. Не запускать массовые уведомления или платежи для smoke.
- DNS с нескольких resolvers, TLS и HTTP/2/HTTP/3 на доступном клиенте; проверка владельцем без VPN.
- После прохождения прежнего DNS TTL и согласованного наблюдения убрать привязку главного домена
  к Timeweb App Platform и его автоматический деплой, если не сделано при переключении. Сохранение
  исходников/технического preview не мешает условию «лендинг больше не обслуживает главный домен».
- Приложить реальные результаты к Workspace #146 и закрывать его только после этих проверок.

## Возврат при отказе

До финального deploy старое приложение работает без изменений: можно вернуть прежние DNS и
binding лендинга, сохраняя временный bridge на VPS до истечения нового TTL. Это оставляет
доступ к материалам через `inside.sachkov.dev`.

После успешного финального deploy сначала восстановить сохранённый `web.env` и пересоздать Web
с прежним env по штатной процедуре изменения runtime-конфигурации; восстановить прежний проверенный
`active.caddy` вместе с bridge. Проверить `caddy validate` перед reload, затем старую страницу,
вход и apex → old app без цикла. После этого при необходимости вернуть DNS/binding лендинга.
302 `no-store` не закрепляет противоположные маршруты в браузере. На время восстановления
runtime-конфигурации использовать maintenance; не выдавать промежуточное состояние за готовое.

Это возврат адресов и runtime-конфигурации, не откат базы. Если сам deploy не завершился успешно,
следовать его журналу и правилам retry/repair forward, не заменять maintenance обходным proxy.
Откат версии приложения допустим только при разрешённой manifest/schema compatibility.

## Локальное доказательство

`pnpm compose:production:smoke` проверяет реальные Caddy/TLS/Next/API/MCP с изолированными
данными: новый домен, совместимость старых endpoints, redirect path/query, безопасный старый
callback, временный bridge без кэширования, закрытые маршруты и maintenance всех доменов. Тест не проверяет Timeweb DNS,
публичный ACME, реальный Logto, Telegram или Kinescope.

Семантика redirect с сохранением URI: [Caddy redir](https://caddyserver.com/docs/caddyfile/directives/redir).
Настройка base URL и callback: [Logto Next.js](https://docs.logto.io/quick-starts/next-app-router).
