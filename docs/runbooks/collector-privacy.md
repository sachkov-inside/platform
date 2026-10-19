# Кандидат фильтрации технической телеметрии

Подготовленная часть [#1566](https://github.com/sachkov-inside/platform/issues/1566).
Production и default-OFF настройки SDK не меняются. Конфигурация предназначена для изолированного
синтетического пилота и композиции с нашим SDK, а не для произвольных OTLP источников.
Синтетический core на Mac source `525f71d1` прошёл с прежним config. Новый кандидат добавляет
фильтр link metadata перед хранением VictoriaTraces и требует отдельного GREEN. Полная privacy/resource
приёмка и фактический SDK → collector → storage запуск остаются неподтверждёнными.

## Граница и сохраняемые данные

Путь в [config.alloy](../../infra/observability/pilot/config.alloy): OTLP receiver → закрытый каталог
метрик → transform → соответствующий exporter. Receiver поддерживает штатные JSON/protobuf OTLP;
отдельного протокольного gateway нет. Сырой request body, headers и client metadata не копируются
в телеметрию.

[privacy-policy.json](../../infra/observability/pilot/privacy-policy.json) фиксирует service/environment,
HTTP methods, зарегистрированные route templates, canonical `jobQueues`, pg-boss operations и metric
names. Routes сверяются с checked-in OpenAPI; это шаблоны с параметрами, а не значения URL.
Неизвестные attributes удаляются. Неизвестные значения разрешённых строковых attributes становятся
`_OTHER`; статус ограничен 100–599, retry/batch counters — 0–1,000,000, job ID — UUID только в span,
не в metric labels. Release допускает только 40 lowercase hex или три числовые части версии.

Сохраняются trace/span/parent IDs, время, код статуса, шаблон route, HTTP counts/durations и
разрешённые queue facts. Span name строится из закрытых operation/route значений; отдельные пять
синтетических названий smoke сохранены. Status message, span events, tracestate, scope attributes,
scope version, metric description и exemplars удаляются. Произвольное log body заменяется константой;
из event text сохраняется только фиксированный `pilot.known_failure`. Application stdout/docker logs
в этот OTLP путь не подключены.

Transform/filter используют `error_mode = "propagate"`: ошибочный тип или выражение прекращает
обработку payload. Режимы ignore/silent не используются: они могли бы пропустить исходное поле после ошибки.
Это не доказательство покрытия всех будущих типов и новых источников.

## Notifications: зарегистрированный materials lane

Collector catalog дополнен уже существующим
[`observeNotification`](../../apps/backend/src/infrastructure/observability/technical-telemetry.ts):
service `platform-notifications-worker`, `messaging.system=rabbitmq`, единственная destination
`inside.events.materials.v1`, operations `publish`, `receive`, `audience` и error code
`notification_operation_failed`. Другие email/Telegram/billing lanes этим не инструментируются.
222 HTTP route entries и девять canonical pg-boss queues сохранены отдельно; RabbitMQ exchange
не добавлен как pg-boss queue. Сохранённое имя span строится прежним закрытым правилом,
например `publish inside.events.materials.v1`, а не обещает исходное SDK имя `publish materials`.

Разрешены только две новые raw OTLP метрики: counter `inside.notification.operations` и histogram
`inside.notification.duration` в секундах. Только их datapoints сохраняют `operation` и `outcome`;
HTTP/pg-boss metrics сохраняют прежние keys. Operation ограничен тремя значениями выше, outcome
ограничен `completed`/`failed`. Неизвестный, отсутствующий или нестроковый атрибут заменяется `_OTHER`.
Account/message IDs, адреса, HTTP attributes и другие поля не становятся notification metric labels.
Pinned [OTTL datapoint resolver](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/v0.162.0/pkg/ottl/contexts/ottldatapoint/datapoint.go)
поддерживает `metric.name` для такого ограничения; обычные contracts не исполняют OTTL и не заменяют
reviewed actual RUN.

В существующем public supervisor подготовлен отдельный внешний JSON/protobuf corpus, не запуск SDK.
Для каждого transport есть шесть operation/outcome комбинаций и один fallback span с фиксированными
trace/parent/link IDs. Метрики дополнительно проверяют неизвестные, отсутствующие и нестроковые
значения. Полные VT rows проверяются до Jaeger projection; разрешены только два новых фиксированных
trace IDs с limit 8, без новых public query routes. Секретный sentinel не должен сохраняться ни в одном
прочитанном поле или metric response. `notification-collector.json` содержит только закрытые результаты.
Logging-none execution gate остаётся перед unsafe ingest; resource, identity, cleanup и 600s guards сохранены.

Pinned [VM naming](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/v1.154.0/lib/protoparser/opentelemetry/stream/sanitize.go)
по умолчанию сохраняет точки в именах;
[histogram decoder](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/v1.154.0/lib/protoparser/opentelemetry/pb/pb.go)
создаёт `_count`, `_sum`, `_bucket`. Corpus ожидает 70 series: два фиксированных release resources,
семь нормализованных labelsets и пять counter/histogram series на labelset. Это ожидаемый результат
будущего runtime, не измерение. Native MCP делает дополнительный metric query и два trace query
в тех же трёх owned/measured процессах; проверяется JSON body, все span IDs и причинные references,
а не только наличие marker. Pinned tools
[VM1.20.2](https://github.com/VictoriaMetrics/mcp-victoriametrics/blob/v1.20.2/cmd/mcp-victoriametrics/tools/utils.go)
и [VT1.5.0](https://github.com/VictoriaMetrics/mcp-victoriatraces/blob/v1.5.0/cmd/mcp-victoriatraces/tools/utils.go)
возвращают HTTP body как JSON TextContent. Неизвестный формат считается неподтверждённым.

Для одного фиксированного service/environment/release SDK даёт до шести labelsets на instrument;
с `_OTHER` верхняя граница составляет 12 на instrument. Histogram buckets увеличивают число stored
series, поэтому это не общий Prometheus series limit. Число releases не ограничивается проверкой
формата release. SDK cardinality/export limits и default OFF не меняются. Actual application SDK
wire, полный durable journey, ресурсный запас и production acceptance остаются отдельными gaps.

## Links: обязательное ограничение кандидата

Links сохраняются для уже проверенной pg-boss batch correlation. Наш SDK `safePgBossSpan` создаёт
отдельный snapshot и удаляет link attributes и link tracestate до batch/export; эта часть контракта
описана в [SDK runbook](backend-technical-telemetry.md).

**OTTL не очищает произвольную metadata внутри links.** В закреплённой версии доступен только весь
`SpanLinkSlice`; очистка всего slice сломала бы корреляцию. Исходный VictoriaTraces decoder сохраняет
link tracestate и attributes. Новый кандидат удаляет эти поля через статический exporter header
`VT-Ignore-Fields: link:link_attr:*,link:link_trace_state:*` на закреплённой границе ingestion.
Link trace/span IDs, flags и dropped-attribute counts не входят в фильтр. Receiver явно отключает
client metadata; входящий caller не задаёт этот header или query exporter. Это target-specific
фильтр перед storage, не универсальный sanitizer внутри Alloy для любого backend.
До фактического GREEN и закрытия остальных gaps production/general-source acceptance запрещена.

`require_supported_links` проверяет только собственный harness corpus. Его отрицательный тест
отвергает unsafe fixture; это не enforcement на collector endpoint и не успешная проверка очистки
такого входящего payload. Полная задача остаётся незавершённой, пока эта граница не решена и проверена.

Подготовлен отдельный adversarial corpus для существующего публичного supervisor. Два небольших
внешних trace payload поступают через OTLP HTTP JSON и отдельно закодированный protobuf по
[schema v1.5](https://github.com/open-telemetry/opentelemetry-proto/blob/v1.5.0/opentelemetry/proto/trace/v1/trace.proto).
Каждый содержит три link с известными IDs, tracestate и scalar/nested/array/binary attributes.
К ним намеренно не применяется SDK-only `require_supported_links`. На source
`564696680c43f29258770a4b35145fd1caf501c5`, tree `dc78d46d1c8e4f6bcfa292619326342796ade0c7`,
публичный supervisor подтвердил RED: оба transport сохранили одну строку и все три link,
но metadata/sentinel остались в storage. Worker exit 1, monitor не отказал, diagnostics/down/residue PASS,
независимо проверенный остаток собственных containers/volumes/networks равен 0.
Curated RED proof SHA256 `e482ce397a6d8345d5c5c75156f68b6c06f023efdddf789030f2e83e60d3fa7d`.
Новый filter/logging/counter кандидат ещё не исполнялся. Oversized/error corpus пока не запускается.

Проверка читает полные сохранённые поля по двум фиксированным trace IDs через внутренний
`/select/logsql/query`. [Закреплённый handler](https://github.com/VictoriaMetrics/VictoriaTraces/blob/v0.12.0/app/vtselect/logsql/logsql.go)
возвращает все columns как NDJSON, если query не содержит `fields` pipe;
[storage decoder](https://github.com/VictoriaMetrics/VictoriaTraces/blob/v0.12.0/app/vtinsert/opentelemetry/pb.go)
разделяет link IDs, tracestate и attributes. Проверка требует одну строку, точные trace/span/parent IDs
и все три пары link IDs. Jaeger/MCP projection не подменяет этот storage read.
Read-only exec разрешён только в собственном gateway после проверки frozen daemon/socket identity,
Compose project/service и running state. Query, размер ответа и время ограничены; vmauth/MCP routes
не расширяются. Raw ответ и stderr остаются только в памяти, не попадают в logs или artifacts.

`collector-link-privacy.json` содержит только фиксированные verdicts, counts и booleans.
При потере ownership поле `storage_failure` различает фиксированные boundary и reason:
проверку входа/fixture, frozen identity до/после чтения, поиск контейнера, проверку его ID,
inspect и проверку владельца. Категории причины ограничены timeout, отказом команды,
ошибкой I/O, недопустимым значением или неподтверждённой проверкой. Raw ошибки, аргументы,
пути, IDs и labels не сохраняются. Для actual source `80673cdd` известен только отказ ownership;
эта диагностика не устанавливает причину того завершённого запуска задним числом.
Сохранённые metadata или sentinel дают FAIL; недоступный query, неполная schema или потеря связей
дают UNKNOWN и FAIL. Проверяются оба transport перед общим отказом. На неподготовленном storage
ожидается реальный RED. Потеря ownership немедленно прекращает оставшиеся ingest/query calls,
включая второй transport. После обычного privacy RED
текущий smoke остановится до native MCP/restart/revocation.
Их прежние проверки сохранены для будущего GREEN. В actual RED они не достигнуты, поэтому прежний
native MCP/restart/revocation PASS не является новым доказательством. Production/general-source
acceptance, oversized/raw-error attribution и actual SDK wire proof остаются открыты.

## Metadata и закреплённые реализации

Alloy 1.21 использует contrib OTTL 0.162. Первичные источники:

- [Alloy transform](https://github.com/grafana/alloy/blob/v1.21.0/docs/sources/reference/components/otelcol/otelcol.processor.transform.md),
  [Alloy dependency versions](https://github.com/grafana/alloy/blob/v1.21.0/go.mod).
- [Span paths/setters](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/v0.162.0/pkg/ottl/contexts/internal/ctxspan/span.go),
  [typed slice setter](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/v0.162.0/pkg/ottl/contexts/internal/ctxutil/slice.go).
- [VictoriaMetrics 1.154 decoder](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/v1.154.0/lib/protoparser/opentelemetry/pb/pb.go),
  [VictoriaLogs 1.53 decoder](https://github.com/VictoriaMetrics/VictoriaLogs/blob/v1.53.0/app/vlinsert/opentelemetry/pb.go),
  [VictoriaTraces 0.12 decoder](https://github.com/VictoriaMetrics/VictoriaTraces/blob/v0.12.0/app/vtinsert/opentelemetry/pb.go).

Эти три protobuf ingestion decoder выбирают resource field 1 и scope field 2 и пропускают
resource/scope `schema_url` field 3 до persistence. Это свойство конкретных закреплённых хранилищ,
не универсальная очистка Alloy: на другой exporter/backend вывод не переносится. Scope name/version/
attributes сами сохраняются decoder и потому отдельно очищаются transform. Нужен runtime sentinel
corpus, включающий schema URLs, а не предположение, что их очистил collector.

Дополнительно изучен [pinned redaction processor](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/v0.162.0/processor/redactionprocessor/processor.go):
`processResourceSpan` обходит resource/scope/span/event attributes, но не links. Он не устраняет этот
gap и не добавлен в pipeline.

Для target-specific фильтра проверены точные реализации: VT0.12
[GetCommonParams](https://github.com/VictoriaMetrics/VictoriaTraces/blob/v0.12.0/app/vtinsert/insertutil/common_params.go)
передаёт `VT-Ignore-Fields` в LogRows; pinned
[httputil.GetArray](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/d4a40004ef28/lib/httputil/array.go)
разделяет header по запятой. Embedded VictoriaLogs
[c945d2949e98](https://github.com/VictoriaMetrics/VictoriaLogs/blob/c945d2949e98/lib/logstorage/log_rows.go)
поддерживает prefix `*` и пропускает совпавшие fields до копирования в stored row.
[Alloy HTTP client](https://github.com/grafana/alloy/blob/v1.21.0/internal/component/otelcol/config_http.go)
передаёт статическую headers map в exporter. Header/filter runtime proof остаётся обязательным;
положительные offline примеры не подменяют повтор того же JSON/protobuf storage corpus.

## Collector diagnostics

Alloy и VictoriaTraces используют Docker logging driver `none`, чтобы raw diagnostics не сохранялись
в Docker logs. У VT0.12 проверка слишком большого числа fields вызывает raw warning до ignore filter;
[index queue failure](https://github.com/VictoriaMetrics/VictoriaTraces/blob/v0.12.0/app/vtinsert/insertutil/trace_processor.go)
тоже может вывести исходные fields. Поэтому одного header недостаточно. Это явная потеря сырых
diagnostics, а не их полноценная очистка или сбор. Остальные services сохраняют прежние ограниченные
logging settings. До первого unsafe OTLP, включая исходный accessible-field corpus, supervisor worker
проверяет фактический owned/running контейнер `traces` и строгое равенство
`HostConfig.LogConfig.Type=none`. До и после bounded inspection проверяется frozen endpoint/socket/daemon.
Недоступный inspect, потеря ownership или любой другой driver прекращают ingest.
`trace-store-logging.json` сохраняет только фиксированные outcome/ownership/driver verdicts;
container IDs, labels, пути и raw inspect не публикуются. Новая execution condition требует
фактического подтверждения на том же source, а не только unit PASS.

Вместо raw VT logs подготовлен ограниченный self-scrape `platform-trace-store`: `up`,
`vt_http_requests_total`, `vt_http_errors_total`, `vt_rows_ingested_total`, `vt_rows_dropped_total`
и `vt_traceid_index_push_error_total`. Разрешены только фиксированные protobuf insert path/type,
reasons `debug`/`too_many_fields` и labels `job`, `instance`, `path`, `format`, `type`, `reason`.
Alloy → VT использует protobuf независимо от JSON/protobuf входа в Alloy.
[HTTP handler](https://github.com/VictoriaMetrics/VictoriaTraces/blob/v0.12.0/app/vtinsert/opentelemetry/otlphttp.go)
регистрирует request/error counters; `common_params.go` регистрирует drop counters.
`vt_rows_ingested_total` считает входные попытки, включая отвергнутые строки, не сохранённые rows.
Index error counter создаётся лениво: отсутствие в `trace-store-health.json` обозначается `unknown`,
не нулём. Missing обязательной серии, stale sample или нечисловое значение не дают PASS.
Проверяется `up=1`, возраст scrape не более двух интервалов по 5 секунд, положительные
request/attempt counters и отсутствие зарегистрированных error/drop событий в этом smoke.
`trace-store-health.json` содержит только закрытые числовые поля и ограниченный verdict.
Это доступность конкретных counters, не полная приёмка здоровья VT. Oversized loss attribution,
counter reset и все error paths ещё не проверены; перед oversized input нужно отдельно подтвердить
фактический owned VT `LogConfig.Type=none` и измерить attributable drop delta без raw logs.

Взамен подготовлен self-scrape: фиксированные `up`, accepted/refused/sent/send_failed/queue counters,
закрытые component labels и фиксированные job/instance. Публичный smoke требует точного `up=1` и
положительного accepted-spans counter. Pinned Alloy создаёт OTel component ID через
`NewIDWithName(factory.Type(), opts.ID)`: закрытые receiver/exporter allowlists учитывают
`otlp/otelcol.receiver.otlp.pilot` и три `otlp_http/otelcol.exporter.otlphttp.{metrics,logs,traces}`.
[Receiver source](https://github.com/grafana/alloy/blob/v1.21.0/internal/component/otelcol/receiver/receiver.go#L139-L140)
и [exporter source](https://github.com/grafana/alloy/blob/v1.21.0/internal/component/otelcol/exporter/exporter.go#L169-L170)
закреплены тем же release. Upstream [factory metadata](https://github.com/open-telemetry/opentelemetry-collector/blob/v0.162.0/exporter/otlphttpexporter/metadata.yaml)
задаёт type `otlp_http`, хотя Alloy component называется `otlphttp`; полные exporter IDs
подтверждены source и actual counters в Mac core `525f71d1`. Smoke требует
отдельный положительный sent counter для каждого из трёх точных exporter IDs и signal family,
прежде чем записать `safe_collector_export_counters` как passed. На actual `4da87e1d` receiver counter имел положительное значение,
но прежний relabel-фильтр отвергал полный typed ID. Поэтому `up` и данные smoke проходили,
а обязательный accepted-spans counter отсутствовал в storage. Добавлены только эти фиксированные
component IDs; произвольные labels по-прежнему не разрешены. Predicate продолжает требовать
реальный конечный положительный счётчик, а не подстроку или пустой ответ.
Для queue metrics сохраняется только закрытый `data_type` из `traces`, `metrics`, `logs`:
[upstream queue source](https://github.com/open-telemetry/opentelemetry-collector/blob/v0.162.0/exporter/exporterhelper/internal/queue/obs_queue.go#L40-L50)
использует exporter ID и signal как совместный ключ. Без signal девять очередей трёх
component instances сливались бы в три серии после labelkeep. Это сохранение идентичности,
а не доказательство поведения очередей при outage или полноты drop counters. Refused/exporter-error coverage и корректность всех drop
counters под отказами этим не подтверждаются; missing counter не объявляется нулём или здоровьем.

## Проверка и доказательства

```bash
python3 scripts/observability-pilot/privacy_config.py --check
bash scripts/heavy-check.sh node --test scripts/observability-pilot.test.mjs
pnpm docs:check
```

Generator связывает фактический Alloy config с закрытым каталогом. Unit contracts ловят bypass,
устаревшую генерацию, ложный health verdict, сохранённый sentinel и неподдерживаемые links. Они
не исполняют OTTL. Отдельно выполнен `validate` закреплённого Alloy в собственном no-network,
read-only, non-root контейнере с 512MiB/0.25 CPU/64 pids; контейнер удалён. Это проверка синтаксиса,
не runtime sanitizer proof. `validate` не инициализировал OTTL: actual запуск исходного
`fe89f406` завершился exit 1 из-за недопустимого `\.` внутри строк OTTL для
`service.version` и имён span. Запись `[.]` сохраняет тот же literal-dot regex без
недопустимого строкового escape. Детерминированный contract проверяет quoted literals и
положительные/отрицательные значения; он не подменяет настоящий запуск.

На подготовленном исправлении отдельно выполнен bounded actual RUN закреплённого Alloy:
исходный config дал exit 1, исправленный вернул readiness 200. Это историческое доказательство
устранения ошибки инициализации, не текущая самостоятельная команда проверки. Временный
Docker helper удалён: его in-process cleanup не обеспечивал удаление daemon-контейнера при
SIGKILL вызывающего процесса (COLFIX-ST01). Собственные контейнеры после проверки удалены.

Настоящая проверка actual RUN, ingest и очистки перед storage выполняется существующим
публичным supervisor из [основного runbook](observability-pilot.md). Он сохраняет внешнее
владение процессами и cleanup. Новый lifecycle runner не вводится. `validate` и обычные
unit contracts этого runtime proof не заменяют; raw startup diagnostics не становятся
новым каналом сбора ошибок или payload. Исторический startup/health GREEN не доказывает
очистку перед storage, protobuf wire path или ошибки exporter.

После independent review координатор выполнил публичный supervisor на `525f71d1` с прежними
admission, identity, floor/growth и cleanup. Синтетический corpus помещает фиксированный sentinel в resource,
scope, schema URLs, status/events, unknown attributes, log body, metric metadata/exemplars и проверяет
его отсутствие в bounded storage/API/MCP responses. Положительная проверка сохраняет link IDs.
`collector-privacy.json` содержит только фиксированные verdicts и явные gaps, без raw ответов.

[Actual Mac core evidence](https://github.com/sachkov-inside/platform/issues/1566#issuecomment-6276818970)
для source `525f71d14283e116888f3e1b55ba4df31a8c53eb`, tree
`377f71db8825e6ceade7e623c6749d98b0c77a38`: worker exit 0, monitor не отказал,
diagnostics/down/residue PASS, собственных containers/volumes/networks осталось 0.
Config SHA256 `b4ac658837c8615a847396444d3528abb4896b841fcad45614c5e793cae66233`;
curated proof SHA256 `421c611b4a1632b6931358aaecd1bafd8b67aef57ff46445485fce60c0dabae1`.
Проверены accessible-field sentinels, сохранение SDK-shaped link IDs, `up`, receiver и все три
точных typed exporter counters, restart, read-only/revocation и три native Victoria MCP с
изолированными CPU records. Raw collector diagnostics отброшены, а не очищены и собраны.

Это ограниченный synthetic core PASS, а не общий PASS source `525f71d1`: отдельный fresh-carrier
PostgreSQL case остановился по 240-секундному сроку и остаётся открытым. Не доказаны произвольные links,
реальный SDK wire path, protobuf sentinel corpus, stdout/browser/Telegram coverage, все collector
error paths, полная кардинальность/ресурсный запас и production rollout с семью сутками наблюдений.
