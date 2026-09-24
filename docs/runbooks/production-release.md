# Production-выпуск: брокер, оплата и совместная выкладка

Этот runbook — Platform-сторона подготовки релиза [Workspace #183](https://github.com/sachkov-inside/workspace/issues/183)
([Platform #527](https://github.com/sachkov-inside/platform/issues/527)). Он описывает, что нужно
подготовить на сервере до выкладки, в каком порядке включать процессы вместе с Telegram и как
проверить результат. Сама выкладка, ротация секретов, реальные платежи и живая приёмка — это
[Workspace #184](https://github.com/sachkov-inside/workspace/issues/184). Мониторинг и сигналы
об отказах — [#245](https://github.com/sachkov-inside/platform/issues/245). Порядок деплоя, откат и
readiness описаны в [production delivery](production-delivery.md), восстановление очередей — в
[queue recovery](queue-recovery.md).

## Server-owned configuration

Шаблоны `config/compose/production/*.env.example` копируются в `/etc/inside/runtime` тем же циклом,
что в [production delivery](production-delivery.md#server-owned-configuration). Deploy отказывает,
пока в любом файле остаётся `replace-with-`. Группа, которую ещё не включают, удаляется целиком,
а не остаётся с заглушкой: частичная группа останавливает запуск. При совместной выкладке так
удаляются community (`TELEGRAM_COMMUNITY_*`) и активация (`TELEGRAM_ACTIVATION_INGRESS_SECRET`) до
шагов 9 и 10 порядка ниже.

### Изменение настройки без нового выпуска

Процессы читают env-файлы при запуске. После правки файла пересоздайте только процессы, которые его
читают, с образами текущего выпуска. У `api` один экземпляр: на время пересоздания запросы получают
ошибку, поэтому делайте это в спокойное окно.

```bash
state=/var/lib/inside/deployments/state.json
version="$(sudo jq --raw-output .current.version "$state")"
release="/srv/inside/releases/$version"
backend="$(jq --raw-output .images.backend "$release/release-manifest.json")"
web="$(jq --raw-output .images.web "$release/release-manifest.json")"
sudo env \
  PLATFORM_BACKEND_IMAGE_REPOSITORY="${backend%@sha256:*}" PLATFORM_BACKEND_IMAGE_DIGEST="${backend##*@sha256:}" \
  PLATFORM_WEB_IMAGE_REPOSITORY="${web%@sha256:*}" PLATFORM_WEB_IMAGE_DIGEST="${web##*@sha256:}" \
  PLATFORM_RELEASE_ENV_FILE="/var/lib/inside/deployments/release-environments/$version.env" \
  PLATFORM_CONFIG_DIR=/etc/inside/runtime \
  docker compose --env-file /etc/inside/runtime/compose.env --file "$release/runtime/compose.production.yaml" \
    up --detach --wait --no-deps --force-recreate api billing-worker
```

Воркер останавливается с дренажом и отпускает свою блокировку поколения до старта нового.

Одни и те же значения живут в нескольких файлах. Разные направления Telegram никогда не делят секрет:
запуск отклоняет повторно использованный.

| Значение | Файлы Platform | Пара на стороне Telegram |
|---|---|---|
| `TBANK_CONFIG_JSON` | `api.env`, `mcp.env`, `billing-worker.env` | — |
| `BILLING_CONTACT_*` | `api.env`, `mcp.env`, `billing-worker.env`, `notifications-worker.env` | — |
| `NOTIFICATIONS_PLATFORM_ORIGIN`, `NOTIFICATIONS_TELEGRAM_SECRET` | `api.env`, `notifications-worker.env` | `NOTIFICATION_AUTHORIZE_SECRET` |
| `TELEGRAM_COMMUNITY_CONTRACT_VERSION=inside.community-entitlement.v2`, `TELEGRAM_COMMUNITY_ENTITLEMENT_*`, `TELEGRAM_COMMUNITY_DISPATCH_SECRET` | `api.env`, `billing-worker.env` | `PLATFORM_COMMUNITY_INTEGRATION_SECRET`, `PLATFORM_COMMUNITY_DISPATCH_SECRET` |
| `TELEGRAM_ACTIVATION_INGRESS_SECRET` | `api.env` | `PLATFORM_ACTIVATION_SECRET` |
| `TELEGRAM_LINKING_SECRET` | `api.env` | `PLATFORM_INTEGRATION_SECRET` |
| `TELEGRAM_COMMUNICATIONS_SECRET` — своё значение, не равное `TELEGRAM_LINKING_SECRET` | `api.env`, `mcp.env` | `PLATFORM_COMMUNICATIONS_SECRET` |
| `TELEGRAM_COMMUNICATIONS_ENDPOINT`, `TELEGRAM_COMMUNICATIONS_BOT_IDENTITY`, `TELEGRAM_AUTHOR_AUTHORIZATION_SECRET`, `TELEGRAM_TRACKING_ORIGIN` | `api.env`, `mcp.env` | `PLATFORM_AUTHOR_AUTHORIZATION_SECRET` |
| `TRIBUTE_API_KEY`, `TRIBUTE_SIGNATURE_ENCODING` | `api.env` | — |
| `NOTIFICATIONS_BROKER_URLS` | `notifications-worker.env` | свой `NOTIFICATION_AMQP_URL` |

## Broker

Решение, его последствия и путь роста — [ADR 0025](../adr/0025-own-single-node-rabbitmq-broker.md). Это один узел `rabbitmq` в
`compose.production.yaml`: образ закреплён по digest, наружу не публикуется ничего, слушатель один —
AMQPS на `5671`. Топологию он читает из определений при каждом запуске; пользователи приложений
топологию не объявляют. Правила транспорта, ACL и quarantine описаны в
[notification transport](notification-transport.md).

Окружению нужен собственный vhost, например `inside-production`, и пять разных principals:
`platform-billing`, `platform-materials`, `platform-notifications`, `platform-email` и `telegram`.

1. **Пароли.** Для каждого principal создайте отдельный случайный пароль без символов, требующих
   кодирования в URL:

   ```bash
   openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
   ```

   Четыре Platform URL записываются в `NOTIFICATIONS_BROKER_URLS` файла `notifications-worker.env`.
   URL principal `telegram` (`amqps://telegram:<пароль>@rabbitmq:5671/inside-production`) получает
   только Telegram; в файлы Platform он не попадает.

2. **TLS.** Частный CA окружения и сертификат сервера на имя `rabbitmq`. Клиенты проверяют
   сертификат и имя; клиентских сертификатов нет, вход — паролем principal.

   Сертификаты выпускает `infra/production/broker/issue-broker-tls.sh` из проверенного checkout
   выкладываемого SHA; тот же скрипт использует production-smoke. Скрипт проверяет, что сертификат
   сервера подписан CA и выдан на имя `rabbitmq`.

   ```bash
   work="$(mktemp -d)"
   bash infra/production/broker/issue-broker-tls.sh "$work/tls" 3650 825
   sudo install -d -m 0750 -o root -g 101 /etc/inside/runtime/rabbitmq /etc/inside/runtime/rabbitmq/tls
   sudo install -m 0644 -o root -g 101 "$work/tls/ca.pem" "$work/tls/server.pem" /etc/inside/runtime/rabbitmq/tls/
   sudo install -m 0640 -o root -g 101 "$work/tls/server-key.pem" /etc/inside/runtime/rabbitmq/tls/
   ```

   Ключ CA (`"$work/tls/ca-key.pem"`) нужен только для перевыпуска сертификата сервера. Храните его по процедуре
   [подготовки секретов](../../infra/production/secrets/README.md), не в `/etc/inside/runtime`, и
   удалите `"$work"`.

3. **Определения.** Их печатает команда из того backend-образа, который выкладывается, из тех же URL,
   с которыми подключаются процессы. В файл попадают только хэши паролей с солью.

   ```bash
   export NOTIFICATIONS_TELEGRAM_BROKER_URL='<URL principal telegram>'
   sudo --preserve-env=NOTIFICATIONS_TELEGRAM_BROKER_URL docker run --rm \
     --env-file /etc/inside/runtime/notifications-worker.env \
     --env NOTIFICATIONS_TELEGRAM_BROKER_URL \
     --entrypoint node ghcr.io/sachkov-inside/platform-backend@sha256:<digest из release-manifest.json> \
     dist/release/write-notification-broker-definitions.js \
     | sudo install -m 0640 -o root -g 101 /dev/stdin /etc/inside/runtime/rabbitmq/definitions.json
   unset NOTIFICATIONS_TELEGRAM_BROKER_URL
   ```

   Команда отказывает без URL, если principals совпадают, если vhost разный или если адрес не AMQPS,
   и не печатает URL в ошибке.

4. **Права.** Брокер работает пользователем образа (uid 100, gid 101) и читает файлы по группе.
   Deploy проверяет `root:101`: `0640` для `definitions.json` и `server-key.pem`, `0644` для
   `ca.pem` и `server.pem`. `notifications-worker` получает только `ca.pem`.

5. **Telegram.** Значения для host-owned override Telegram (раздел «Сеть до брокера» его
   `docs/operations/production.md`, [Telegram #45](https://github.com/sachkov-inside/inside-telegram/issues/45)):

   | Что | Значение Platform |
   |---|---|
   | Сеть `broker`, `external: true` | `PLATFORM_BROKER_NETWORK`, по шаблону `inside-platform-broker`; её создаёт deploy Platform |
   | Host в `NOTIFICATION_AMQP_URL` | `rabbitmq` — имя в сертификате сервера |
   | Порт и vhost | `5671`, `inside-production` |
   | CA | копия `/etc/inside/runtime/rabbitmq/tls/ca.pem` в `/etc/inside/telegram/broker-ca.pem` |
   | Principal | `telegram`: `configure ^$`, запись только `inside.results.telegram.v1`, чтение только двух очередей `telegram.notifications.*.v1` |
   | Ёмкость очередей | 1000 сообщений и 16384000 байт (1000 × 16 KiB) на очередь, `reject-publish` |

6. **Смена пароля или сертификата.** Обновите URL и файлы, заново выпустите определения и
   пересоздайте только брокер, затем `notifications-worker`. Импорт определений добавляет и обновляет,
   но не удаляет: ненужного пользователя удаляют `rabbitmqctl delete_user`. Пока брокер
   перезапускается, публикация ждёт в outbox PostgreSQL.

7. **Данные.** Очереди лежат в томе `<project>_broker-data`. Никогда не выполняйте `down --volumes`
   для production-проекта: подтверждённые брокером, но ещё не полученные сообщения пропадут.

Один узел даёт долговечность, но не отказоустойчивость: пока он остановлен, уведомления ждут.

## Payment contour

Настройки терминала приходят одним `TBANK_CONFIG_JSON`; схема — `apps/backend/src/config/tbank-config.ts`,
проверенные факты терминала — [issue-402](../verification/issue-402-tbank-terminal-capability.md).
Одинаковое значение задаётся в `api.env`, `mcp.env` и `billing-worker.env`.

| Поле | Значение для выпуска | Основание |
|---|---|---|
| `environment` | `production` | рабочий терминал |
| `terminalKey`, `password` | рабочего терминала | только из кабинета, по процедуре секретов |
| `bindingEncryptionKey` | 32 случайных байта в base64, свои для окружения | нужен и для будущей подписки |
| `recurringCardConfirmed`, `cardOnlyHostedConfirmed` | `false` | на форме все способы: карта, T-Pay, Mir Pay, SberPay, Долями (решение 15.09.2026) |
| `minimumKopecks` | `100` | нижняя граница приложения, у банка её нет |
| `maximumKopecks` | `30000000` | разовая операция 300 000 ₽; Долями банк сам показывает только в пределах 4–200 000 ₽ |
| `returnUrl` | `https://inside.sachkov.dev/subscription/return` | страница спрашивает состояние у сервера |
| `notificationUrl` | `https://inside.sachkov.dev/billing/tbank/notification` | маршрут ниже |
| `receipt` | `{"taxation":"usn_income","tax":"none"}` | УСН «Доходы», без НДС |

Приложение передаёт `NotificationURL`, `SuccessURL` и `FailURL` в каждом `Init`, поэтому страницы
банка по умолчанию не мешают. HTTP-уведомления в кабинете рабочего терминала включает владелец;
запасной адрес — тот же `notificationUrl`.

Правила продажи:

- разовая покупка не зависит от подтверждений «только карта» и работает с `false`;
- продажа подписки требует обоих подтверждений: без них каталог не включает предложение с вариантом
  подписки и не добавляет такой вариант к продаваемому предложению (`method_unavailable`), а покупка
  подписки отвечает `method_unavailable` до обращения к банку. Публичная продажа подписки в этом
  выпуске выключена;
- каталог не включает в продажу ничего, пока у процесса нет терминала и адреса для чека;
- `api` и `billing-worker` не запускаются, пока каталог продаёт, а настроек нет. `mcp` не продаёт и
  при запуске не проверяется: возврат без терминала сразу отвечает владельцу `method_unavailable`.
  Текст отказа в логе (`"status":"operator_attention"`):
  - `Sale is enabled in the billing catalog, but TBANK_CONFIG_JSON is not configured`;
  - `Sale is enabled in the billing catalog, but BILLING_CONTACT_* is not configured`;
  - `Subscription sale is enabled in the billing catalog, but the terminal does not confirm recurringCardConfirmed and cardOnlyHostedConfirmed`.

Проверка выполняется только при запуске. Продажу включают после проверок выпуска, и снимают её
(«выключить из продажи») раньше, чем убирают настройки оплаты.

## Public API routes

`infra/production/runtime/platform.caddy` проксирует в API и MCP ровно эти адреса, по строке на путь.
Метод «любой» значит, что Caddy метод не ограничивает. На POST-адресе любой другой метод уходит на web
и получает обычную страницу 404. Остальное поведение edge описано в
[production delivery](production-delivery.md#проверки-готовности-и-маршрутизация).
Подлинность проверяет API или MCP, у каждого направления свой credential. Таблицу сверяет с Caddy
`scripts/production-runtime-contract.test.mjs`: расхождение метода или пути роняет проверку.

| Метод | Путь | Кто вызывает | Credential | Без него |
|---|---|---|---|---|
| любой | `/integrations/telegram/v1/membership-evidence` | Telegram | bearer `TELEGRAM_EVIDENCE_INGRESS_SECRET` | `401` |
| POST | `/integrations/telegram/v1/sign-in/linked-identity` | коннектор Logto | bearer `TELEGRAM_SIGN_IN_INTEGRATION_SECRET` | `401` |
| любой | `/integrations/kinescope/v1/webhook` | Kinescope | Basic `KINESCOPE_WEBHOOK_USERNAME` и `KINESCOPE_WEBHOOK_PASSWORD` | `401 invalid_basic_credentials` |
| любой | `/integrations/kinescope/v1/authorize` | Kinescope DRM | Basic `KINESCOPE_CALLBACK_USERNAME` и `KINESCOPE_CALLBACK_PASSWORD` | `401 invalid_basic_credentials` |
| POST | `/billing/tbank/notification` | банк | подпись `Token` паролем терминала | `400 invalid_notification` |
| POST | `/integrations/tribute/v1/webhook` | Tribute | HMAC тела в `trbt-signature` | `401 invalid_signature` (без настроек — `503`) |
| POST | `/integrations/telegram/v1/subscription-activation/binding` | бот Telegram | bearer `TELEGRAM_ACTIVATION_INGRESS_SECRET` | `401 unauthorized` |
| POST | `/integrations/telegram/v1/subscription-activation/own-access` | бот Telegram | bearer `TELEGRAM_ACTIVATION_INGRESS_SECRET` | `401 unauthorized` |
| POST | `/integrations/telegram/v1/subscription-activation/attempts` | бот Telegram | bearer `TELEGRAM_ACTIVATION_INGRESS_SECRET` | `401 unauthorized` |
| POST | `/integrations/telegram/v1/subscription-activation/evidence` | бот Telegram | bearer `TELEGRAM_ACTIVATION_INGRESS_SECRET` | `401 unauthorized` |
| POST | `/internal/billing-dispatch/authorize` | Telegram | bearer `TELEGRAM_COMMUNITY_DISPATCH_SECRET` | `401 unauthorized` |
| POST | `/internal/notifications/dispatch/authorize` | Telegram | bearer `NOTIFICATIONS_TELEGRAM_SECRET` | `401 unauthorized` |
| POST | `/integrations/telegram/v1/communications/authorize` | авторское меню бота | bearer `TELEGRAM_AUTHOR_AUTHORIZATION_SECRET` | `401 unauthorized` |
| POST | `/integrations/telegram/v1/communications/validate-content` | авторское меню бота | bearer `TELEGRAM_AUTHOR_AUTHORIZATION_SECRET` | `401 unauthorized` |
| любой | `/mcp` | MCP-клиенты | bearer Logto с аудиторией MCP | `401` |
| любой | `/.well-known/oauth-protected-resource/mcp` | MCP-клиенты | нет: публичные метаданные | `200` |

Edge не ограничивает адрес отправителя: адрес исходящих запросов Telegram и банка репозиторию не
известен. Ограничение по сети — отдельное решение.

## Joint rollout with Telegram #45

Номера шагов совпадают с разделом «Совместная выкладка с Platform» в `docs/operations/production.md`
Telegram ([Telegram #45](https://github.com/sachkov-inside/inside-telegram/issues/45)). Здесь — что
делает Platform на каждом шаге.

1. **Подготовка.** Точный SHA и digest образов выпуска Platform, секреты каждой пары из
   [таблицы](#server-owned-configuration), пароли principals и файлы брокера по разделу [Broker](#broker).
2. **Community mutations на паузе.** В `/etc/inside/runtime` нет `TELEGRAM_COMMUNITY_*` и
   `TELEGRAM_ACTIVATION_INGRESS_SECRET`; остальные группы, включая оплату, notifications и
   communications, заполнены. Продажа в каталоге выключена: production пуст.
3. **Backup обеих баз.** Полная копия кластера: `sudo systemctl start inside-pgbackrest-backup@full.service`
   ([foundation](production-foundation.md)), сохранённые конфигурации и прежние digest.
4. **Остановка старых поколений.** Делает deploy Platform: он включает maintenance и дренирует воркеры
   прежнего выпуска до миграций.
5. **Platform.** `deploy vN` ([production delivery](production-delivery.md#run-deployment-or-rollback)):
   образы выпуска и `rabbitmq`, миграции, брокер с определениями, где есть principal `telegram`, затем
   `api`, `mcp`, пять воркеров и `web`, readiness и маршруты Caddy. Сеть `broker` создаётся здесь.
   Проверка: [процессы](#checks-after-rollout) и маршруты из [таблицы](#public-api-routes).
   `notifications-worker` с этого шага публикует и в очереди Telegram. До шага 11 их никто не читает:
   заполненная до своей [ёмкости](notification-transport.md#local-operation) очередь отклоняет
   публикацию, и команды ждут в outbox PostgreSQL без потерь.
6. **Telegram.** Миграции и запуск приложения Telegram с сетью брокера. Platform ничего не меняет.
7. **Webhook.** Сторона Telegram.
8. **Привязка и Evidence.** Владелец привязывает Telegram из сессии Platform; маршрут
   `membership-evidence` уже опубликован.
9. **Сообщество.** После того как Telegram включил `TELEGRAM_COMMUNITY_MODE=live`: добавьте в `api.env` и
   `billing-worker.env` три `TELEGRAM_COMMUNITY_*` и `TELEGRAM_COMMUNITY_CONTRACT_VERSION=inside.community-entitlement.v2`,
   затем [пересоздайте](#изменение-настройки-без-нового-выпуска) `api` и `billing-worker`. Проверка:
   `POST /internal/billing-dispatch/authorize` без bearer отвечает `401`, в логе `billing-worker` нет
   `operator_attention`. Проверочная покупка владельца на этом шаге Telegram — реальный платёж на
   рабочем терминале (Workspace #184): перед ней владелец включает продажу разового продукта в
   `/authoring/billing`, после — при необходимости выключает её до шага 12.
10. **Активация.** Добавьте `TELEGRAM_ACTIVATION_INGRESS_SECRET` в `api.env` и пересоздайте `api`; затем
    Telegram включает `TELEGRAM_ACTIVATION_ENABLED=true`.
11. **Уведомления.** `notifications-worker` уже подключён к брокеру с шага 5. После включения
    Telegram у очередей `telegram.notifications.subscription.v1` и `telegram.notifications.material.v1`
    появляются consumers (команда в [проверках](#checks-after-rollout)).
12. **Авторское меню и воронки.** Маршруты `communications/authorize` и `validate-content` опубликованы
    с шага 5; проверка — в разделе «Воронки идут».

Постоянную продажу разового продукта владелец включает после шага 12; приёмка реальными платежами —
Workspace #184.

## Checks after rollout

Команды читают состояние и ничего не меняют. Имена контейнеров следуют `PLATFORM_COMPOSE_PROJECT`
(`inside-platform-production`).

**Процессы.** `migrations` завершился, девять процессов и `rabbitmq` — `running` и `healthy`, у
воркеров в логе `"status":"ready"`:

```bash
docker ps --filter label=com.docker.compose.project=inside-platform-production \
  --format '{{.Names}} {{.Status}}'
```

**Оплата жива.**

- Неподписанный POST доходит до API и отклоняется, а не попадает на web: тело и код одного ответа —
  problem details с `"code":"invalid_notification"` и `400`. Страница web на этом адресе значила бы, что
  маршрута в Caddy нет.

  ```bash
  curl --silent --request POST --write-out '\n%{http_code}\n' \
    https://inside.sachkov.dev/billing/tbank/notification
  # тело с "code":"invalid_notification", затем 400
  ```

- `api` и `billing-worker` запустились без отказа конфигурации продажи; в логе `billing-worker` нет
  `operator_attention`.
- В `/authoring/billing` разовое предложение включается в продажу, а предложение с вариантом подписки
  отклоняется — это ожидаемо при всех способах формы.
- Покупка, уведомление банка, возврат и чеки на каждом способе формы проверяются DEMO на тестовом
  терминале и живой приёмкой в #184, не этим списком.

**Письма уходят.**

- Код подтверждения адреса для чека приходит на собственный адрес владельца: это SMTP из
  `BILLING_CONTACT_*`.
- В логе `notifications-worker` нет `delivery_not_configured`, `email_dispatch_failed` и
  `operator_attention`.
- У очередей Platform и Telegram есть получатели, сообщения не копятся:

  ```bash
  docker exec inside-platform-production-rabbitmq-1 \
    rabbitmqctl list_queues --vhost inside-production name messages consumers
  ```

**Воронки идут.**

- `/authoring/communications/broadcasts` показывает статистику и `trackingBacklog` без `unavailable`.
- Разрешение автора без bearer отвечает `401` с `"code":"unauthorized"`. Переход проверяется токеном
  правильного формата, но несуществующим — 43 символа `A`, как в шаге 12 совместной выкладки в
  `docs/operations/production.md` Telegram. Web передаёт такой токен в backend, backend спрашивает
  provider, и `404` с телом «Ссылка не найдена.» означает, что provider ответил. Токен неверного формата
  web отсекает сам: тоже `404`, но с телом «Ссылка недействительна.», поэтому он работу provider не
  доказывает. `503` с телом «Переход временно недоступен. Попробуйте ещё раз.» — provider недоступен
  или не задан `TELEGRAM_TRACKING_ORIGIN`. Обе команды печатают тело и код одного ответа:

  ```bash
  curl --silent --request POST --write-out '\n%{http_code}\n' \
    https://inside.sachkov.dev/integrations/telegram/v1/communications/authorize
  # тело с "code":"unauthorized", затем 401
  curl --silent --write-out '\n%{http_code}\n' \
    "https://inside.sachkov.dev/communications/visit?token=$(printf 'A%.0s' $(seq 43))"
  # Ссылка не найдена., затем 404
  ```

- Запуск воронки и доставка людям проверяются на стороне Telegram в #184.

## VPS resources

Оценка сделана по данным репозитория, к серверу не обращались. Production-сервер: 2 CPU и 3910 MiB
RAM; при замере [#355](../verification/production-release-355.md) до сборки кандидата было доступно
2061 MiB.

Память процессов снята `pnpm compose:production:smoke` 15.09.2026 сразу после readiness: пустая база,
без нагрузки, Docker Desktop на macOS. На сервере цифры будут того же порядка, но не равны.

| Процесс | Память | Предел |
|---|---:|---|
| `api` | 256 MiB | 512 MiB |
| `mcp` | 260 MiB | 512 MiB |
| `web` | 78 MiB | 512 MiB |
| `material-assets-worker` | 236 MiB | 768 MiB |
| `profile-avatars-worker` | 161 MiB | 512 MiB |
| `video-deletions-worker` | 234 MiB | 512 MiB |
| `billing-worker` (новый) | 223 MiB | 512 MiB |
| `notifications-worker` (новый) | 247 MiB | 512 MiB |
| `rabbitmq` (новый) | 150 MiB | `mem_limit` и порог памяти брокера — в `compose.production.yaml` |
| **Всё приложение и брокер** | **≈1850 MiB** | |

Пределы приложения (#688) — предохранитель: процесс с утечкой памяти или лавиной потоков упирается
в свой `mem_limit` и `pids_limit` (256) и перезапускается, не забирая память PostgreSQL и Logto.
Блок брокера #688 не меняет: `deploy-release` пересоздал бы брокер при выкладке, а он переживает
выпуски. Это не бюджет: сумма пределов больше памяти сервера, одновременный рост всех процессов они не
остановят. Если процесс упирается в предел при обычной работе, `docker inspect` показывает
`OOMKilled: true` — предел поднимают по замеру, а не снимают.

Новые процессы добавляют около 620 MiB в покое и до ≈1,2 GiB, если брокер дорастёт до своего
`mem_limit` (768 MiB). Два варианта, потому что замер #355 не говорит, работала ли тогда Platform:

- доступные 2061 MiB уже учитывали работающую Platform — после выпуска останется около 1,4 GiB, а при
  брокере на пределе около 0,8 GiB;
- Platform тогда не работала — в покое останется около 200 MiB, а при брокере на пределе не хватит
  около 400 MiB. Это нехватка.

Какой вариант верен, покажет только замер на сервере.

CPU в покое этим smoke не измерен: снимок сделан в момент readiness, когда воркеры одновременно
брали по 20–28% CPU. Постоянный расход известен по #355 — проверки здоровья: проверка воркера стоит
0,82 с CPU, проверка API — 0,30 с, интервал у всех 5 с. Пять воркеров дают ≈0,8 CPU, `api`, `mcp` и
`web` ещё ≈0,2 CPU: около одного CPU из двух уходит только на проверки.

Рекомендации в порядке применения:

1. Сразу после выкладки в #184 снять `free -m` и `docker stats --no-stream` на сервере.
2. Если доступно меньше 500 MiB, ограничить память Node у воркеров (`NODE_OPTIONS=--max-old-space-size`)
   или добавить swap 2 GiB. Если нехватка устойчивая — увеличить VPS до 8 GiB RAM.
3. Снизить стоимость проверок здоровья воркеров: реже проверять или проверять дешевле. Это отдельное
   решение: интервал входит в readiness при deploy.

## Limits

- Брокер — один узел без отказоустойчивости; сигналов об отказах нет до #245.
- Память и CPU оценены по локальному smoke; реальный запас сервера не измерен.
- Служебные маршруты выпускаются с проверкой по секретам без ограничения адреса отправителя; `remote_ip` добавится позже.
- Проверки этого runbook и production-smoke локальные; production-сервер они не трогают.
