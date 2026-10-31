# Обзор состояния и сравнение выпусков

Этот срез #1566 под спецификацией #1565 сравнивает сохранённые HTTP-наблюдения
`platform-api` или `platform-mcp` и показывает свежесть двух pilot-источников,
Alloy и VictoriaTraces. Это не полный обзор production. Отсутствие ошибок не доказывает
исправность сервиса. История может содержать пропуски, даже когда сбор сейчас работает.

## Доступ и discovery

Используйте уже принадлежащий задаче pilot и существующий ограниченный stdio caller.
Подготовка, закреплённые binaries, настройка datasources и отзыв временного ключа описаны
в [pilot runbook](observability-pilot.md). Здесь не запускаются Docker, новый MCP server
или production-процессы. Grafana доступна только через существующий loopback
`http://127.0.0.1:13000`, anonymous Viewer. Это тестовый доступ, не production auth.

Для закреплённого `mcp-victoriametrics` v1.20.2 конфигурация stdio имеет вид:

```text
MCP_SERVER_MODE=stdio
VM_INSTANCE_TYPE=single
VM_INSTANCE_ENTRYPOINT=http://127.0.0.1:18427/metrics
VM_INSTANCE_BEARER_TOKEN=<private read key supplied through existing secret configuration>
```

Не переносите ключ в Git, URL, команду, dashboard или публичный отчёт. Для logs/traces
используются уже настроенные native MCP и соответствующие разрешённые query routes.
Не обращайтесь напрямую к storage ports и не заменяйте MCP произвольным HTTP-клиентом.

В существующей сессии выполните `initialize`, затем `tools/list`. Проверьте наличие `query`
и его аргументов `query`, `time`, `timeout`, `nocache`, `trace`. Discovery не даёт права
вызывать mutations, admin, ingest или менять dashboards. Не используйте cloud/tenant
параметры в single-node pilot. Несовместимая схема означает `unknown`.

Caller должен уже обеспечивать 15 секунд на RPC и предел ответа 1 MiB. Это ограничения
существующего harness, не гарантии самого vendor MCP: его HTTP reader не имеет такого
предела. Если текущий caller не обеспечивает эти границы и немедленную фиксацию времени
завершения, этот рецепт не поддерживается. Не устанавливайте новый adapter и не
подменяйте отсутствующее время предполагаемым. Верните ограничение источника.

## Сначала ограниченный aggregate

Чистый интерфейс `scripts/observability-pilot/owner_overview.py` формирует план и принимает
результаты. Он не читает credentials, не выполняет запросы, не создаёт процессы и не
читает часы. Единственный каталог и политика качества находятся в
`infra/observability/pilot/owner-overview.json`.

Передайте `plan(request)` объект ровно с полями:

```json
{
  "service": "platform-api",
  "environment": "production",
  "before_sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "after_sha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "before_start": "2026-10-21T08:00:00Z",
  "before_end": "2026-10-21T09:00:00Z",
  "after_start": "2026-10-21T09:00:00Z",
  "after_end": "2026-10-21T10:00:00Z",
  "evaluated_at": "2026-10-21T10:00:00Z"
}
```

SHA выше являются примерами входа, не историей настоящих выпусков. Подставьте два
различных полных lowercase SHA из авторитетных release records. Сохраните источник этих
records. Не угадывайте время deploy по первой точке метрики. Окна равной длины от 60 секунд
до часа, не пересекаются и заканчиваются не позже evaluation. Входные timestamps имеют
целые UTC секунды и `Z`. Для показа в Москве используйте UTC+03:00, не меняя окна хранения.

Выполните ровно 10 data queries по порядку плана: `B.volume`, `B.speed`, `B.load`, `B.quality`,
затем те же четыре для `A`, затем `freshness.values` и `freshness.timestamps`.
Каждый элемент содержит готовые аргументы native `query`, включая `timeout: "2s"`,
`nocache: true`, `trace: false` и явный evaluation timestamp. Не меняйте выражения,
не добавляйте retries, широкое discovery рядов или скрытый одиннадцатый запрос.
Initialize/discovery считаются отдельно. Это последовательный сбор, не атомарный snapshot
и не обещание ответа всей серии за 10 секунд. Фактическое время каждого native запроса,
включая MCP, ещё требует проверки относительно критерия спецификации.

Существующий caller сразу после завершения каждого RPC, до следующего запроса, сохраняет
свои фактические UTC часы в отдельной оболочке. Ответ native MCP остаётся неизменным:

