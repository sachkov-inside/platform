# Кандидат фильтрации технической телеметрии

Подготовленная часть [#1566](https://github.com/sachkov-inside/platform/issues/1566).
Production и default-OFF настройки SDK не меняются. Конфигурация предназначена для изолированного
синтетического пилота и композиции с нашим SDK, а не для произвольных OTLP источников.
Полная privacy/resource приёмка и фактический SDK → collector → storage запуск ещё не подтверждены.

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

## Links: обязательное ограничение кандидата

Links сохраняются для уже проверенной pg-boss batch correlation. Наш SDK `safePgBossSpan` создаёт
отдельный snapshot и удаляет link attributes и link tracestate до batch/export; эта часть контракта
описана в [SDK runbook](backend-technical-telemetry.md).

**Alloy candidate не очищает произвольную metadata внутри links.** В закреплённом OTTL доступен
только весь `SpanLinkSlice`; очистка всего slice сломала бы корреляцию. VictoriaTraces сохраняет link
tracestate и attributes. Поэтому произвольный OTLP источник способен сохранить секрет в link metadata.
Это известный unsupported gap, который запрещает production/general-source acceptance.

`require_supported_links` проверяет только собственный harness corpus. Его отрицательный тест
отвергает unsafe fixture; это не enforcement на collector endpoint и не успешная проверка очистки
такого входящего payload. Полная задача остаётся незавершённой, пока эта граница не решена и проверена.

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
gap и не добавлен в pipeline. Target-specific ingestion filtering требует отдельного подтверждения;
никакие неподтверждённые drop flags в candidate не включены.

## Collector diagnostics

Только Alloy использует Docker logging driver `none`, чтобы raw transform/receiver/exporter errors
не сохранялись в Docker logs. Это явная потеря сырых diagnostics, а не их полноценная очистка или
сбор. Остальные services сохраняют прежние ограниченные logging settings.

Взамен подготовлен self-scrape: фиксированные `up`, accepted/refused/sent/send_failed/queue counters,
закрытые component labels и фиксированные job/instance. Публичный smoke требует точного `up=1` и
положительного accepted-spans counter. Refused/exporter-error coverage и корректность всех drop
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
не runtime sanitizer proof.

После independent review координатор запускает прежний публичный supervisor с теми же admission,
identity, floor/growth и cleanup. Синтетический corpus помещает фиксированный sentinel в resource,
scope, schema URLs, status/events, unknown attributes, log body, metric metadata/exemplars и проверяет
его отсутствие в bounded storage/API/MCP responses. Положительная проверка сохраняет link IDs.
`collector-privacy.json` содержит только фиксированные verdicts и явные gaps, без raw ответов.

До такого запуска новый collector config не имеет runtime PASS. Не доказаны произвольные links,
реальный SDK wire path, protobuf sentinel corpus, stdout/browser/Telegram coverage, все collector
error paths, полная кардинальность/ресурсный запас и production rollout с семью сутками наблюдений.
