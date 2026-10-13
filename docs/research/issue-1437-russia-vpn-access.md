# Доступ к Platform из России и через VPN: частичное исследование

Задача: [#1437](https://github.com/sachkov-inside/platform/issues/1437).
Проверка начата 13 октября 2026 года; HTTP-контроль — 19:50:29–19:50:41 МСК
(16:50:29–16:50:41 UTC). Браузерные серии имеют отдельные UTC timestamps в evidence.
Исходники: `98411441760713ae014fa49e998421d502ce4b20`, а не доказанный SHA production.

## Результат и границы

Доступность из России **не принята**. Реальных российских сетей, устройств и
Россия-origin VPN в этом окружении нет. Контроль через управляемый HTTP proxy
доставляет HTML, ресурсы, OIDC discovery и метаданные учебного MCP. Это не проверка
DNS/TCP/QUIC между российским устройством и сервером.

По адресу `/products/inside-ai-engineering` сервер выдаёт HTTP 200 с title
«Продукт не найден». Домашний каталог `/api/home/materials` отвечает HTTP 200
и `{"kind":"empty"}`. Следовательно, HTTP 200 недостаточно для приёмки курса,
программы, checkout или свободного материала. Не установлено, опубликован ли
этот slug на проверяемом deployment. Нельзя приписывать отсутствие продукта
сетевому ограничению или считать его доказанным дефектом публикации.

Отказов доставки в HTTP-серии не обнаружено. Нельзя из этого заключить, что нет
отказов входа, видео, защищённых файлов или сохранения прогресса. Приёмка задачи
остаётся незавершённой; production, данные учащихся и настройки сети не менялись.

## Источники, версии и сеть контроля

- Топология: [production-delivery](../runbooks/production-delivery.md),
  [публичный Caddy fragment](../../infra/production/runtime/platform.caddy).
- В исходниках [host Caddyfile](../../infra/production/host/Caddyfile) задаёт
  `h1 h2 h3`; [установка Caddy](../../infra/production/host/install-caddy.sh)
  закрепляет официальную 2.11.4 и SHA-256 пакета. Эти файлы не доказывают
  текущую effective configuration или бинарный файл сервера.
- [Logto versions](../../infra/identity/logto/versions.json): upstream 1.44.0,
  fork `inside.7`. Текущий runtime image digest, Platform release/sourceSha,
  effective Caddy config и версия Logto на сервере **NOT TESTED**: SSH/серверные
  credentials не предоставлены. Последний GitHub Release не заменяет journal
  фактического deployment.
- Окружение: Linux, curl 8.14.1, Chromium (точная версия в браузерном evidence),
  чистые контексты desktop 1440×900 и viewport 390×844. Последний — эмуляция
  размера, не мобильный Chromium и не Safari/iPhone.
- `/etc/codex/network-policy.json`: HTTP unrestricted, HTTP proxy, VPN false,
  TCP grants пусты. Runtime сообщает connected, но state HTTP policy unknown.
  Фактические разрешённые запросы подтверждены отдельными ответами.
- Один запрос `https://ipinfo.io/json` сообщил FI, Uusimaa, AS13335 Cloudflare.
  IP не сохранялся. Это характеристика выхода на диагностический адрес, а не
  доказательство того же выхода на Platform. Нет информации о VPN full/split
  tunnel, DNS resolver, клиентском IPv4/IPv6 и независимом прямом маршруте.
- TLS verification включена; curl `ssl_verify_result=0`. Proxy peer IP не
  выдаётся за origin IP и удалён из сохранённого evidence. Нельзя по этой серии
  установить авторитетные A/AAAA, адресный выбор или end-to-end TLS без proxy.

## Карта зависимостей на исследованном SHA

| Запрос / адрес | Кто обращается и владеет границей | Источник и предел доказательства |
| --- | --- | --- |
| `sachkov.dev`, `/_next/static/*`, локальные Manrope `.woff2`, `/auth/status`, `/api/*` | Браузер → Caddy → Next web; BFF → private API | Caddy fragment; evidence подтверждает ресурсы этих origin. Полная цепочка курса не наблюдалась |
| `www.sachkov.dev` и старые browser pages на `inside.sachkov.dev` | Caddy → временный redirect на основной сайт | Fragment сохраняет query/path для обычных страниц; old `/callback` отдельно возвращает на основной сайт без code/state |
| `auth.sachkov.dev`, `/oidc`, `/assets/*` | Браузерный OIDC вход и серверные token/JWKS вызовы; Logto | [web env](../../config/compose/production/web.env.example), [BFF config](../../apps/web/src/shared/auth/logto-bff-config.server.ts). Discovery PASS; завершённый OAuth NOT TESTED |
| `https://api.inside.sachkov.dev` | Значение OAuth audience/resource, не автоматически browser API destination | web/api env; browser API обычно same-origin. Не предлагать удалять/переносить audience по имени домена |
| `/api/materials/:materialId/assets/:assetId` и `/images/:width` | Браузер → web → API; авторизация ContentAccess | [BFF](../../apps/web/src/features/material-assets/api/material-assets-bff.server.ts), [delivery](../../apps/backend/src/modules/materials/features/deliver-material-asset/deliver-material-asset.ts) |
| `storage.yandexcloud.net`, фактический bucket/подписанный hostname неизвестен | API читает публичные bytes; для защищённого asset возвращает signed redirect, который затем открывает браузер | [api env](../../config/compose/production/api.env.example), delivery. Оба bucket остаются private; actual signed destination нужно снять с разрешённого asset, без query/signature в отчёте |
| Kinescope embed и динамические player/CDN/media origins | Браузерный loader/iframe/media; Kinescope | [player](../../apps/web/src/features/material-video/ui/material-primary-video.client.tsx), [provider](../../apps/backend/src/modules/videos/adapters/kinescope/kinescope-video-provider.ts). Embed ограничен HTTPS `kinescope.io`/subdomains; реальные media origins NOT TESTED |
| `api.kinescope.io`, `uploader.kinescope.io` | Серверные операции provider; uploader также может участвовать в авторской загрузке | api env/provider. Не считать их обязательными browser destinations чтения; авторская загрузка вне этой матрицы |
| `telegram.sachkov.dev`, `t.me` и Telegram app | Серверные identity/link/provider вызовы и browser/app deep link | production-delivery/api env. Root 404 не означает отказ провайдера; реальный login/link проверяется с начатым контекстом |
| `inside.sachkov.dev/mcp/learning`, `/.well-known/oauth-protected-resource/mcp/learning` | Клиент учебного MCP и его OAuth; отдельный resource | Caddy fragment/web env. Metadata PASS, unauthenticated 401 PASS; authenticated client connection NOT TESTED |
| `/api/account/billing/quote`, `/purchase`, `/payment/return`, bank-hosted destination | Checkout BFF → API → Т-Банк; затем браузерный hosted payment | [checkout transport](../../apps/web/src/features/billing-checkout/api/billing-checkout.browser.ts), api env. Actual hosted destination не получен: не создавали order |
| bank/Telegram/Kinescope/Tribute callbacks на `inside.sachkov.dev` и `sachkov.dev` | Provider → ограниченные публичные ingress; отдельные секреты/подписи | Caddy fragment. Сохранять service domains, методы и authentication; browser migration не разрешает перенос callbacks |

Наблюдавшиеся browser origins: `sachkov.dev`, `auth.sachkov.dev`, `inside.sachkov.dev`.
Это карта наблюдённого контроля плюс source-bound условные зависимости,
а не полный HAR курса. Web-to-API private endpoint `http://api:3001`, PostgreSQL
и RabbitMQ не являются прямыми browser dependencies.

## Измерения и матрица

[HTTP evidence](../evidence/issue-1437/http-control.json) содержит две попытки
на адрес, UTC, статус, actual HTTP version, время и bytes. Без `--location`:
redirect считается отдельным фактом, а не успехом конечной страницы.
[Browser shell evidence](../evidence/issue-1437/browser-shells.json) сохраняет
пути без query, CDP protocol/status и client version. Это наблюдение оболочек
при DOMContentLoaded; оно не доказывает завершённую загрузку содержимого.

| Контрольный адрес | Ответы | Total time, с | Оценка |
| --- | --- | --- | --- |
| Главная | 200/200, H2 | 1.131 / 1.716 | PASS доставки; каталог пуст |
| `/products/inside-ai-engineering` | 200/200, H2 | 0.643 / 0.642 | PASS доставки, FAIL приёмки адреса курса: «Продукт не найден» |
| `/programme` того же slug | 200/200, H2 | 0.793 / 0.722 | PASS доставки; программа курса NOT TESTED |
| `/buy` того же slug | 200/200, H2 | 0.761 / 0.451 | PASS доставки; цены/готовый checkout NOT TESTED |
| Logto discovery | 200/200, H2 | 0.864 / 0.465 | PASS discovery; не полный вход |
| Учебный MCP metadata | 200/200, H2 | 0.752 / 0.435 | PASS public metadata |
| Учебный MCP без bearer | 401/401, H2 | 0.436 / 0.439 | PASS ожидаемого отказа; не доступ к защищённому материалу |
| `www.sachkov.dev` | 302/302, H2 | 0.850 / 0.430 | PASS ответа redirect; конечный URL нужно проверять отдельно |
| `telegram.sachkov.dev/` | 404/404, H2 | 0.753 / 0.467 | Ответ есть; root не является сценарием sign-in |

`curl --http3-only` через текущий proxy завершился exit 3: «HTTP/3 is not
supported over an HTTP proxy», HTTP 000. Это **NOT TESTED** QUIC сервера.
Не обходили proxy, не отключали TLS verification и не меняли VPN/firewall.

Обозначения flow: public — курс/программа/свободный текст/файлы;
identity — вход/OAuth callback/account/Telegram; protected — разрешённый материал/
asset/video; continuity — обновление сессии/чтение/существующий прогресс;
billing — checkout/существующий quote/return без bank order; MCP — учебный клиент.

| Сеть и устройство | public | identity | protected | continuity / переключение сети | billing | MCP |
| --- | --- | --- | --- | --- | --- | --- |
| Россия, fixed broadband, native mobile Safari | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Россия, fixed broadband, mobile Chromium | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Россия, fixed broadband, desktop Chromium | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Россия, mobile internet, native Safari | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Россия, mobile internet, mobile Chromium | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Россия, mobile internet/tethering, desktop Chromium | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Россия-origin VPN, регион A, каждый из трёх браузеров | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Россия-origin VPN, регион B, каждый из трёх браузеров | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Россия-origin VPN, регион C, каждый из трёх браузеров | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Прямой outside-Russia browser control с доказанным exit | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Cloud HTTP proxy, desktop Chromium / 390px viewport | Доставка PASS; курс недоступен по выбранному slug; free content NOT TESTED | Discovery PASS; completion NOT TESTED | NOT TESTED | NOT TESTED | Оболочка доставлена; остальное NOT TESTED | Metadata/401 PASS; client NOT TESTED |

ASN/оператор, фактическая страна выхода, устройство/ОС/браузер, VPN full/split mode,
DNS и IPv4/IPv6 для российских строк пока неизвестны. Заполнить каждую VPN-строку
по фактически доступному региону и браузеру; не заменять их foreign cloud runner,
HTTP probe или размером viewport. Таймауты теста ограничивают наблюдение,
а не измеряют максимальную задержку пользователя.

### Завершённые публичные состояния и воспроизведение

[Browser outcomes](../evidence/issue-1437/browser-outcomes.json) содержит две
desktop серии, дождавшиеся состояния содержимого: на course/programme/buy
«Подборка не найдена», на главной «Материалы скоро появятся». Начало входа
через настоящий form/button «Войти» в обеих сериях дошло до Logto `/sign-in`,
input и выбора электронной почты/Telegram за 2343 / 1983 мс. Это PASS начала
входа, **NOT TESTED** отправки кода, Telegram и OAuth completion.

На `/payment/return` без созданной покупки наблюдалось «Не нашли начатую
оплату в этом браузере». Predicate первоначально считал постоянный heading
«Возвращаемся из банка» признаком загрузки и истёк за 10 с. Это ошибка harness;
10 с не являются latency продукта. Ответ и ожидаемое отсутствие payment
context наблюдены, возврат существующей покупки остаётся NOT TESTED.

[Protocol control](../evidence/issue-1437/protocol-control.json): по одной
попытке H1.1/H2 на каждом из двух доменов, actual versions 1.1/2, TLS verify 0,
основной сайт 200, auth root 302 на unknown-session. Это только proxy path.
Повторяемая HTTP-команда (один адрес и один protocol за попытку):

```bash
curl --silent --show-error --connect-timeout 5 --max-time 12 --http2 \
  -o /dev/null \
  -w 'status=%{http_code} protocol=%{http_version} time=%{time_total} bytes=%{size_download} tls=%{ssl_verify_result}\n' \
  https://auth.sachkov.dev/oidc/.well-known/openid-configuration
```

Повторить дважды с сохранением UTC, не обходя установленный proxy. Для
браузера: чистый Chromium context → главная → дождаться `/api/home/materials`
и visible result → существующий course/programme/buy URL → состояние вместо
loading skeleton → form/button «Войти» → Logto input, затем остановиться.
Собирать только host/path/status/protocol без query/body/cookies. На мобильном
браузере использовать его реальную навигацию, а не desktop locator. Повторить
два раза; при отсутствующем material не подставлять выдуманный asset ID.

## Исторический HTTP/3 и диагностика

[#387](https://github.com/sachkov-inside/platform/issues/387) обошла зависание
старой сборки отключением H3. [Исследование #397](issue-397-http3-reload.md)
воспроизвело потерю первого H3 после reload на Ubuntu 2.6.2-14 через loopback;
официальные сборки прошли тот же опыт. [#399](issue-399-caddy-upgrade.md)
обновила production до официальной 2.11.4, вернула h1/h2/h3 и записала 36/36
прямых H3/H2 запросов и 8/8 H2/fallback через тогдашний системный маршрут.
Тогдашний принудительный H3 через VPN давал timeout; автоматический fallback
проходил. Это evidence сентября, не подтверждение октябрьского устройства.

Новая серия подтверждает H2 только через proxy. В ответах на оба домена proxy передал `Alt-Svc: h3=":443"; ma=2592000`;
это наблюдение advertisement, не доказательство доступного QUIC listener.
Нативный fallback после blocked UDP и поведение после reload **NOT TESTED**.
Оснований вновь отключать H3, менять Caddy/provider или DNS сейчас нет.

У отсутствующего продукта граница — ответ приложения/публикация/выбор slug;
DNS/TCP/TLS/HTTP транспорт этого запроса уже доставил ответ. Чтобы отличить
неверный slug от неподготовленного deployment, нужны source/release binding
и действующий опубликованный адрес. Соответствующих server logs нет.
Browser locator timeout из первой серии использовал link вместо form/button
«Войти» и не является продуктовым/network failure. Root Logto без OIDC
контекста показывает unknown-session; это тоже не диагностика полного входа.

## Приоритетный план

| Приоритет и условие | Следующий шаг | Цена / доступ / влияние / возврат |
| --- | --- | --- |
| P0, прежде чем принимать чтение курса | Зафиксировать actual deployment journal, Caddy version/effective config и Logto digest read-only; получить уже опубликованные course/free/protected/video URLs и существующий разрешённый аккаунт | Время оператора; нужны существующие SSH/session права; без изменения product; rollback не нужен |
| P0, пока основная матрица отсутствует | Выполнить реальные RU broadband/mobile и Россия-origin VPN A/B/C проверки ниже; приложить sanitized browser/server evidence в эту задачу | Существующие устройства/подключения; ничего не покупать; данные/сеть меняет только владелец по отдельному разрешению |
| P0, если воспроизведён отказ DNS/TCP/TLS/MTU/security boundary | Изолировать IPv4/IPv6, protocol, exit и affected destination по одному фактору; сопоставить request UTC/digest с server evidence | Работа диагностики; provider/routing cost пока неизвестна; изменение infrastructure решается отдельно с baseline и rollback |
| P0, если H3 недоступен и штатный H2 fallback тоже зависает | Повторить native browser и bounded H2/H3 clients на том же маршруте; только затем оценить scoped compatibility trial | Существующая сеть + доступ к протокольному клиенту; временное изменение только отдельной стадией; возврат exact previous Caddy config |
| P1, если проблема только в protected signed storage или video CDN | Снять реальный redirect/embed/media origin без signatures; сравнить public text/asset и affected bytes; рассчитать delivery варианты после подтверждения | Возможны storage/CDN/traffic расходы, сейчас не оценены; сохранять ContentAccess/DRM; rollback к прежнему delivery при ошибке |
| P1, если смена exit ломает identity/прогресс | Отделить browser cookie/session refresh от failed network request; проверить существующий retry/recovery без повторного purchase | Время браузерной диагностики; возможна UX-правка отдельно; не отключать auth/rate protection, не перезаписывать прогресс |
| P2, после появления эталонной матрицы | Повторять короткий public/identity/storage/video/MCP контроль на тех же сетях при изменении release/protocol/provider | Ручные проверки существующими средствами; monitoring stack/расписание не устанавливаются этим отчётом |

Это план проверки и условных исправлений, не утверждение выявленной блокировки.
Финансовая приёмка остаётся в #1358, public sales GO — #1359, оценка доказанных
критических отказов интеграции — #1433. Новых задач на каждое наблюдение не создано.

## Точные недостающие проверки владельца

1. Для каждого network/browser sample записать UTC и МСК, анонимную категорию сети
   или operator/ASN, реальный exit country, ОС/browser version, VPN region/mode,
   DNS resolver availability, IPv4/IPv6. Начать с двух разных российских сетей.
   Проверять настройки read-only; не менять VPN или устройство ради отчёта без
   отдельного согласования. При отсутствии режима/IPv6 отметить NOT TESTED.
2. Открыть действующий course URL, дождаться названия и программы, открыть
   представительский free material; получить CSS/font/JS и image/file bytes.
   Повторить дважды в ограниченном бюджете 15 с на ключевой запрос и 30 с на
   visible result. Превышение — FAIL наблюдения, не готовая причина.
3. В существующей разрешённой сессии прочитать protected text и asset, проверить
   действительный signed storage hostname и видео: player script, iframe,
   manifest, media segment и продолжение. Не сохранять JWT/signature query.
   Просмотр видео может писать progress автоматически: использовать отдельный
   разрешённый тестовый аккаунт либо оставить видео/persistence NOT TESTED.
4. Начать вход кнопкой «Войти», пройти разрешённый OAuth return, открыть account.
   Email/Telegram sends и account linking не выполнять без отдельного разрешения;
   проверить уже связанную identity либо оставить linking NOT TESTED. Не
   выводить code/state, Cookie/Set-Cookie, Authorization, tokens и account IDs.
5. Из открытой сессии владелец по разрешению переключает VPN off/on и exits
   A→B→C. На каждом этапе проверить чтение, API/asset, redirects и renewal.
   Прогресс только читать до/после; не ставить отметки и не менять learner data.
   Для записи использовать отдельную согласованную disposable fixture, иначе
   сохранение progress остаётся NOT TESTED.
6. Проверить rendering действующего checkout, существующий quote/status и
   return navigation без подтверждения покупки. `POST /api/account/billing/quote`
   сохраняет запись: [quotePurchase](../../apps/backend/src/modules/billing/features/quote-purchase/quote-purchase.ts).
   Не запускать его как read-only probe. `/purchase` и hosted bank order не
   создавать. Реальные purchases/refunds согласовываются в #1358.
7. Подключить существующий разрешённый learner MCP клиент; проверить OAuth
   resource и разрешённое чтение без authoring или submissions. Metadata/401
   сами по себе не доказывают полный клиентский сценарий.
8. При FAIL сохранять только sanitized host/path/method/status/actual protocol,
   timings, bytes и UTC; сопоставить доступные серверные logs/digest без secrets.
   Не публиковать raw HAR: query/body/cookies могут содержать credentials/PII.
   Причину обозначить гипотезой, пока нет контролируемого сравнения границы.

## Проверка артефакта

Документационный deliverable; поведение, публичные контракты и executable
процедуры проекта не изменены. `pnpm docs:check` и independent Standards/Spec
review записываются в PR на immutable commit. Green документационный check
не закрывает missing network/browser samples. Issue должна остаться открытой.