```text
{id: <fixed plan ID>, state: "received", response: <unchanged native response>,
 completed_at: <actual caller UTC completion with Z>}
```

При недоступности или прерывании последняя оболочка имеет `state: "unavailable"` либо
`"interrupted"`, `response: null`, фактическое время или `null`, если его нет. Пропущенный
хвост не заполняется. `reduce(prepared_plan, envelopes)` принимает только упорядоченный
префикс. Не заменяйте `completed_at` временем evaluation, timestamp метрики или временем
запуска reducer. Проверка не может обнаружить правдоподобную ложь caller о своих часах;
происхождение времени подтверждается самим caller и последующим native evidence.

## Как читать результат

Запросы считают native aggregate: estimates прироста счётчиков и скорости, p50/p95/p99
по сохранённым buckets, sample mean/max active requests. Reducer не вычисляет заново
PromQL или quantiles. Дробный прирост счётчика остаётся оценкой. Это не точное количество
всех запросов production. Sampling и drops traces не служат коэффициентом HTTP-счётчиков.

Единая политика в каталоге применяется и к native speed queries dashboard, и к reducer.
Объём менее 100 duration observations, нехватка samples относительно настроенного
5-секундного SDK export, reset, ошибки экспорта/приёма, отсутствующее качество или
устаревший текущий сбор подавляют quantiles и долю 5xx. Они становятся `null`/`NoData`,
не нулём. Counter samples у новой серии могут не пройти консервативный порог.

Число и точная длина исторических пропусков неизвестны. `historical_gap_count: null`,
`historical_coverage: partial`, `request_completeness: unknown` сохраняются даже после
прохождения остальных условий. Отсутствующий ряд не означает ноль ошибок. Возраст
источника считается по его sample timestamp и фактическому завершению пары freshness
queries. При stale/partial/unknown прямо укажите ограничение и какие источники не покрыты.
Сравнение релизов не устанавливает причину изменения: нагрузка, состав запросов и
неполнота истории могут различаться. Отчёт содержит `causality: not_established`.

Ответ не экспортирует исходные строки/выражения/labels, credentials, private IDs,
SQL или тексты исключений. Не публикуйте массив native payloads как evidence. Сохраняйте
закрытую проекцию, query IDs, окна, source SHA, фактические исходы и ссылки на dashboard.
Один ответ ограничен 1 MiB; HTTP bundle содержит максимум 16 rows, freshness максимум
1000 rows. Суммарный вход ограничен 10 MiB, отчёт 128 KiB. Это client admission,
не доказательство дешёвого storage scan. Превышение не обрезается до «полного» результата.

## Проверка по источникам

Provisioned Grafana overview использует существующий `pilot-metrics`. Сравнение в dashboard
имеет более узкий режим двух соседних часовых окон; произвольные допустимые UTC окна
задаются в native recipe. Measurement instant и ограничение покрытия видны в dashboard.
Точное исполнение масок, variable encoding, времён, панели и визуальная приёмка закреплённой
Grafana остаются незавершёнными проверками внутри #1566. Source tests их не заменяют.

При отдельном расследовании после aggregate берите только ограниченные примеры logs,
затем конкретную связанную trace через existing native Jaeger tools. Сначала ограничьте
UTC окно и разрешённый service; не сканируйте год raw logs. Не делайте эти примеры скрытой
частью 10-query comparison. Учитывайте retention из
[pilot runbook](observability-pilot.md), sampling, продолжение и ограничения ответа.
Исчерпание страницы не равно отсутствию следующих данных при наличии continuation.

Другие факты остаются у своих владельцев:

- [Существующий Watchdog](production-monitoring.md) проверяет доступность, ресурсы,
  очереди и бизнес-сигналы. Его прежний сигнал не становится свежим измерением dashboard.
- [Caddy source](observability-caddy-pilot.md) и PostgreSQL source в
  [pilot runbook](observability-pilot.md) имеют отдельные контракты и evidence.
- Platform MCP reports, включая sales-funnel и оплату/выдачу доступа, используют
  существующую проверку `platform:admin`. HTTP errors не заменяют бизнес-факт.
- [Umami](observability-umami-pilot.md) читается отдельным существующим read-only key.
  Browser observations не прибавляются к серверным доменным фактам.

Отзыв diagnostic key означает недоступность чтения соответствующим агентом. Не выдавайте
последний успешный отчёт за текущее состояние и не запрашивайте новые права как обход.
Production rollout, server expansion и новые subscriptions этот срез не выполняет.
