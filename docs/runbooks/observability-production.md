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

Сохранённая причина ошибки имеет закрытые `failure.category`/`failure.code` в PostgreSQL
spans и `failureCategory`/`failureCode` в structured stdout. Они различают constraint, timeout
и connection failures даже при одной операции. Каталог разрешает только зарегистрированные
SQLSTATE, Prisma и Node codes; неизвестная причина остаётся `unknown`. Сообщения, SQL,
произвольные классы ошибок и `module`/`operation` из stdout в хранилище не проходят.
Контекст расследования дают service, trace/span/request/release и шаблон HTTP route либо очередь.
OTLP и stdout Alloy конфигурации генерируются одной командой `privacy_config.py`;
источник stdout: `infra/observability/production/stdout.alloy.tmpl`.

Сети разделены:

- `storage`: хранилища, vmauth, horizon guard, Grafana и collector. Приложения к ней не подключаются.
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
оценивается у текущего времени, с настроенным сдвигом 1 мс.
Штатный сдвиг версии v1.154.0 равен 30 секундам. Он скрывал все samples первой
20-секундной нагрузочной фазы и сдвигал проверку свежести owner cache. Настройка
не ускоряет приём, flush или export: их фактическое запаздывание продолжает измеряться,
а пустой ответ не считается нулём. Запрос с явным историческим `time` сохраняет этот срез.
Чтение метрик и Jaeger проходит через обязательный private `horizon` после vmauth.
Он использует официальный MetricsQL parser закреплённой VM с локальной security patch,
ограничивающей раскрытие `WITH` до выделения памяти. Сборка проверяет исходный файл и patch
по SHA-256, патчит private копию модуля и требует `ParseBounded`, без fallback на `Parse`.
Пределы одного запроса: 4096 tokens, 64 уровня скобок, 4096 единиц работы при раскрытии,
128 уровней рекурсии и 1 MiB суммарных учитываемых копий. Это ограничения admission,
а не измерение RSS. Обычный catalogue проверяется отдельно. Затем guard проверяет фактическое окно
сырых samples, включая rollup, subquery, `WITH`, `offset` и `@`. Непроверяемый запрос либо
запрос через границу 90 дней получает отказ целиком; rollup не заменяется sampled значениями.
Фиксированный исторический `time` сохраняется. Параметр `nocache=1` исключает возврат ранее
вычисленного агрегата с уже истёкшими samples. Перед ответом граница проверяется снова.
Labels/series перечисляются по timestamps сырых samples, не по приближённому storage index;
metadata descriptors возвращаются только для семейств с подтверждёнными действующими samples.
Запросы discovery представляют ограниченное окно, максимум 10 000 series. Переполнение
обязательного набора даёт отказ, а не правдоподобную усечённую коллекцию.
Jaeger list/dependencies ограничиваются окном 14 дней до запроса; из trace-by-ID и mixed trace
дополнительно исключаются просроченные span и неиспользуемые process metadata. Это оконный
вид trace, а не обещание полного дерева. При истечении данных во время чтения итоговый
агрегат отклоняется целиком либо проверяется каждый возвращаемый исходный timestamp.
Лимиты `horizon` 128 MiB / 0.1 CPU являются предохранителями, не измеренным потреблением.
Компонент включён в общий учёт процессов, Linux measurement и cleanup.
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

`COMMIT` заменяется полным SHA принятого выпуска. `install-plugin` приобретает runtime assets:
официальный ZIP плагина и статический query guard из исходников проверяемого commit. Go1.26.4
проверяется по версии; если его нет, SDK скачивается по закреплённым SHA256/размерам из
[toolchain.lock.json](../../infra/observability/horizon/toolchain.lock.json). CGO выключен,
цель Linux и native architecture записываются вместе с hash каждого source input и бинарника.
Сборка ограничена временем, stdout/stderr и отдельными временными каталогами; после сборки
они удаляются. Запуск требует совпадения source/binary manifest. Исполняемый файл имеет mode0500;
компонент переиспользует закреплённый образ metrics с отдельным entrypoint, без нового mutable image.
Подробности и ограничения запросов: [контракт guard](../../infra/observability/horizon/README.md). Private directory имеет mode 0700, keys,
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

