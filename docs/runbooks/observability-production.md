# Подготовленный production-контур наблюдаемости

Артефакты [#1566](https://github.com/sachkov-inside/platform/issues/1566) готовятся командой
`scripts/observability-production/production.py`. Она не запускает Docker, не подключается к серверу,
не изменяет действующие настройки и не включает сбор. Основной стек, приложение и аналитика имеют
разные Compose projects. Применение требует отдельно разрешённого rollout по
[release runbook](release.md). Локальный [пилот](observability-pilot.md) сохраняет собственный цикл.

## Границы и размещение

VictoriaMetrics хранит метрики 90 суток, VictoriaLogs и VictoriaTraces хранят журналы и traces
14 суток. Закреплённые образы и Grafana logs plugin берутся из существующего
[lock](../../infra/observability/pilot/inputs.lock.json), очистка OTLP генерируется из единого
[каталога](../../infra/observability/pilot/privacy-policy.json). Версия image не заменяет проверку
всего deployment на точном commit.

Сети разделены:

- `storage`: хранилища, vmauth, Grafana и collector. Приложения к ней не подключаются.
- `<project>-telemetry`: private internal network. Приложения отправляют только OTLP на
  `http://inside-telemetry:4318`. У HTTP-сервера Alloy только loopback listener внутри контейнера.
- `hostsource`: отдельный Linux host-agent и приёмник метрик VictoriaMetrics.
- Снаружи опубликованы только `127.0.0.1:18427` (query), `127.0.0.1:13000` (Grafana),
  `127.0.0.1:1514` (TCP syslog для Docker daemon). OTLP и storage ports не публикуются.

Query gateway ограничивает HTTP methods/body; vmauth проверяет отдельные отозвные reader keys
и [закрытые маршруты чтения](../../infra/observability/pilot/vmauth.routes.json), включая read POST.
Ingest/delete/admin не разрешены. Ключ Grafana отличается от ключа агента. Anonymous Grafana и
signup выключены. Loopback сам по себе не защищает от root/пользователей сервера с Docker access.
VictoriaMetrics запускается с `-search.latencyOffset=1ms`: instant-query по умолчанию
оценивается у текущего времени, с минимальным поддерживаемым сдвигом 1 мс.
Штатный сдвиг версии v1.154.0 равен 30 секундам. Он скрывал все samples первой
20-секундной нагрузочной фазы и сдвигал проверку свежести owner cache. Настройка
не ускоряет приём, flush или export: их фактическое запаздывание продолжает измеряться,
а пустой ответ не считается нулём. Запрос с явным историческим `time` сохраняет этот срез.
Для всех LogsQL routes vmauth принудительно добавляет `extra_filters=_time:14d`.
Это глобальный фильтр хранилища, включая subqueries, с текущим временем самого VictoriaLogs,
а не с переданными клиентом `time` или `end`. Совпавший URL query argument клиента
не заменяет доверенное значение; дополнительные form filters применяются только через AND.
Поэтому ещё физически существующий крайний дневной partition не расширяет доступную историю.
Основание: [vmauth query args](https://docs.victoriametrics.com/vmauth/#query-args-handling),
[VictoriaLogs extra filters](https://docs.victoriametrics.com/victorialogs/querying/#extra-filters),
закреплённые `logsql.parseExtraFilters` и `logstorage.ParseFilter` в VictoriaLogs v1.53.0.
Доступ агента из другой среды дают только к query port, не ко всем портам или Docker socket.

## Подготовка

Исполнять в checkout проверяемого commit. Пути должны быть абсолютными, без symlinks;
каталог конфигурации должен отсутствовать. Команда не выводит ключи.

```bash
python3 scripts/observability-production/production.py prepare \
  --output /srv/inside/observability/releases/COMMIT \
  --data /srv/inside/observability-data
python3 scripts/observability-production/production.py install-plugin \
  --output /srv/inside/observability/releases/COMMIT
```

`COMMIT` заменяется полным SHA принятого выпуска. `install-plugin` загружает только закреплённый
официальный ZIP, проверяет digest, размер и пути. Private directory имеет mode 0700, keys,
пароль Grafana и datasources имеют mode 0600. Сервисы запускаются от UID/GID подготовившего
пользователя; data directories создаёт preflight от того же пользователя. Не передавать весь
private directory в issue, журнал CI или артефакты.

До включения нужен отдельный ограниченный filesystem для monitoring data. Он не должен совпадать
с filesystem приложения. Подготовленный preflight требует mount point не более 32 GiB и ≥25%
свободного места как на нём, так и у приложения. Это технический предохранитель, а не измеренный
необходимый размер. Создание/изменение filesystem относится к отдельно согласованным серверным
работам. Нельзя положить bind directories на общий диск и назвать retention hard quota.

```bash
python3 scripts/observability-production/production.py preflight \
  --output /srv/inside/observability/releases/COMMIT \
  --application-data /srv/inside/application-data
```

Logs/traces имеют аварийный порог 8 GiB каждый; хранилища прекращают ingestion при остатке
менее 1 GiB. Порог partition retention может быть превышен свежими partitions, поэтому физическое
разделение дисков обязательно. Сокращение истории считается отказом приёмки. Настройки memory/CPU
в Compose ограничивают процессы; оценка требуемого тарифа производится по полному resource corpus,
Umami и PostgreSQL добавляются к техническому контуру. Общий потолок не доказывает наличие запаса.

## Разрешённое включение и выключение

Эти команды являются рецептом будущего rollout. Сейчас они на production не выполнялись.
Перед любым repository Compose command проверить `docker compose ps` и соблюдать
[владение стендом](local-stand.md). Действующий singleton не принадлежит этому контуру.

```bash
docker compose -f /srv/inside/observability/releases/COMMIT/compose.json config --quiet
docker compose -f /srv/inside/observability/releases/COMMIT/compose.json up -d
```

Сначала проверить readiness, query/auth negatives и stdout sentinel на изолированном стенде.
Затем в существующую команду приложения добавить последним файлом
`platform.compose.json`; Telegram использует `telegram.compose.json`, foundation PostgreSQL
использует `database.compose.json`, Logto использует `logto.compose.json`. Существующие Compose
project name, env files, networks, volumes и runtime images сохраняются. Нельзя запускать overlay
самостоятельно как новое приложение. SDK остаётся OFF до явного `INSIDE_OTEL_ENABLED=true` в
окружении вызова Compose. Изменение logging driver требует пересоздания затронутых контейнеров;
время недоступности приложения объявляется до отдельно разрешённого rollout.

Stdout использует Docker TCP syslog, `mode=non-blocking`, memory buffer 1 MiB и
`cache-disabled=true`. Последнее выключает raw dual-logging cache Docker. Alloy принимает RFC5424,
проверяет service tag и заменяет текст закрытой JSON-проекцией event/level/release/request/trace/span.
Свободный текст, exception message, SQL, адреса, headers, hostname и payload не сохраняются.
Неизвестный event становится `stdout_redacted`; это утрата детализации, не отсутствие ошибки.
Неподходящий service tag отбрасывается. Есть counters парсинга/экспорта, но Docker не предоставляет
этому контуру полный счётчик потерь non-blocking buffer. Полнота stdout при outage неизвестна.

Порядок отключения: сначала выставить `INSIDE_OTEL_ENABLED=false` и пересоздать приложение
с исходным logging driver, затем остановить monitoring project командой `down` без `--volumes`.
Нельзя сначала остановить syslog receiver и оставить logging driver приложения направленным в него:
уже работающий процесс продолжит работу с возможной потерей журналов, а новый container start
может не подключиться к syslog. Отключение monitoring не удаляет доменные данные и сохранённые bind data.

## Linux host и container metrics

Профиль `host-metrics` включается отдельно после проверки на настоящем Linux хосте:

```bash
docker compose -f /srv/inside/observability/releases/COMMIT/compose.json \
  --profile host-metrics up -d host-agent
```

Он использует тот же pinned Alloy, встроенные unix exporter и cAdvisor. Согласно
[официальному deployment contract](https://grafana.com/docs/alloy/latest/reference/components/prometheus/prometheus.exporter.cadvisor/)
cAdvisor требует privileged и host mounts, включая Docker socket через `/var/run`.
Это доверенный операторский процесс, не read-only principal агента. Он не подключён к сетям
приложения/query и не публикует ports. Основной collector не имеет Docker socket.
Raw IDs, container environment, image names и произвольные Docker labels в metrics не сохраняются.
Допускаются известные service names и ограниченный Compose project name; labels не заменяют
контроль владельца процессов. Mac/OrbStack run не подтверждает наблюдение физического Mac или VPS.

Host memory/CPU/disk/inodes/IO и container memory/CPU/throttling/network/OOM берутся из exporter.
`container_start_time_seconds` показывает смену запуска, но не является точным счётчиком всех
restart между scrape. Отсутствующие counters/series показываются как неизвестные.
Состояние backup, domain payments/access и operational readiness остаются у действующих Watchdog
и Platform MCP. Новая панель не превращает cached queue gauge в проверку работоспособности worker.
Не добавлять к этому профилю общий публичный Docker API или unauthenticated metrics port.

## Ключи, обновление и откат

Для отзыва agent key удалить соответствующего пользователя из private `auth.json` и перезапустить
только vmauth. Проверить, что старый ключ получает отказ, а Grafana продолжает читать своим ключом.
Native MCP подключаются по [существующему runbook](observability-pilot.md), меняется только
instance entrypoint на защищённый query tunnel и отдельный reader key. Не предоставлять write
endpoint или admin credentials как обход недоступности.

Обновление готовится в новом private release directory. Сохранить прежние secrets/reader principals
по действующему механизму секретов, не генерировать незаметно новые действующие identities. Сначала
повторить pinned config/auth/privacy/capacity checks и совместимость хранилищ на копии данных.
Для отката collector/application overlays использовать ранее проверенный release directory.
Откат image не восстанавливает прежний формат storage. Если новая версия изменила формат данных,
допустим только заранее проверенный путь восстановления; `down --volumes` не является откатом.
После применения проверить freshness, реальные traces/log links, negative read-only сценарии,
ресурсы, отключение и восстановление, затем семь суток роста и нагрузки.

## Отдельная аналитика

Подготовка также создаёт `umami.compose.json`, private `umami.env` и
`umami.database.password`. Это отдельный project с профилем `analytics`; основной technical
Compose file не запускает Umami. Сначала настроить выделенные database/role в существующем
PostgreSQL через `scripts/observability-umami/setup_database.py`, используя
`--password-file /srv/inside/observability/releases/COMMIT/umami.database.password`.
Не передавать пароль аргументом, не публиковать database port и не заменять production grants
пилотным PostgreSQL. Порядок обслуживания и восстановления принадлежит
[Umami runbook](observability-umami-pilot.md).

При разрешённом запуске установить `FOUNDATION_DATABASE_NETWORK` равным действующей закрытой
сети PostgreSQL. `umami` имеет отдельную базу/роль, connection limit 8, pool timeout 5 секунд,
лимит памяти 1 GiB и CPU 1. Native Umami/administrative API не публикуется. В сеть приложения
входит только `umami-ingest:3000`, разрешающий POST `/api/send` с телом до 16 KiB.
Web server использует `INSIDE_UMAMI_ENDPOINT=http://umami-ingest:3000/api/send`.
Legal gate, собственный analytics switch и пользовательский выбор проверяются независимо от
технического SDK switch. Пока они не приняты, browser tracking остаётся выключенным.

Query gateway использует текущий ограниченный Python handler, `127.0.0.1:13301`, и отдельный
`umami.reader.key`. Файл изначально пуст, чтение закрыто. После private bootstrap Umami сменить
исходный admin password, создать отдельного reader с чтением нужной team/site и записать его
настоящий native API key в этот файл с mode 0600. Synthetic fixture seed не является production
bootstrap, его запуск на действующей базе запрещён. Native `@umami/mcp` 0.2.0 из существующего
package-lock использует `UMAMI_URL=http://127.0.0.1:13301` через отдельный tunnel и
`UMAMI_API_TOKEN`, взятый из private reader file. Не подключать MCP к administrative API.
При revoke удалить native key и очистить reader file, затем проверить отказ обоих путей.

## Исполняемая проверка артефактов

```bash
bash scripts/heavy-check.sh node --test scripts/observability-production.test.mjs
bash scripts/heavy-check.sh python3 scripts/observability-production/check.py run \
  --output /absolute/task-owned/fresh-private-directory
```

Вторая команда требует committed source и использует существующий внешний pilot supervisor,
storage guard и cleanup. Она создаёт только собственный disposable project и synthetic volumes,
проверяет actual config, query/auth negatives, запрет anonymous Grafana, stdout sentinel и
корреляцию, затем отзыв reader key. Host-agent на Mac не запускается. Такой smoke не проверяет
физическое разделение дисков VPS, native Docker syslog driver или полный resource corpus.
Публикуются только `production-proof.json`, `evidence.json`, `cleanup.json`, `worker-outcome.json`;
весь private directory содержит ключи и не является отчётом для публикации.

На отдельном Linux runner дополнительная команда исполняет ту же проверку, а затем два повтора
idle/steady/spike по [фиксированному профилю](../../infra/observability/production/workload.json):

```bash
bash scripts/heavy-check.sh python3 scripts/observability-production/measure.py run \
  --host-metrics --output /absolute/task-owned/fresh-private-directory
```

Профиль `host-metrics` здесь включается только на собственном disposable Linux runner.
Без флага он остаётся выключенным. Проверяются реальные `up`, наличие принадлежащих Compose
container series и отсутствие container series без service/project. Совместно с ingestion
выполняются ограниченные metrics/logs/traces queries, снимаются CPU counters, charged memory,
working set/file cache, доступные IO counters и размеры четырёх собственных volumes.
`production-measurements.json` сохраняет фактические samples, длительности, ingestion lag,
наблюдаемые drops и ошибки. Missing IO/volume/drop counter остаётся `null`, не нулём.
Максимум memory samples называется наблюдаемым максимумом, не гарантированным peak.

Это синтетический technical topology measurement. Shared PostgreSQL/Umami, весь корпус приложения,
HTTP p95 ON/OFF, полная история/restore и запас физического Timeweb хоста остаются отдельными
требованиями. Поле `acceptance` сохраняет `pending`, даже если выполнение профиля завершено.
Linux CI запускает этот публичный путь с теми же pin, storage guard и cleanup; не ослабляет их
из-за недоступности Mac registry или занятого локального стенда.

Обзор Grafana подготовлен в `owner-overview/dashboard.json`: сравнение HTTP API/MCP,
host/container metrics, queue/dependency/export symptoms. Его production data и визуальная приёмка
проверяются отдельно. NoData не заменяется нулём. Семь суток production-наблюдений и измерения
Timeweb этим документом не объявляются выполненными.

## Обзор владельца и наблюдения действующих владельцев

Один `Platform production overview` содержит HTTP before/after для API, Platform MCP и
Telegram, ресурсы, queue samples, closed cached business conditions и переходы к ограниченным
отчётам Platform MCP/Umami. Общий HTTP quality mask не показывает скорость/доли при недостатке
samples, reset, сбое collection или неразличимых SHA. Это оценка сохранённых наблюдений, не
доказательство причинности или полноты всех запросов.

Таблица ожидаемых источников сохраняет строку при отсутствии series: `1` означает наблюдаемый
источник, `0` означает наблюдаемый отказ, `-1` означает UNKNOWN/stale/missing. Для SDK и core
collection допускается возраст до 10 s, host scrape до 45 s, Watchdog до 180 s. Будущее время
не принимается. Успешное чтение источника не заменяет проверку наличия нужных полей. Отсутствующий
queue sample не становится нулём, а sample очереди не доказывает liveness worker.

Действующий `inside-watchdog` атомарно сохраняет `/var/lib/inside/watchdog/metrics/owner.prom`.
Это отдельный каталог с числовыми агрегатами, доступный host-agent только через точный read-only
bind с `create_host_path: false`. Секреты, active/streak/outbox, SQL results, текст журналов,
container names и идентификаторы людей туда не попадают. Сохраняются только уже выполненные reads,
дополнительных запросов к БД, Telegram или журналам панель не делает. Панели требуют совпадения
времени поля с последним completed-cycle timestamp, поэтому прежний sample из lookback окна
не заменяет неизвестное поле нового цикла. Нулевые counts публикуются
при реально прочитанном нуле. При ошибке источник получает `0`, а неизвестные значения исчезают.
Пропущенный во время deploy или прерванный запуск не освежает timestamp. После reboot неизвестный
last backup result остаётся UNKNOWN. Telegram counter decrease имеет отдельный reset marker;
первое наблюдение не доказывает отсутствие пропуска.

В production старый Watchdog сначала обновляется подготовленным пакетом по существующему
процессу выпуска. До старта `host-metrics` выполнить один обычный завершённый цикл Watchdog и
проверить наличие безопасного `metrics/owner.prom`. Compose отказывает при отсутствии каталога,
не создаёт на хосте каталог автоматически. При выключенном/старом Watchdog источник UNKNOWN.
Порядок уведомлений, пороги, подтверждение отказа и восстановление действующего Watchdog сохранены.

| Наблюдение | Значение и граница |
|---|---|
| purchases | `unknown/authorized` старше 15 min или `sent/pending` старше 25 h. Это исключения, не все покупки. |
| fulfillment | Не применённая выдача доступа старше 5 min. |
| notification_outbox / email_effects | Существующие условия без итога старше 10 min. |
| billing_queue_idle | `1`: нет completed `billing.payment-recovery` за 5 min. |
| Telegram queues | Возраст pending/due, native webhook pending count; failed/unknown community operations за 10 min. |
| backup timer / success | Наблюдаемые active/last-result состояния; latest success age по systemd. Это не restore proof. |
| containers | Агрегированные down/unhealthy/OOM существующих проектов; неизвестны при ошибке inspect. Пустой listing не доказывает наличие ожидаемой службы. |

Факты оплаты, paid grounds, effective access и sales funnel остаются у узких владельцев модулей.
Переход в [существующий Platform MCP](production-diagnostics.md) использует прежний
`platform:admin`, ограниченное окно, limit и continuation. Нельзя помещать приватные примеры
в Grafana metrics или суммировать returned-page/cohort counts. Переход к
[Umami native read-only](observability-umami-pilot.md) требует отдельного read key и ограниченного
окна. Выключенная аналитика не означает нулевую активность. Tracker не включается этим обзором.

При полном удалении отдельно включённого host-agent указывать профиль и для остановки:

```bash
docker compose -f /srv/inside/observability/releases/COMMIT/compose.json \
  --profile host-metrics down
```

Проверить отсутствие контейнера host-agent именно этого monitoring project. Не использовать
`--volumes` для остановки production. Disposable Linux measurement при явном `--host-metrics`
снимает profile только в своём временном плане, чтобы общий supervisor/recover видел эту службу
без повторного указания флага. Production default OFF при этом сохраняется.

Native PostgreSQL/Caddy projection использует отдельный пятисекундный textfile scrape:
`job="platform-owner-cache", instance="production-host"`. Старый host scrape раз в 15 s не
читает эти файлы повторно. `inside_production_source_available{source="postgresql|caddy"}`
и `inside_production_source_observed_at_seconds` различают наблюдаемый отказ и устаревший cache.
Приёмка требует оба отдельных источника, значение `1` и возраст от 0 до 10 s; два ряда одного
источника не заменяют второй. Нельзя использовать общий scraper `up` как доказательство чтения
PostgreSQL или Caddy. Выключенный producer и отсутствующий mount остаются UNKNOWN.

`source_cache.sample` принимает только два caller-owned read callback, получает фиксированный
ordinary-role SQL из действующего `query.mjs` и проверяет ответ прежним `frame.decode`.
Production scope изменён с disposable `tracking` на `inside`; остальные SQL/controls сохранены.
В cache попадают только числовые `inside_postgresql_server_*` aliases approved native полей,
включая sample/postmaster/statistics-reset epochs. Privilege flags, неизвестный/нулевой epoch,
неподходящая версия или просроченный SQL ответ дают unavailable, не ложный ноль waiting locks.
Не выдаются `pg_monitor`, `pg_read_all_stats`, SELECT прикладных таблиц или права Platform MCP.
Повторный bootstrap reader принимает только собственный marker и отсутствие посторонней
ownership/ACL authority, включая CREATE или grant option на базе; отказ имеет SQLSTATE `P1567`.

Caddy public server выбирается по фактическому `caddy adapt` через общий
`select_caddy_server`, а не по предположению `srv0`. Принимается один public `:443` server,
включённые global metrics и выключенный либо loopback admin. Native source проверяет labels,
типы, целостность histogram и excluded roles до удаления; точный vendor server
`remaining_auto_https_redirects` проверяется и исключается из public counts. Cache сохраняет
только public/subroute, закрытые method/code/bucket и process epoch. Это не покрывает
pre-route parse, TCP/TLS/HTTP3 отказы и не означает непрерывность через reset.

### Подготовленный host producer, OFF по умолчанию

`native_sources.py` выполняет один bounded read cycle. У него нет сервера или credentials агента.
Host PostgreSQL transport разрешает только `/var/run/docker.sock`, один running postgres container
точного Compose project, проверяет ID/labels до и после exec и запускает только фиксированный
ordinary-role `psql -X -qAt -w -U postgres_source_reader -d inside`. SQL идёт stdin, ответ ≤4096 B,
общий Docker/read deadline 3 s. SQL statement timeout 2 s, lock 250 ms, idle transaction 3 s;
role CONNECTION LIMIT 1 ограничивает зависшую сессию. Роль не получает пароль или application
SELECT. Local authentication внутри действующей foundation должна позволять этот root-owned
Docker exec; если она не позволяет, source unavailable. Нельзя выдавать sampler superuser или
`pg_monitor` вместо устранения неверного transport/permission contract.

Caddy reader делает только loopback GET `/metrics` и transient GET `/config/` на `127.0.0.1:2019`.
Второй нужен для фактического public-server mapping и проверки неизменности selected role вокруг
scrape. Raw config, hostnames, routes, tokens, SQL и error text не сохраняются и не публикуются.
Proxy/redirect запрещены, каждый HTTP read ≤1 s/1 MiB. Admin URL не попадает в vmauth, Grafana,
MCP или principal агента. Сам действующий Caddy admin остаётся loopback; источник не меняет его.
Для native HTTP metrics оператор при разрешённом rollout добавляет `metrics` в существующий
Caddy global block, проверяет `caddy adapt`/`caddy validate` текущего config и выполняет штатный
reload. При выключенных metrics или неизвестной adaptation источник UNKNOWN/unavailable.

До rollout подготовить immutable source checkout принятого COMMIT. Сначала выполнить optional
Umami database setup, если он входит в этот rollout, затем dedicated source reader bootstrap:
Umami setup сохраняет права существующих ролей при отзыве PUBLIC CONNECT, поэтому обратный порядок
может расширить direct CONNECT reader и будет честно отклонён guard. Bootstrap не включён в timer:

```bash
INSIDE_PRODUCTION_SOURCE_SETUP_ENABLED=true python3 \
  /srv/inside/observability/source/COMMIT/scripts/observability-production/native_sources.py \
  setup-postgres --project inside-production-database
```

Уже существующая роль с чужими ownership/ACL/memberships или без собственного marker вызывает
`P1567` до изменения роли. Не удалять эту роль и не ослаблять проверку ради успешного setup.
Если Umami впервые подключают позже, перепроверить dedicated source grants после его provisioning;
неожиданный direct CONNECT в другую базу требует отдельного разбора и не принимается за норму.
Production statistics не сбрасываются для получения ненулевого reset epoch. Неизвестный epoch
после старта БД остаётся UNKNOWN до настоящего наблюдаемого значения.

Подготовлены `systemd/inside-monitoring-sources.service`, `.timer` и `sources.env.example`.
Установка файлов сама по себе не включает timer; example содержит `INSIDE_PRODUCTION_SOURCES_ENABLED=false`.
В разрешённом rollout оператор копирует env в `/etc/inside/observability/sources.env` (root:root0600),
устанавливает immutable source path и только после проверки ставит флаг true. Unit работает от root
ради существующего Docker daemon, отдельный docker-group account не создаётся. Это доверенная
операторская capability, отличная от query key агента. Только root/code/config владельца имеет её.
Unit имеет внешний timeout 8 s, MemoryMax64M, CPUQuota20%, Nice15, PrivateTmp/ProtectSystem и доступ
по сети только к loopback. Эти значения являются пределами, не измеренной потребностью сервера.
Timer просит цикл каждые 5 s; фактический возраст остаётся частью query acceptance и не скрывает
задержки. При нормальном выполнении producer заменяет только свои два `.prom` файла атомарно.

Проверить оба native источника, их epochs, source timestamp age0..10 и отсутствие raw fields в
хранилище, затем включать host-agent. При disable сначала остановить/disable этот timer,
оставить старые snapshots со старым timestamp (они станут UNKNOWN), затем выключать host-agent.
Откат использует прежний immutable source/unit/config; не удаляет приложение или чужие данные.
Готовность Linux fixture не подтверждает установку systemd или private Caddy config на production.

### Закрытая диагностика startup в synthetic proof

Если optional host-agent завершился до первого подтверждённого stored observation, proof остаётся
неуспешным. В пределах того же зарегистрированного CI project worker проверяет точный container ID,
project и service, останавливает только этот контейнер с grace 2 секунды и один раз запускает
`docker start --attach` для того же ID. Новый service, контейнер или image не создаётся. Attached
read ограничен 8 секундами и 4096 байтами совокупного stdout/stderr, вся процедура 12 секундами;
прежний внешний supervisor и его предел 600 секунд сохраняются. Последующая очистка остаётся
обязанностью того же supervisor.

Содержимое output существует только в ограниченной памяти и преобразуется в один код причины
из фиксированного перечня и exit code. Файлы, public artifacts и job log не получают исходный
output, текст ошибки, command или environment. `host_startup_diagnostic` публикует только эти
два поля. `unknown` и `unavailable` не объясняют причину; совпадение фиксированного сообщения
показывает класс отказа, который требуется проверить исправлением и повторным native запуском.
Диагностика не запускается после успешного startup, при исходном interrupt или exit и никогда
не превращает исходный failure в PASS. Эта процедура относится только к disposable synthetic
proof, её код не устанавливается на production host и не запускает production контейнеры.

Host remote-write WAL задаёт явный диапазон `min_keepalive_time=1m`, `max_keepalive_time=5m`.
У закреплённого Alloy v1.21 default minimum равен 5 минутам, а runtime validator требует
строго `min < max`. Поэтому прежний один `max=5m` проходил syntax validation, но завершал
initial component construction с exit 1. Изолированный запуск того же cached pinned executable
без host mounts, ingress, ingest или сети воспроизвёл точный vendor refusal; явный `min=1m`
дал HTTP readiness 200 с ожидаемым body. Это проверка построения компонента, полное Linux
исполнение host/container exporters и ресурсная приёмка остаются отдельными проверками.
[Закреплённый vendor contract](https://github.com/grafana/alloy/blob/v1.21.0/internal/component/prometheus/remotewrite/types.go)
задаёт default и строгую проверку диапазона. Предел хранения telemetry в VictoriaMetrics не меняется.
