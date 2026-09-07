# Production #355: инфраструктура и подготовка выпуска

Дата: 7 сентября 2026. Исходная диагностика — с 08:26 UTC, восстановление Logto —
после backup 08:47 UTC, изолированный restore — 08:57 UTC. Это промежуточный
отчёт; готовность нового выпуска к пользователям ещё не подтверждена.

Владелец разрешил самостоятельно использовать существующие доступы и управлять
работой в рамках #355. Агент получил и сверил SSH host key через авторизованную
консоль Timeweb без сброса credentials. После свежего backup исправлен доступ
рабочих ролей Logto к его базе. Новые версии приложений пока не выкладывались.

Задача: [Platform #355](https://github.com/sachkov-inside/platform/issues/355).
Общий выпуск: [Workspace #137](https://github.com/sachkov-inside/workspace/issues/137).
Подготовка исходников: [Platform #362](https://github.com/sachkov-inside/platform/issues/362).
Telegram: [#45](https://github.com/sachkov-inside/inside-telegram/issues/45).

## Проверенный исходный код и зависимости

Проверен свежий `origin/main` Platform:
`dd64ff7908fa9cf63de88889133993fe3c149c99`. Это основа подготовки, а не окончательный
release candidate: задачи прогресса ещё не завершены.

- GitHub показывает один опубликованный выпуск [v1](https://github.com/sachkov-inside/platform/releases/tag/v1),
  source `188f92ae3bc674ca43a2f4aabbcc454ac22addbf`.
- Нативные блокеры #355: открытые #323 и #184. Для совместной приёмки также нужен
  Telegram #45.
- PR #340 и #342 в ходе работы merged. Полный результат прогресса сходится в #329,
  PR #359; при последней проверке он draft, Integration/CI Gate — failure.
  Чужие ветки прогресса не изменялись.
- Между v1 и проверенным main добавлены миграции `0028-series-step-groups`,
  `0029-telegram-sign-in`, `0030-communications-permission`,
  `0031-communication-tracking-hits`. Это сравнение исходников, не чтение live schema.
  Будущий candidate потребует повторной проверки после интеграции прогресса.

История первоначальной выкладки находится в
[приёмке #244](https://github.com/sachkov-inside/platform/issues/244#issuecomment-5550726365)
и не подменяет описанную ниже свежую проверку.

## Публичный HTTP

Исходное наблюдение до исправления, без cookies и авторизации:

| Запрос | Обычное разрешение имени | HTTPS через IP из runbook |
|---|---|---|
| `GET https://auth.sachkov.dev/sign-in` | 500 | 500 |
| `GET https://auth.sachkov.dev/oidc/jwks` | 500 | 500 |
| `GET https://auth.sachkov.dev/oidc/.well-known/openid-configuration` | 500 | 500 |
| `GET https://inside.sachkov.dev/` | 200 | 200 |

Проверка через IP использовала `--noproxy '*' --resolve
auth.sachkov.dev:443:201.24.126.23` с сохранёнными hostname/SNI и проверкой TLS;
`ssl_verify_result=0`. Auth отвечал приблизительно за 0,4–0,5 секунды. Обычный
локальный DNS возвращал адреса `240.0.0.x`; результат HTTP 500 воспроизводится и
без этого разрешения имени. Это не проверка из независимой внешней сети.

Повторные JWKS/discovery ответы имеют `Server: Caddy`, тип
`text/plain; charset=utf-8`, 21 байт и одинаковый SHA-256 тела
`e41656eb2ba6c6293bf6dd928e5a88cdbc50535cab661c1969e0f598e497ed62`.
Заголовок Caddy не доказывает, какой компонент породил ошибку.

Дополнительно: публичный `GET /health/ready` Platform — 404;
корень `https://telegram.sachkov.dev/` — 404. Это проверка закрытия конкретных
маршрутов, не внутренняя readiness приложений и не полная проверка firewall.

Минимальное воспроизведение, ожидаемый здоровый статус — 200:

```bash
curl --fail --silent --show-error --max-time 15 --output /dev/null \
  --write-out '%{http_code}\n' \
  --noproxy '*' --resolve auth.sachkov.dev:443:201.24.126.23 \
  https://auth.sachkov.dev/oidc/jwks
```

До исправления команда вернула 500 и ненулевой код завершения. После исправления
все три auth-маршрута вернули 200. Discovery содержит точные
`issuer=https://auth.sachkov.dev/oidc` и
`jwks_uri=https://auth.sachkov.dev/oidc/jwks`; JWKS содержит один публичный ключ,
без приватного поля `d`.

## SSH и причина отказа

В панели Timeweb подтверждены Inside App и адрес из owning runbook. Через
серийную консоль с существующим паролем выполнена независимая проверка:
`SHA256:swAfiGThZt4nibgzRGcB/q1Sr2Y1DA2oCAx6sSTUo34`. Fingerprint совпал
с сетевым Ed25519 ключом. Для SSH использовался отдельный проверенный host-key
файл с `StrictHostKeyChecking=yes`; глобальный `known_hosts` не переписывался.
После сверки консольная shell-сессия закрыта, пароль убран из буфера обмена.

Команда независимой проверки:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

Локальные запросы к `127.0.0.1:3301` тоже возвращали 500. Контейнер Logto был
running/unhealthy без OOM/restart, а соединений с базой `logto` не было.
PostgreSQL за две минуты зарегистрировал 57 отказов `permission denied for
database "logto"` / `User does not have CONNECT privilege`. Проверка подключения
владельцем базы с текущим credential прошла.

У `logto_owner` CONNECT был, у рабочих `logto_tenant_logto_default` и
`logto_tenant_logto_admin` — отсутствовал. Их существующая non-login группа
`logto_tenant_logto` также не имела CONNECT. После проверки состава группы и
свежего full backup выполнен один grant в транзакции с проверками до/после:

```sql
GRANT CONNECT ON DATABASE logto TO logto_tenant_logto;
```

Logto стал healthy без перезапуска. Рабочая роль подключилась к базе, три
auth-маршрута вернули 200. `platform` и `telegram_owner` по-прежнему не могут
подключаться к `logto`; Telegram не может подключаться к `inside`. Почтовый
провайдер не был причиной этого HTTP 500.

## Свежая инфраструктурная проверка

- API/Web подтверждают v1, source `188f92ae3bc674ca43a2f4aabbcc454ac22addbf`;
  27 миграций, schema identity
  `sha256:060aafd9a4be9e10b6bc6aea62cf6a0916c7779b747d5a0b5d4ecbbfff82b00e`.
- Все долгоживущие application workers, API, Web, MCP, Telegram и PostgreSQL
  healthy; после исправления healthy и Logto.
- Logto `inside.2` image ID:
  `sha256:d54e49470a9edeff7ae6161ff4621c6e84659e3df48fd9d6004f14ccea33f31a`.
  Telegram image ID:
  `sha256:34e49eee308ddda254ecc5b656709715ef0507757a9e18a11442ea888c0c86fa`.
  Это текущие старые образы, не candidate нового входа.
- На диске 41 GiB свободно; доступно около 2,1 GiB RAM. PostgreSQL имеет
  `init=true`, его порт не опубликован. API/MCP/Web/Logto/Telegram слушают loopback.
  UFW допускает SSH/80/443 для IPv4/IPv6. Foundation health 2018 и provider agent
  10050 имеют wildcard listener, но не входят в UFW allowlist; внешняя проверка
  этих портов пока не выполнена.
- Runtime/foundation env и основной Telegram env — root:root, 0600. Transport
  override сохранён; файл transport.json — root:65532, 0640 для непривилегированного
  relay. Значения конфигурации не выводились.
- TLS всех трёх публичных доменов валиден, TLS 1.3; сертификаты истекают
  4 декабря 2026. Это проверка на дату отчёта, не обещание автоматического renewal.
- Full/diff/incr timers активны. Full backup перед исправлением:
  `20260907-084749F`, pgBackRest status ok, error=false. WAL archiver:
  failed_count=0. `pgbackrest check` от пользователя postgres прошёл.

## Изолированный restore и проверка прав

Backup `20260907-084749F` восстановлен в новый recovery volume до согласованного
конца backup (`type=immediate`). PostgreSQL готов за 9,9 секунды, весь proof
занял 12,97 секунды. Восстановлены `inside`, `inside_telegram`, `logto`; точный
deployed backend подтвердил schema identity v1.

На копии `archive_mode=off`, application/Logto/Telegram процессы не запускались.
После promotion у копии отключена сеть с исходящим доступом; проверка схемы
прошла в отдельной internal network. Рабочая база и её volume не переключались.

`verify-logto-database-access.sql` отклонил исходный отсутствующий CONNECT,
прошёл после возврата grant, отклонил лишний CONNECT у Platform и снова прошёл
после его отзыва. Это реальные проверки PostgreSQL, а не текстовый поиск в SQL.
Все временные контейнеры, сети и volume удалены после проверки ownership labels.
Redacted evidence: `/var/lib/inside/verification/production-355-restore.json`.

## Почта и пользовательский вход

Текущий sender — `no-reply@inside.sachkov.dev`, имя — Sachkov Inside; Reply-To
не задан. SMTP `postbox.cloud.yandex.net:465` использует TLS; авторизация текущим
credential вернула 235 без отправки письма. В подключённом Gmail найдено письмо
от 5 сентября во входящих, с DKIM pass для Inside и Postbox, SPF pass для
технического envelope domain. Это историческая доставка, не новый login proof.

Публичный DKIM CNAME разрешается. SPF Inside пока содержит только
`include:_spf.timeweb.ru`; DMARC не найден ни у Inside, ни у родительского домена.
По [документации Postbox](https://yandex.cloud/en/docs/postbox/concepts/dns-records)
требуется дополнить существующий SPF через `include:spf.postbox.yandexcloud.net`,
сохранив одну SPF-запись; минимальный начальный DMARC — `v=DMARC1;p=none`.
DNS в этой проверке читался с production-сервера, поскольку локальный DNS Mac
не возвращал TXT-записи. Изменения этих DNS-записей ещё не выполнены.

В Chrome на v1 кнопка «Войти» не завершает переход: браузер сообщает нарушение
`form-action 'self'` при redirect к Logto. Этот отдельный blocker уже исправлен
в main, commit `5447fc6`, PR #306 через `authNavigationResponse`. Исправление не
дублируется и требует нового application release. Реальное письмо в этой сессии
не отправлялось; Account не создан. На проверенном серверном snapshot было
0 Logto users и 0 Platform Accounts, авторских прав ещё нет.

Object Storage: HEAD трёх настроенных buckets с текущим application credential
вернул 200. Это не подтверждает upload, содержание объектов, cross-bucket deny,
protected delivery или cleanup.

## Исходная разница конфигурации и подготовленные изменения

Снимок исходной конфигурации относится к `dd64ff7`. В изменении #362 исправлены
tag Logto, API template и точечный Caddy route; production runtime ещё не обновлён.

| Поверхность | Найдено в исходном main | Что требуется до включения |
|---|---|---|
| Logto image | Production Compose: `1.41.0-inside.2`; Dockerfile и versions.json: `1.41.0-inside.4` | Согласовать шаблон с новой сборкой, собрать и закрепить точный image identity; проверить существующий runtime перед заменой |
| Уникальность Telegram identity | `infra/identity/logto/telegram-identity.sql` применяется только disposable bootstrap | Проверить существующий индекс, валидность и отсутствие дубликатов без вывода identities; включать connector только после разрешённой миграции Logto |
| Logto connector | `enabled`, `issuer`, `platformUrl`, `providerUrl`, `integrationSecret`, `botUsername` хранятся в конфигурации connector | Проверить реальные consumer URLs, issuer и секрет; переменные в `logto.env` сами по себе connector не настраивают |
| JWT и sign-in experience | Bootstrap обновляет custom JWT script с фактическим connector ID; разрешает social sign-in без обязательного email | Сверить production customizer, `blockIssuanceOnError`, connector target и `skipRequiredIdentifiers`; сохранить email-вход |
| Platform API | В production-шаблоне отсутствуют `TELEGRAM_SIGN_IN_ENABLED`, `TELEGRAM_SIGN_IN_PROVIDER_URL`, `TELEGRAM_SIGN_IN_INTEGRATION_SECRET`; default — выключено | Подготовить явные настройки после проверки provider и маршрутов; не включать функцию одним флагом |
| Caddy | Platform допускает evidence и Kinescope, затем возвращает 404 для остальных integrations | Выбрать достижимый путь именно для Logto → Platform `linked-identity`; не открывать все integrations |

Фактические потребители по исходному коду:

- Logto → Telegram: `POST /integrations/identity/v1/sign-in`,
  `POST /integrations/identity/v1/sign-in/{requestRef}/status` и `/consume`.
- Logto → Platform: `POST /integrations/telegram/v1/sign-in/linked-identity`.
- Platform Web BFF → API: `POST /integrations/telegram/v1/sign-in/complete` через
  серверный backend transport. Публикация этого маршрута в Caddy не требуется
  только ради BFF, уже использующего внутренний API.
- Platform API → Telegram: `POST
  /integrations/identity/v1/sign-in/{requestRef}/account-link` для завершения
  подтверждённого входа.

Для server-to-server consumers выбраны существующие HTTPS origins:
`https://inside.sachkov.dev` и `https://telegram.sachkov.dev`. В #362 подготовлен
только точный POST `linked-identity`; неизвестные integrations и BFF `complete`
остаются закрытыми. Telegram #45 владеет своими точечными routes. Общая database
network не расширяется для прикладных вызовов. Production Caddy не изменён.
Disposable `identity-proof-bootstrap.mjs` не запускается на production: он также
настраивает тестовую почту и другие принадлежащие стенду ресурсы.

## Незавершённая приёмка

Текущее решение: **NO-GO для итогового нового релиза**. Нет окончательного
candidate с завершённым #329 и совместной приёмки Telegram #45; browser login
v1 ещё имеет известный исправленный в main CSP blocker. Это не запрещает
подготовку и merge самостоятельных исправлений исходников.

Остаются: полный сетевой inventory и внешняя проверка закрытых портов;
новый schema/restore proof после изменения candidate; Postbox API scopes/expiry,
квоты/баланс, DNS corrections, доставка и завершённый email-вход;
Object Storage journeys и avatar; Kinescope #184;
Telegram identity/Membership; авторские сценарии и прогресс; operational handoff.

Получатели, identities и disposable media ещё не согласованы. Порог доставки
почты должен быть принят до реальных отправок. Secrets/PII не записываются в
tracker. Объём и порядок итогового GO остаются в #355 и
[production delivery runbook](../runbooks/production-delivery.md).

В этой сессии выполнены backup, ограниченный production grant и изолированный
restore. Отправки, публикация application release и deployment новых версий
пока не выполнялись.

Проверки исходников: root `pnpm check`, focused foundation/runtime contracts,
`pnpm compose:production:smoke`, docs check и diff check прошли. Production smoke
доказал новые positive/negative routes на локальных точных образах, миграции,
готовность процессов и worker handoff; он не заменяет реальные provider journeys.