Native PostgreSQL/Caddy projection использует отдельный textfile scrape:
`job="platform-owner-cache", instance="production-host"`. Единственный dedicated scrape этого кэша
выполняется раз в 1 s с timeout 1 s; существующая очередь `prometheus.remote_write.host`
имеет `batch_send_deadline = "1s"`. Producer PG/Caddy по-прежнему обновляет native наблюдения
раз в 5 s. Более частое чтение уже подготовленных файлов и короткий batch уменьшают суммарную
задержку до хранилища; timestamps наблюдений и требование свежести 0..10 s не меняются.
Это подготовленная конфигурация, её применение на production требует отдельного запуска.
Старый host scrape раз в 15 s не
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

### HTTP-наблюдения Web

Web имеет отдельный источник `platform-web-http`, независимо от выборки трасс и browser
analytics. Собственные Node HTTP observer и config находятся в `apps/web/server`;
они принадлежат Web и не копируют общий wire-корпус `docs/contracts/runtime`.
Node `--import ./apps/web/web-http-preload.mjs` до запуска generated standalone server
подписывается на публичный `http.server.request.start`. `instrumentation.register` проверяет,
что включённый источник уже готов. В pinned Next запрос может прийти во время asynchronous
startup до register, поэтому поздняя подписка теряла бы первый ответ. Источник считает начало, активные ответы и ровно одно окончание:
`ServerResponse.finish` либо преждевременный `close`. Время включает передачу потока через
Node. Это завершение записи сервером, не подтверждение доставки человеку. Обрыв после
заголовков сохраняет уже отправленный status и `outcome=aborted`; до заголовков status равен
`0`. Отказы TCP/TLS/HTTP parsing до Node request, WebSocket upgrade и HTTP/2 до Caddy этим
источником не покрыты. Caddy остаётся отдельным источником ingress, его counters не суммируют с Web.

Метки содержат только `platform-web`, конечное environment, полный source SHA, method,
status/outcome и шаблон из production `.next/routes-manifest.json`. Конкретный slug, query,
hash, cookie, Account ID и заголовки не сохраняются. Неизвестный путь получает `_unmatched`,
Next static assets получают `_static`. Это шаблон входного адреса до внутренних Next rewrites;
redirects/неизвестные адреса не выдаются за выбранную страницу. Считаются физические HTTP-запросы,
включая RSC, BFF и health probes, а не просмотры страниц. Прежний владелец browser errors/vitals
не меняется.

По умолчанию `INSIDE_WEB_HTTP_METRICS_ENABLED=false`. Подготовленный overlay связывает его с
техническим `INSIDE_OTEL_ENABLED`, независимо от legal/Umami switches. Фиксированный alias
`inside-web-http` существует только в telemetry network. Listener того же Web-процесса слушает
его private IPv4 на `9420`, не `0.0.0.0`; host port и Caddy route отсутствуют. Разрешён только
`GET /metrics`, восемь connections, одна request на socket, короткие transport deadlines.
Shutdown снимает subscription, response listeners и закрывает sockets. Node 26 исполняет
два private runtime TypeScript модуля штатным type stripping, без дополнительного compiler
в image. Их локальная ESM package boundary не меняет module mode остальных Web файлов. Bind/manifest failure
не допускает готовность включённого источника. Заполненный registry (1024 combinations) или
body больше 2 MiB возвращает 503: частичные counts не выглядят успешным scrape.

Alloy читает источник каждые 5 секунд. Общая очередь `prometheus.remote_write.collector_health`
для Web, Caddy и закрытых collector counters имеет `batch_send_deadline = "1s"`;
прочие параметры очереди остаются штатными. Это не обещает, что новая серия появится в запросе
за 10 секунд. Закреплённый VM 1.154 сбрасывает кэш соответствия labels и metric IDs через
[callback index DB](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/v1.154.0/lib/storage/index_db.go#L158-L159)
с [штатным интервалом 10 секунд](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/v1.154.0/lib/mergeset/table.go#L43-L50).
Native pipeline воспроизвёл отсутствие первой серии 404 до 10,757 s при уже видимых
health/current SHA/up. Изолированное прежнее наблюдение queue 1 s за 9,540 s не доказывало
готовность этого холодного набора labels через полный gateway. Scrape 1 s сам по себе
также не устранил холодный отказ, поэтому Web scrape остаётся 5 s. Административный flush
или фиктивные нулевые counters для готовности не используются.

В обзоре есть отдельная строка Web: missing/down/stale
не означает ноль. Каждая серия содержит SHA/environment; process epoch и уменьшение counters
обозначают reset. p50/p95/p99 доступны только для завершённых ответов при >=100 observations,
>=58 source samples за 5 минут, без failed scrape/counter reset/process epoch change и с текущим
возрастом источника 0..10 секунд. Иначе виден Unknown. Для сравнения выпусков выбирают разные
`source_sha`; SDK before/after panels продолжают показывать API/MCP/Telegram.

`pnpm --filter @inside/web test:standalone-config` после production build проверяет первый
реальный HTTP request, 200/404 и закрытие owned process/listener. Только bind alias подменяется
на loopback в отдельном fixture; Next, его generated server и Node HTTP остаются настоящими.
Модульные HTTP contracts отдельно проверяют 500 и обрыв удерживаемого потока при sampling=0.

Пять quality-gated Web queries имеют отдельный native regression. При уже подготовленном
закреплённом VictoriaMetrics binary запустить
`node scripts/owned-node.mjs --command python3 -B scripts/observability-production/prove_web_http_queries.py --vm-binary /absolute/path/victoria-metrics-prod`.
Proof владеет временными storage и loopback process, проверяет настоящие dashboard expressions
на healthy/58-sample cohort и на missing/57-sample/down/stale/reset/epoch-change/99-observation
cohorts, затем закрывает listener. Fixture-only force flush публикует синтетические исторические
samples, он не доказывает runtime ingest latency. Healthy gate сохраняет слева значение
`min_over_time(up[5m]) == 1`; число samples справа только фильтрует его. Иначе PromQL `and`
сохранил бы sample count 58..60, который финальное `== 1` ошибочно скрывало.

Доли 4xx/5xx используют native MetricsQL `increase_pure` для числителя, общего числа ответов
и наблюдённого zero-error fallback. Это собственные counters Web: новая status/outcome серия
создаётся с нулевым count и увеличивается только настоящими окончаниями ответов; импортированных
начальных totals и вытеснения отдельных серий нет. Первый scrape может увидеть уже 1000 ошибок.
Обычный `increase` способен отбросить большой первый sample и показать ложный ноль;
[`increase_pure`](https://docs.victoriametrics.com/metricsql/#increase_pure) сохраняет его при
известном нулевом происхождении counter. Это оценка за scrape window, не журнал точного времени
каждого ответа. Native regression отдельно создаёт новые 4xx, 5xx и 200 серии без прежнего
status sample, проверяет one-sample burst, отсутствие ошибок и старый неизменный error counter.
Не создаётся полный набор route × method × status серий. Source freshness, sample threshold,
process epoch и reset guards остаются обязательными.

Fullstack corpus переключает Web source вместе с ON/OFF. Его одинаковый технический прогрев
в обоих режимах первым делает один настоящий Web 404, затем прежние TLS 200/503, в пределах
прежнего command budget 4 s. Прежние native prefill и stored source-cache barrier остаются
на своих местах.

В ON перед проверкой новых запросов отдельно устанавливается начальная готовность фиксированных
Web-серий. Один настоящий GET 200 и GET 404 создают обе серии. Их отправка и ожидание сохранённых
серий вместе ограничены прежним общим `FACT_TIMEOUT_SECONDS = 60`; каждая команда получает не больше
4 s и оставшегося времени. Readiness требует текущий SHA, единственные конечные положительные
значения source-info, process epoch, observed-at и обоих GET/completed counters, `up = 1`,
возраст источника 0..10 s. Это начальная готовность чтения серий. Она не подтверждает новые
запросы и не использует cut или минимальные counts последующей проверки. Неудачный или поздний
ответ не становится успешным после этой границы. Начальная готовность и свежий witness записываются
отдельными этапами `mode_web_initial_series` и `mode_web_witness`. Общий предел worker остаётся 600 s.

После начальной готовности отдельный witness с прежним budget 8 s читает private metrics до и после настоящих
Web 200/404 с секретным query sentinel. Он требует текущий SHA, отсутствие sentinel, один
raw process epoch и прирост обоих GET/completed counters. За следующие прежние 10 секунд
обычный Alloy/read gateway должен показать не меньше этих новых counts. Timestamp каждого
counter sample и `observed_at` должны быть не раньше raw post-witness cut; возраст источника
остаётся 0..10 s, `up` обязан быть 1. Высокие старые counters прошлого процесса при том же SHA
или один прогрев не заменяют новые наблюдения. Exact floating-point равенство raw process epoch
и сохранённого значения не требуется: VM может сжимать его десятичную точность. Raw epoch
проверяется до/после witness, а сохранённые counters связаны с ним собственными timestamps.
Proof сохраняет только закрытые числовые поля counts/cut/epoch/elapsed, без metrics body или URL.
Это исполняемый proof, не утверждение, что Linux-прогон уже завершился. Изменение не включает
production monitoring или browser analytics.

### Когорты synthetic fullstack proof

Каждая из двенадцати фаз сохраняет прежние длительность, нагрузку и concurrency 8.
Синтетические OTLP probes используют уже разрешённый `http.route=/pilot` и один из
14 фиксированных `service.version`: отдельные когорты фаз, outage и recovery. Эти
40-hex значения являются тегами синтетического опыта, а не SHA исходников приложения.
Настоящий checkout SHA и image identity остаются в отдельном source evidence. Запрос
хранения выбирает точную когорту, поэтому соседняя фаза или recovery не покрывает потерю.
Каталог privacy, пределы 600 секунд на worker и 60 секунд на ingestion не меняются.

Параллельное чтение monitoring использует native HTTP stats Umami: положительный целый
`pageviews` находится в корне ответа. Оболочка `current` принадлежит MCP tool и не является
форматом native endpoint. Проверки metrics, logs, traces и свежих PG/Caddy source-cache
наблюдений остаются обязательными. ACK collector сам по себе не подтверждает сохранение
probe; требуется точное совпадение числа принятых и сохранённых точек своей когорты.

После controlled outage готовность query store не означает готовность остановленного
collector. Существующий recovery barrier в том же общем пределе 60 секунд сначала
проверяет native OTLP listener пустым `resourceSpans: []`, затем прежний query `1`.
Пустой readiness read не создаёт span или metric point. Единственный учтённый recovery
probe отправляется после обеих проверок; HTTP admin Alloy остаётся на loopback контейнера.

### CPU генератора полного измерительного опыта

Только fullstack fixture `loadgen` имеет конечный предел 2 CPU в обоих режимах OFF/ON.
Его память остаётся 96 MiB, concurrency 8, число и темп запросов, двенадцать фаз и внешний
предел 600 секунд сохраняются. Бюджеты приложения, monitoring, provider и короткого
resource fixture не меняются. Этот предел не является измеренным расходом и не задаёт
требования к production серверу.

В отдельном Linux Node 26.10.0 опыте с настоящим TLS прежние 0.25 CPU дали 12/19 периодов
ограничения CPU и 445/770 ms ожидания за OFF/ON спайк. При 0.5 CPU осталось по одному
периоду, 24/22 ms. Отдельная пара с 1 CPU сохранила 400/400 запросов, нулевые счётчики
ограничения и фактический расход 1.249/1.605 CPU-секунды за десятисекундную нагрузку.
Это калибровка генератора на синтетических ответах, а не полная ресурсная приёмка приложения.

Начальная выборка counters выполняется синхронно до запуска sampler и CLI нагрузки.
Медленное чтение PG/Caddy источника не может перенести baseline за начало нагрузки.
Полный hosted Linux опыт с прежним пределом 1 CPU сохранил 400/400 операций в каждой
активной фазе, но четыре фазы получили по одному периоду ограничения (11–15 ms).
Поэтому отдельный опыт с фиксированными HTTP-ответами не доказывает достаточность
1 CPU для полного опыта. Предел 2 CPU является кандидатом для симметричной
калибровки полного OFF/ON опыта. До успешного полного Linux результата он не
считается подтверждённым. Новое ограничение не означает расход двух CPU и не
изменяет лимиты приложения или мониторинга. Дальнейшее увеличение требует
новых измерений. Ненулевые счётчики ограничения по-прежнему запрещают приёмку.

Существующее чтение Engine stats сохраняет только числовые `periods`, `throttled_periods`
и `throttled_time` (наносекунды) из `cpu_stats.throttling_data`. Каждая полная фаза требует
известные монотонные счётчики генератора без нового периода ограничения или времени
ожидания. Неизвестное значение, сброс или фактическое ограничение делает измерение
генератора непригодным. Фаза и исходные samples сохраняются с явной ошибкой
`fixture_loadgen_cpu_throttled` или `fixture_loadgen_cpu_unavailable`, затем работает
прежняя очистка. Для остальных сервисов новые счётчики являются дополнительными данными
и не создают новых обязательных проверок. Медленные ответы приложения по-прежнему входят
в исходные latency samples и проверку p95, пропуски запросов по-прежнему запрещены.

### Ошибки полного корпуса запросов

Каждая ON-фаза сохраняет `query_failure_counts` с числом отказов по конечным причинам:
`metrics_http`, `metrics_response`, `logs_http`, `traces_http`, `traces_response`,
`umami_http`, `umami_response`, `source_cache_http`, `source_cache_response`.
Суффикс `http` означает статус, отличный от 200, включая транспортный статус 0;
`response` означает отказ прежнего содержательного предиката. URL, ключи, тела,
имена сайтов и тексты исключений в этот счётчик не попадают.
`query_failure_status_counts` сохраняет по тем же конечным причинам число ответов
с каждым фактическим HTTP-статусом 100–599, включая 0 при транспортной ошибке.
Нечисловой статус или значение вне диапазона сохраняется как `unknown`, никогда как 0.

`source_cache_failure_counts` уточняет отказы чтения сохранённых источников конечными
причинами: `http`, `schema`, `row_count`, `labels`, `numeric`, `evaluation`, `duplicate`,
`missing`, `unavailable`, `future`, `stale`, `ready_missing`, `ready_count`.
`source_cache_failures` содержит первые четыре числовых снимка отказов за фазу;
число остальных сохраняется в `source_cache_failure_overflow`. Снимок включает прежнее
решение `ready`, время вычисления в VictoriaMetrics и для `postgresql`/`caddy` только
`available`, `observed_at_seconds`, `age_seconds`. Отсутствующие значения остаются `null`.
Неизвестные метки, сырые ответы и тексты исключений не сохраняются.

Диагностические ряды возвращаются тем же единственным запросом с прежним предикатом
`count(count by(source) (...))`, без повторного запроса или пересчёта готовности по часам
клиента. Только прежний результат 2 при корректной форме ответа разрешает готовность.
Ответ ограничен 4096 байтами и прежними двумя секундами; допускаются не более восьми
рядов с точными метками `job`/`source`, единой отметкой вычисления и конечными числами.
`job` различает диагностические ряды, поскольку объединение `or` не различает имена
метрик. Снимаются только известные исходные `__name__`, `job`, `instance`; любая
неожиданная сохранившаяся метка или повторный ряд означает отказ. Отсутствующее решение
готовности означает неизвестное значение, а не 0. Дополнительная диагностика не
устанавливает причину отказа в старом отчёте и не смягчает границы возраста 0–10 секунд.

Успешные последующие чтения остаются в `query_seconds`, но не отменяют ни один
предыдущий отказ: `completed` остаётся false. Положительный целый `pageviews`,
готовность двух источников, прежние сроки и частота запросов сохраняются. Idle-фаза
не создаёт запросы приложения, аналитические события или контрольные точки.
Отсутствие этих счётчиков в старом отчёте не доказывает отсутствие отказов и не
позволяет восстановить причину исторической ошибки.

`timing_diagnostics` дополняет `fullstack-phase-{0..11}.json` числовыми окнами,
не дублируется в сводном `fullstack-proof.json` и не меняет `latency`, p95,
порядок HTTP-вызовов, частоту чтения или решение `completed`. `phase_start` и
`phase_end` содержат `[performance_before_ms, epoch_ms, performance_after_ms]`.
Эти пары связывают часы Node с epoch. Без отдельной связи с часами host они
не позволяют совместить HTTP-вызовы с host/CFS samples. Сопоставление HTTP
с раундами чтения использует одни часы Node и остаётся доступным.
`requests` содержит до 400 строк `[ordinal, kind, start_ms, end_ms]` для шести
измеряемых HTTP-вызовов. `kind` равен остатку порядкового номера по модулю 8:
0, 1, 2, 3, 6, 7 соответствуют прежним меткам `latency`. Время относится к
самому HTTP-вызову, без предшествующего OTLP probe, и отсчитывается от первого
монотонного времени `phase_start`. Порядок строк совпадает с `latency`.
`observer_rounds` содержит до 128 строк `[ordinal, start_ms, end_ms, outcome]`
для полного прежнего чтения metrics/logs/traces/Umami/source cache. Код 0 означает
успех, коды 1–9 соответствуют порядку причин в `query_failure_counts`, указанному
выше. Между раундами остаётся прежняя пауза 500 ms.
Превышения сохраняются в `request_overflow` и `observer_overflow`, некорректные
числовые строки в `invalid_rows`; `state` различает `complete`, `overflow` и
`invalid`. Диагностика не отбрасывает исходные latency samples, не добавляет
новый критерий приёмки и не сохраняет URL, тела, ключи или тексты исключений.
Некорректная или переполненная диагностика не позволяет делать вывод о причине
медленного запроса; исходные решения приёмки сохраняются отдельно.

Каждая исходная запись счётчиков (начальная, периодическая и финальная) дополнительно
сохраняет `counter_clock_anchor`: `[monotonic_before_ms, epoch_ms, monotonic_after_ms]`.
Epoch читается между границами, прежние `technical.capture` и `host()` находятся
внутри окна, а исходный `counters.at_seconds * 1000` лежит между его границами и не
изменяется. Нечисловые, бесконечные, отрицательные значения, значения больше
`2^53 - 1`, нарушенный порядок или исходное время вне окна дают `null`, неизвестную
связь часов. Поле остаётся только в исходном файле фазы, вместе с прежними счётчиками.
При анализе часы со сдвигом между epoch и monotonic или слишком широкие окна
оставляют совмещение неизвестным. Старые результаты без связи host часов нельзя
дополнять предположением по порядку запросов или длительности этапов.
Совпадение временных окон не доказывает, что CFS вызвал задержку конкретного
HTTP-вызова. Диагностика не меняет исходные данные или критерии приёмки.

`source_publication_timing` остаётся только в исходном файле фазы. Оно содержит до
64 циклов и 128 строк PostgreSQL/Caddy в прежнем порядке. Каждая строка сохраняет
`cycle`, конечный `source`, результаты чтения, проекции и публикации, монотонные
границы реального чтения и вызова `_publish`, а также исходное
`observed_at_seconds`, использованное в gauge. Границы публикации охватывают
запись, flush/fsync и atomic replace, не измеряют каждую файловую операцию отдельно.
`clock_anchor` содержит `[monotonic_before_ms, epoch_ms, monotonic_after_ms]`
после попытки источника и связывает эти времена с часами узла Linux.
Исходный вызов часов для gauge не заменяется и не повторяется ради диагностики.
Остальные вызовы `source_cache.sample` по умолчанию не включают observer и не
читают дополнительные часы диагностики.

`state` различает `off`, `complete`, `invalid` и `overflow`. Счётчики
`invalid_rows` и `overflow_rows` ограничены числом 129, которое означает 129 или
более отказов диагностики. Неверная схема, дубликат, пропуск доставки, неизвестные
часы или нарушенный порядок дают неизвестную диагностику, а не нулевую задержку.
`null` сохраняет отсутствующие границы не начатого этапа; неизвестные часы
завершённого этапа также отмечают диагностику как `invalid`. Поля не содержат SQL,
путей, исходных ответов метрик, URL, ключей, произвольных меток или текстов исключений.
Обычная ошибка observer не меняет исходные результаты, чтение, публикацию или
решение приёмки. Активное исходное исключение сохраняется тем же объектом; отмена
`KeyboardInterrupt`/`SystemExit` без активной исходной ошибки передаётся дальше.
Прежний предел sampler в 64 цикла и частота 5 секунд остаются отдельным контрактом.
Эти данные позволяют отличить позднюю публикацию от старого значения в хранилище,
но только при известных и достаточно узких связях часов. Они сами по себе не
доказывают причину исторического stale-отказа или задержки HTTP.

Готовность сохранённых PG/Caddy источников проверяется после Web HTTP witness,
перед первой фазой режима. Остаётся один вызов прежнего барьера на режим и предел
10 секунд. Witness может занять несколько секунд, поэтому проверка до него не
доказывала свежесть источников к началу фазы. Управляемый опыт с двумя каноническими
gauges, настоящими VM/Alloy и неизменным idle CLI воспроизводит этот разрыв;
это не устанавливает причину исторического hosted отказа. Последующая синхронная
выборка CPU counters тоже занимает время, поэтому окончательную пригодность
по-прежнему проверяет полный опыт. Ни один отказ внутри фазы не исключается.
