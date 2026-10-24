# Наблюдаемость Platform: предложение стека

Дата: 19.10.2026. Статус: **исследование; направление и технические рекомендации приняты владельцем
19.10.2026**. Это не ADR, спецификация, эксплуатационный контракт или разрешение на установку.
Production не опрашивался и не менялся.
Рекомендации ниже отделены от существующего кода и исторических измерений.
Согласованные требования поставки вынесены в [спецификацию v1](../specifications/platform-observability-v1.md);
это исследование сохраняет обоснования и не заменяет её приёмку.

## Принятое направление

Владелец выбрал предложенный ниже стек и технические рекомендации, включая предварительную
проверку ресурсов и полноты агентской диагностики. Знакомство с продуктом не является главным
критерием: приоритетны нагрузка полного контура и доступ обычных агентов разработки к данным.
SigNoz сохраняется как запасной вариант по указанным ниже условиям. Исследование российских
облачных альтернатив [сохранено отдельно](2026-10-19-russian-observability-clouds.md)
и само по себе не меняет принятое направление.
Аккаунты, платные услуги, изменение тарифа и установка в эту фиксацию не входят.

Первым проверить **Grafana OSS + VictoriaMetrics single-node + VictoriaLogs single-node +
VictoriaTraces single-node + Alloy + vmauth**, с **Umami v3.4.0**, существующим watchdog и узкими Platform MCP
отчётами. Это конкретный **первый кандидат ресурсного пилота**, не доказанный победитель по RAM/CPU
и не окончательный выбор для production. Второй кандидат: **SigNoz Community + штатный Collector +
ClickHouse/Keeper/metadata store** на том же корпусе и в том же бюджете.

Victoria-контур выбран первым потому, что каждый backend штатно работает с локальным data directory
без дополнительных storage services, а официальные read-only MCP всех трёх signals дают агентский
доступ без зависимости от экспериментальной совместимости TraceQL. Отдельные процессы и MCP не
делают его хуже agent-first. Но штатная локальная архитектура **не доказывает меньший расход**;
полное сравнение и критерий выбора приведены ниже. Знакомство с Grafana и единый интерфейс SigNoz :
вторичные удобства, а не основание обещать эффективность.

Нужные самостоятельные функции не требуют Cloud/Enterprise оплаты: Victoria family: Apache 2.0,
Grafana OSS: AGPL, Alloy: Apache 2.0, Umami: MIT; enterprise дополнения не входят в состав.
[VictoriaMetrics](https://docs.victoriametrics.com/victoriametrics/index.html),
[VictoriaLogs](https://github.com/VictoriaMetrics/VictoriaLogs),
[VictoriaTraces](https://github.com/VictoriaMetrics/VictoriaTraces),
[Grafana](https://github.com/grafana/grafana), [Alloy](https://github.com/grafana/alloy),
[Umami](https://github.com/umami-software/umami).

Технический UI: Grafana, native MCP запускаются на Mac обычного агента; Umami отвечает за
посещаемость. Platform остаётся источником истины о деньгах/правах/обучении. Наличие MCP не создаёт
отсутствующие события. Новые автономные реакции и доставка сигналов не входят в предложение.

Если VictoriaTraces не обеспечивает нужную диагностику native API, корреляции или надёжность,
переходить к SigNoz, не пытаться назвать неполный TraceQL равной заменой. Если оба проходят gates,
решение принимается по измерению полного контура и успешности агентских задач, не по названию продукта.

## Установленные в обсуждении границы

- Весь production: сайт Membership, API, MCP, Telegram, базы, очереди, фоновые задачи,
  платежи и доставка доступа, внешние зависимости, ошибки браузера и посещаемость.
- Самостоятельное размещение без обязательной оплаты зарубежному поставщику.
- Мониторинг работает на **том же production-сервере**. Одновременная потеря приложения и
  мониторинга при отказе хоста принята; второй сервер сейчас не оплачивается.
- Журналы и трассы: 14 дней; метрики: 90 дней; аналитические события: один год.
- Диагностика доступна обычным агентам разработки. Автоматические реакции владелец организует отдельно.
- Новые оповещения и доставка в Telegram отложены. Существующие проверки не выключаются этим исследованием.

Такая топология не доказывает внешнюю доступность при полном отказе VPS. Локальный probe измеряет
доступность из своей сети. Существующие GitHub проверки остаются внешним, но нерегулярным свидетельством.

## Что уже есть

| Область | Факт репозитория | Что сохранить и дополнить |
|---|---|---|
| Production | [Compose](../../compose.production.yaml): API, MCP, Next web, несколько workers и RabbitMQ; PostgreSQL, Logto и Telegram имеют отдельные процессы | Наблюдать каждый процесс, а не только HTTP главной |
| Отказы | [Watchdog](../runbooks/production-monitoring.md): минутный systemd timer, контейнеры/OOM, память/диск, бэкапы, оплаты/outbox/задачи/Telegram | Сохранить бизнес-проверки; публиковать состояния и свежесть в метрики |
| Внешние проверки | [Production monitor](../../.github/workflows/production-monitor.yml), [access pass](../../.github/workflows/production-access.yml) | Не обещать гарантированный интервал GitHub schedule |
| Web telemetry | [Runbook](../runbooks/web-telemetry.md): LCP/INP/CLS, render/server errors, PostgreSQL, retention 30 дней, admin MCP `web_telemetry_summary` | Не удалять и не менять retention молча; отдельно спланировать переход к общим 14/90 дням |
| Backend logs | [Observability](../../apps/backend/src/infrastructure/observability/): JSON, process/requestId/route/status/duration, очищенные ошибки | Добавить trace/span/release context и централизованный поиск |
| Jobs | [process-log.ts](../../apps/backend/src/infrastructure/observability/process-log.ts): очередь и ID задания, `job_failed`, process/queue failures | Добавить продолжительность, очередь ожидания, retries, результат и trace context |
| Telegram | [runtime-metrics.ts](../../apps/telegram/src/operations/runtime-metrics.ts): Prometheus counters/gauges activation/community/reconciliation/backlog | Собирать историю и отличать reset счётчика от восстановления |
| Продажи | [sales-funnel](../../apps/backend/src/modules/sales-funnel/): bot entry/consent/link, первая глава, checkout, подтверждённая оплата | Переиспользовать определения; предоставить агенту отдельное ограниченное чтение |

Обзор прошлых вариантов и историческое чтение production :
[исследование #1289 от 13 октября](issue-1289-monitoring-options.md). Тогда: 2 CPU, 3910 MiB RAM,
около 1,4 GiB доступной памяти, корневой диск 48 GiB занят на 77%. Это **не текущий замер**.
Там же отмечены отсутствие настроенных каналов сторожа и многочасовые промежутки внешних проверок.

В исходниках не найден общий OpenTelemetry pipeline или сквозная трассировка web → API → queue →
worker → внешняя зависимость. Существующие `requestId` и digest полезны, но распределённые traces не заменяют.

## Состав и поток данных первого кандидата

| Компонент | Роль и настройка первого пилота |
|---|---|
| Alloy | OTLP от SDK, scrape Prometheus, host/container metrics, очищенные JSON logs; bounded buffering |
| VictoriaMetrics single | Метрики, `-retentionPeriod=90d`, Prometheus-compatible queries |
| VictoriaLogs single | Application/system logs, retention 14 дней, LogsQL |
| VictoriaTraces single | Самостоятельное spans storage, retention 14 дней, native Jaeger query API |
| Grafana OSS | Панели и Explore: Prometheus/VictoriaLogs/Jaeger datasources, provisioned correlations |
| vmauth | Отдельный query-only auth proxy с allowlist routes и per-user concurrency; TLS через существующий Caddy |
| Три native Victoria MCP | Queries и discovery metrics/logs/traces; stdio на Mac, read-only API через private boundary |
| Umami v3.4.0 | Analytics, отдельные database/role существующего PostgreSQL, годовая проверенная очистка |
| Watchdog и Platform MCP | Business states, свежесть проверок и авторитетные отчёты |

Кандидаты версий для explicit lock: Grafana `13.2.4`, Alloy `1.21.0`, VictoriaMetrics `1.154.0`,
VictoriaLogs `1.53.0`, VictoriaTraces `0.12.0`. Это найденные опубликованные releases, **не проверенная
совместимость комплекта**; Alloy 1.21.0 опубликован в день исследования. До пилота проверить release
notes/совместимость, закрепить images по digest, не использовать latest.
[Grafana](https://github.com/grafana/grafana/releases/tag/v13.2.4),
[Alloy](https://github.com/grafana/alloy/releases/tag/v1.21.0),
[metrics](https://github.com/VictoriaMetrics/VictoriaMetrics/releases/tag/v1.154.0),
[logs](https://github.com/VictoriaMetrics/VictoriaLogs/releases/tag/v1.53.0),
[traces](https://github.com/VictoriaMetrics/VictoriaTraces/releases/tag/v0.12.0).

Использовать receivers/exporters Alloy для host/PostgreSQL/RabbitMQ, где они поддержаны;
не добавлять контейнер на каждую метрику. Collector не создаёт spans внутри приложения: нужен SDK.
Три хранилища имеют собственные limits/query budgets/volumes. Дневные partitions и merges требуют
запаса диска; disk-based retention не должен незаметно сокращать согласованные 14 дней.
Метрики хранятся 90 дней, а не «три календарных месяца».

Для SigNoz fallback закреплённый OSS v0.146.0 подтверждает независимые retention по signals:
[Retention UI](https://github.com/SigNoz/signoz/blob/v0.146.0/frontend/src/container/GeneralSettings/Retention.tsx),
[TTL types](https://github.com/SigNoz/signoz/blob/v0.146.0/pkg/types/retentiontypes/ttl.go),
[ClickHouse reader](https://github.com/SigNoz/signoz/blob/v0.146.0/pkg/query-service/app/clickhouseReader/reader.go).
Точные logs/traces=14d, metrics=90d надо установить и прочитать обратно в пилоте; изменение действует
на новые данные. API gate и compatibility backend/MCP проверяются отдельно.

Конфигурация/dashboards: декларативно в Git без секретов. Полный backup технической истории на первом
этапе не предлагается: потеря VPS может удалить её. Analytics включается в проверяемую цепочку
PostgreSQL backup/restore; это отдельная ответственность от заменяемых logs/traces.

## Что именно измерять

| Поверхность | Первый полезный набор |
|---|---|
| Хост и контейнеры | CPU, available/RSS memory, OOM/restarts, диск/IO/inodes, сеть, CPU throttling и состояние healthcheck |
| HTTP web/API/MCP | число запросов, 4xx/5xx, rate и доля ошибок, p50/p95/p99 latency по route template, active requests |
| Next/browser | LCP/INP/CLS, browser render/unhandled errors, server render failures; digest и release для группировки |
| PostgreSQL | подключения, locks/deadlocks, slow-query duration, pool wait, ошибки; SQL без параметров и персональных значений |
| RabbitMQ/pg-boss | backlog/oldest age, processing duration, retries/failures, heartbeat успешного завершения |
| Telegram | webhook delivery/processing, Bot API latency/errors, activation и community lag, reconciliation freshness |
| Бизнес | подтверждённая оплата без доступа; задержка fulfillment, email/outbox, возвраты/неопределённый исход |
| Внешние сервисы | latency/ошибки/timeouts/retries банка, Logto, Telegram relay/Bot API, Kinescope, Object Storage, email |
| Сам мониторинг | последний успешный scrape/export, refused/dropped samples/spans/logs, backlog экспортёра, TTL cleanup и query latency |

Внешние зависимости измеряются из процесса, который их вызывает. Отдельная синтетическая проверка
может дополнить это, но успешный HTTP 200 не доказывает оплату или выданный доступ.
Проверки готовности и сроков выполняются даже без включённой доставки уведомлений.
Внутренние spans банка, Kinescope и Logto не обещаются: видим собственный вызов до границы
зависимости, пока другая сторона не поддерживает продолжение trace. Группы ошибок и digest сохраняются;
поиск в интерфейсе мониторинга не означает полноценную замену Sentry с назначением ответственных и issue workflow.

Метки метрик ограничить service/environment/release/route/method/status/dependency/queue.
Account ID, purchase ID, trace ID, полный URL и SQL не использовать как labels временных рядов.
Идентификатор отдельной операции хранить в очищенном журнале/span, где он нужен для диагностики.

## Инструментирование и связь сигналов

Backend и Telegram используют ESM, репозиторий закрепляет Node `26.10.0`, web: Next `16.3.8`,
backend Prisma `7.10.0` с `@prisma/adapter-pg`; см. [.node-version](../../.node-version),
[backend package](../../apps/backend/package.json), [web package](../../apps/web/package.json),
[Telegram package](../../apps/telegram/package.json). Совместимость выбранных SDK, hooks ESM,
Fastify/Nest, Prisma driver и pg-boss **проверяется пилотом**, а не подразумевается по названию OTel.

Рекомендуется Node SDK для traces/metrics и сохранение существующего JSON logger для logs.
OpenTelemetry JS помечает traces/metrics stable, logs development, browser instrumentation experimental;
поэтому не делаем экспериментальный browser auto-instrumentation обязательным для запуска.
[Статус JS SDK](https://opentelemetry.io/docs/languages/js/).

Next подключает SDK через `instrumentation.ts`, только Node runtime;
`@vercel/otel` не требует хостинга Vercel. Проверить SSR, Server Actions, route handlers, streaming errors
и исходящие fetch, исключив двойные spans. [Next OTel](https://nextjs.org/docs/app/guides/open-telemetry).
Для browser ошибок и vitals сначала переиспользовать имеющиеся same-origin endpoints, лимиты и очистку.

Jobs получают parent/link context через собственный envelope метаданных: producer сохраняет W3C context,
consumer создаёт processing span, retry: отдельную попытку, исходная бизнес-операция сохраняет correlation.
Для RabbitMQ и pg-boss это проверяемое изменение адаптеров, не обещание автоинструментирования.
HTTP и SQL instrumentation должны давать внутреннее время зависимостей, а не только общий request duration.

Согласовать `service.name`, `service.version`, environment, route и release SHA для всех процессов;
добавить `trace_id`/`span_id` в журнал активного span. В пилоте доказать переход log→trace,
span→SQL/outbound operation, latency→примеры traces. Grafana Jaeger/VictoriaLogs correlations нужно
настроить и проверить на сохранённых данных; одна общая панель не создаёт их автоматически.
Метрики связывать по service/route/time; metric exemplars и полный TraceQL не обещаются до проверки.
Service graph и span-derived metrics включать в обоих кандидатах одинаково, иначе сравнение
потребления и возможностей будет неравным.

Для ограниченного пилота traces собирать полностью при низкой нагрузке с жёстким ограничением объёма;
если нужен sampling, явно показывать его долю и потери. Ошибки HTTP считать по полным counters/logs,
а не выводить их истинную частоту из выборки traces. Tail sampling ради «сохранить все ошибки» требует
буферов и отдельного замера; его нельзя бесплатно подразумевать в head sampling.

## Аналитика посещений и действий

Umami выбран отдельно от технического мониторинга: в бесплатном self-host есть traffic/events,
воронки, цели, пути и retention analysis, API/MCP. PostgreSQL поддержан установкой;
подтверждённый выпуск: [v3.4.0](https://github.com/umami-software/umami/releases/tag/v3.4.0).
[Установка](https://docs.umami.is/docs/install), [сравнение self-host/Cloud](https://docs.umami.is/docs/cloud).
Replay, heatmaps и запись DOM в начальный состав не входят.

Предлагаемый каталог первого этапа: посещение страницы Product; отрисованный разрешённый Material;
показ закрытого доступа; переход в checkout; начало обучения; ручная отметка изучения; закладка;
начало/завершение учебной сдачи; bot entry и подтверждённая связка. Для каждого события нужны
владелец, момент возникновения, event ID/дедупликация, объект и предел точности.
Это **предложение каталога**, не утверждение, что все события уже производятся.

Подтверждённая оплата, возврат и выдача права берутся из Billing/Account Rights; browser conversion
не становится бухгалтерским фактом. Существующая [sales-funnel](../../apps/backend/src/modules/sales-funnel/)
уже связывает Telegram entry/consent/link с открытием главы, checkout и оплатой. Её чтение через MCP
в текущем [tool surface](../../apps/backend/mcp/tool-surface.json) не найдено: нужна новая узкая read-only
операция в модуле-владельце, без доступа агентов к raw production SQL.

Идентификация: анонимный посетитель: приблизительная браузерная единица, не человек;
не обещать склейку устройств. Authenticated event может иметь отдельный непрозрачный pseudonym Account.
Telegram объединять только по подтверждённой identity link, не username/email/похожему имени.
Метки/URL очищать от query, токенов, почты и свободного текста. Выключить собственную telemetry и
внешние вызовы Umami через `DISABLE_TELEMETRY=1`, `PRIVATE_MODE=1`:
[переменные](https://docs.umami.is/docs/environment-variables).

Один год требует **проверенной процедуры удаления**: в просмотренной документации env нет готового
обещания TTL; [FAQ](https://docs.umami.is/docs/faq) указывает бессрочное хранение self-host.
На закреплённой схеме проверить поддерживаемую очистку, реализовать maintenance job
с ограниченными batches, контролем результата и восстановлением после прерывания; учесть events,
sessions и связанные таблицы. Выбрать отдельные database и role в существующем PostgreSQL cluster,
с connection/query limits: это не добавляет процесс и отдельную систему резервирования.
[Production foundation](../runbooks/production-foundation.md) описывает pgBackRest cluster backup;
в реализации явно проверить включение новой базы и isolated restore, а не подразумевать уже сделанную
проверку. Резервные копии не должны возвращать удалённое в обработку.

Имеется действующий договорный разрыв: [cookies v2](../legal/cookies-v2.md) обещает отсутствие счётчиков
и выбор перед необязательной аналитикой; [privacy v4](../legal/privacy-v4.md) описывает текущие цели,
а [старый контракт аналитики](../specifications/author-analytics-measurement-v1.md) остаётся proposed.
Перед включением нового сбора согласовать основание, поля и новую редакцию/пользовательский выбор.
Это требование согласовать внедрение с текущими документами, не юридическое заключение.

## Доступ обычных агентов

**Технические данные первого кандидата:** три официальных native MCP по stdio на Mac:
[metrics MCP](https://github.com/VictoriaMetrics/mcp-victoriametrics),
[logs MCP](https://github.com/VictoriaMetrics/mcp-victorialogs),
[traces MCP v1.5.0](https://github.com/VictoriaMetrics/mcp-victoriatraces/tree/v1.5.0).
Они предоставляют discovery и read-only queries. Нужны backend timeout, limits и отдельные credentials:
read-only hints не запрещают дорогие запросы и не защищают открытый admin endpoint.
Выбрать отдельный **vmauth** с allowlist query paths/methods и per-user concurrency; существующий
Caddy завершает TLS. Блокировать insert/delete/internal/admin. vmauth добавляет шестой постоянный
процесс первого кандидата: учитывать его CPU/RAM, не считать доступ бесплатным по ресурсам.
[Документация vmauth](https://docs.victoriametrics.com/victoriametrics/vmauth/).
[Victoria security](https://docs.victoriametrics.com/victoriatraces/#security).
Проверить отрицательные запросы напрямую тем же credential, а не только отсутствие mutation tools.

**SigNoz fallback:** официальный [SigNoz MCP v0.15.0](https://github.com/SigNoz/signoz-mcp-server/tree/v0.15.0)
с service-account viewer key. В OSS v0.146.0
[service-account module](https://github.com/SigNoz/signoz/blob/v0.146.0/pkg/modules/serviceaccount/implserviceaccount/module.go)
назначает существующую роль без license gate;
[authorization server](https://github.com/SigNoz/signoz/blob/v0.146.0/pkg/authz/openfgaserver/server.go)
проверяет PrincipalServiceAccount;
[middleware](https://github.com/SigNoz/signoz/blob/v0.146.0/pkg/http/middleware/authz.go) различает View/EditAccess;
[key authentication](https://github.com/SigNoz/signoz/blob/v0.146.0/pkg/identn/apikeyidentn/provider.go)
применяет service-account identity. Это вывод по исходникам, не runtime smoke.
Enterprise [self-service tutorial](https://signoz.io/docs/manage/administrator-guide/iam/user-guides/self-service-api-keys-for-viewers/)
про выпуск ключа самим viewer не доказывает платность нашего admin-issued viewer key.

Во всех вариантах отрицательно проверить mutation/retention/delete и raw SQL обходы; backend должен
отказать. SigNoz MCP содержит изменения и SQL-capable builder: фильтровать инструменты/запросы,
не выдавать admin key. Grafana alternative использует service account, `--disable-write` и отключённый
raw API passthrough. Закреплённый tool inventory, права и query budget обязательны в каждой сессии.

**Аналитика:** официальный Umami MCP читает доступные пользователю сайты/команды, traffic,
events и отчёты. Remote `/mcp` появляется с v3.4.0, включается `MCP_ENABLED=1` и API key;
есть отдельный `@umami/mcp` для stdio. Пагинация/временные окна обязательны для больших результатов.
Replay и heatmap не нужны. Проверить read-only разрешения и отказ доступа к чужому website на закреплённом
выпуске. [Umami MCP](https://docs.umami.is/docs/mcp).

**Бизнес-данные:** существующий Platform MCP и новые узкие отчёты по фактам владельцев модулей.
`platform:admin` сегодня нужен Web summary; не расширять автоматически это право до всех будущих
инструментов. Альтернатива для агрегатов: отдельные reporting views и PostgreSQL role только `SELECT`
на них, без личных строк; unrestricted SQL tool и superuser credential агентам не выдавать.

Один общий короткий runbook должен объяснять discovery, time zone UTC/Moscow, release, retention,
свежесть, пагинацию, sampling, ошибки доступа и неизвестные результаты. Он подключается обычным
development sessions; новый автономный «дежурный агент» для этого не требуется.

## Ресурсы, стоимость и защита приложения

Лицензии выбранного состава: $0. Это не нулевая стоимость: оплачиваются сервер/диск, эксплуатация,
обновления, резервирование конфигурации и собственное время. Точный рублёвый тариф без текущего
провайдера и измерения потока не установлен. Регистрация/оплата зарубежного Cloud не предполагается.

Числа из предыдущей предварительной оценки 16 GB RAM/200 GB SSD не были замером и не являются
требованием менять тариф. Общий размер хоста выбирается после измерения приложения и полного контура.
Обещать размещение всего на историческом 4 GB VPS также нельзя.

Начальный **экспериментальный бюджет телеметрии** на изолированном стенде: суммарно 4 GiB RAM/2 vCPU
для выбранного технического контура, включая нужный auth proxy; при непрохождении: повторить с
8 GiB, не выдавая это за автоматически разрешённое изменение production. Это потолки эксперимента,
не minima поставщиков и не обещание fit. Umami и существующий PostgreSQL: отдельная общая нагрузка,
её обязательно включить в итоговый host budget. MCP на Mac не входит в production RAM.

Приложение сохраняет приоритет. Нужны отдельные Compose project/networks/volumes, `mem_limit`, CPU
quota, `pids_limit`, log rotation и bounded ingestion/query. OOM/ENOSPC/неполные запросы означают
неуспешный пилот. Docker socket read-only mount не ограничивает Docker API: предпочесть ограниченный
proxy либо сбор нужных файлов/метрик без управляющего socket.

Диск считать от **измеренного** суточного прироста всех volumes:
`14 × logs/day + 14 × traces/day + 90 × metrics/day + 365 × analytics/day + indexes/WAL + запас`.
Это расчёт по каждому хранилищу, не предположение об универсальном коэффициенте сжатия.
Не переносить гигабайты raw входа напрямую на размер сжатых данных. Сохранять не менее 25% свободного
места и бюджет для compaction/TTL. Ограничить каждый volume/каталог так, чтобы мониторинг не заполнил
диск приложения. При превышении остановить необязательный ingestion с явным счётчиком потерь,
а не доводить основной PostgreSQL до ENOSPC.

## Повторное сравнение: ресурсы полного стека и доступ агентов

Повторная проверка меняет основание рекомендации: один продукт не означает три процесса и не
доказывает меньший расход ресурсов. Знакомство команды с Grafana/SigNoz также не является решающим
критерием. Ниже сравниваются три **полных** технических контура с одинаковыми logs/traces/metrics,
без сокращения задачи до CPU-графика. Umami, SDK, существующий watchdog и бизнес-отчёты нужны во всех
вариантах и учитываются отдельно. MCP можно запускать на Mac агента, не на production VPS.

### Архитектура и постоянные процессы

| Вариант | Постоянные процессы базового single-host контура | Уточнение |
|---|---|---|
| SigNoz default | SigNoz server, Collector/ingester, ClickHouse, ClickHouse Keeper, PostgreSQL: **5** | Плюс migrator и histogram helper как init jobs; MCP при размещении на VPS добавит процесс |
| Grafana + Prometheus + Loki + Tempo + Alloy | Grafana, Prometheus, Loki single-binary, Tempo monolithic, Alloy: **5** | Для сравнения local volumes, без Kafka/object-storage процесса; optional exporters/generator не считаются незаметно |
| Grafana + VictoriaMetrics + VictoriaLogs + VictoriaTraces + Alloy | Grafana, три single-node хранилища, Alloy: **5**, плюс выбранный vmauth = **6** | ClickHouse/Keeper/object storage не обязательны; auth/query proxy учтён отдельно |

SigNoz: проверен опубликованный [Foundry v0.3.0 generated Compose](https://github.com/SigNoz/foundry/blob/v0.3.0/docs/examples/docker/compose/pours/deployment/compose.yaml).
Он содержит перечисленные службы; это pinned **generator source**, но images SigNoz/Collector в
примере помечены `latest`. Это доказательство архитектуры default, **не полностью закреплённый и
проверенный runtime комплект для SigNoz v0.146.0**. Точный compatible lock нужен до пилота.
[Foundry reference](https://github.com/SigNoz/foundry/blob/v0.3.0/docs/reference/casting-file.md)
допускает embedded SQLite single-node вместо metadata PostgreSQL. Это может убрать один процесс,
но не измеряет экономию и не позволяет молча подменить default production рекомендацию.

[Тот же collector lock](https://github.com/SigNoz/foundry/blob/v0.3.0/docs/examples/docker/compose/casting.yaml.lock)
производит span-derived metrics и metadata/meter, использует большие batches; sending queue exporters
в этом примере отключена. Значит, его нельзя сравнивать с pass-through collector как с равной работой.
В пилоте нужны одинаковые метрики APM, политика sampling, retries и bounded buffering.

Grafana topology: [Loki modes](https://grafana.com/docs/loki/latest/get-started/deployment-modes/),
[Tempo monolithic без Kafka](https://grafana.com/docs/tempo/latest/configuration/),
[Alloy](https://github.com/grafana/alloy).
Loki/Tempo filesystem: компромисс локального размещения с ограничениями durability/cleanup,
а не доказательство невозможности установки: [Loki filesystem](https://grafana.com/docs/loki/latest/operations/storage/filesystem/).
Добавление S3 на том же VPS меняет расход и обслуживание, но не устраняет общий отказ хоста.

Victoria topology: [single-node metrics](https://docs.victoriametrics.com/victoriametrics/single-server-victoriametrics/),
[logs](https://docs.victoriametrics.com/victorialogs/),
[traces](https://docs.victoriametrics.com/victoriatraces/).
VictoriaTraces хранит spans сам, хотя его движок вырос из VictoriaLogs; запуск отдельного VictoriaLogs
нужен нашим application logs, а не как обязательная внутренняя база VictoriaTraces.

### Что известно о CPU, памяти и диске

**Сопоставимого измерения трёх полных стеков под нагрузкой Platform не найдено.** Точные значения
baseline/peak RAM, CPU, IOPS и суточного прироста для нашей установки неизвестны. Число процессов,
размер бинарника, min RAM из quickstart и рекламный коэффициент сжатия не заменяют такой замер.

В [vendor experiment VictoriaMetrics от 09.06.2025](https://victoriametrics.com/blog/dev-note-distributed-tracing-with-victorialogs/)
подавалось 10 000 spans/s; storage nodes имели 4 CPU/8 GiB. CPU: VictoriaLogs 0,50 core,
ClickHouse 0,69, Tempo 1,35; RAM: соответственно 1,15/1,12/4,26 GiB. Это **proof of concept до
standalone VictoriaTraces**, сравнение отдельных tracing backends, не полных стеков и не текущих
версий. Оно поддерживает гипотезу экономии относительно тогдашнего Tempo, но не вывод
«VictoriaTraces легче SigNoz»: ClickHouse в том эксперименте занимал примерно столько же RAM.
Коэффициенты 3,7× RAM/2,6× CPU из страницы продукта относятся к этому эксперименту, не к Platform.

[SigNoz logs benchmark](https://signoz.io/blog/logs-performance-benchmark/) тоже не даёт победителя
полного стека: сравнивается только logs pipeline с Loki/Promtail 2.6.1, разными достигнутыми throughput
55 000 против 21 000 logs/s на 16 CPU/32 GB VM. Его память 6 против 9,6 GB, CPU 40% против 15% и
диск 207,9 против 142,2 GB нельзя сравнивать без учёта разного потока, запросов и устаревших версий.
Дата обновления статьи не делает старые binaries новым benchmark. Это vendor measurement,
не независимая проверка и не доказательство экономичности SigNoz для всех трёх signals.

Официальные floors различаются по назначению: SigNoz Docker просит 4 GB Docker; Grafana: 512 MB/1 CPU
для оценки самого UI; современный Tempo Linux даёт starting point 4 CPU/4–8 GB для отдельной
monolithic evaluation. Они не образуют сравнительную таблицу production потребления.
[SigNoz install](https://signoz.io/docs/install/docker/),
[Grafana sizing](https://grafana.com/docs/grafana/latest/setup-grafana/installation/),
[Tempo sizing](https://grafana.com/docs/tempo/latest/set-up-for-tracing/setup-tempo/deploy/locally/linux/).
Большие clustered sizing tables нельзя переносить на наш малый VPS.

Различия, которые действительно влияют на стоимость:

- SigNoz/ClickHouse объединяет signals в одном движке, но logs/metrics/traces, агрегаты и внутренние
  журналы создают отдельные таблицы/parts. Merges, TTL и тяжёлые аналитические запросы конкурируют за CPU/IO.
- Prometheus держит head и WAL, затем compacted blocks; длинный retention требует места для старых
  и новых blocks при compaction. Документация предлагает 15–20% запаса сверх retention size.
  [Prometheus storage](https://prometheus.io/docs/prometheus/latest/storage/).
- Loki экономит индексирование произвольных полей, но широкий поиск по тексту и большим окнам может
  читать много chunks. TraceQL/Tempo queries тоже должны иметь ограниченные time window/concurrency.
- VictoriaLogs/VictoriaTraces индексируют поля и сохраняют локальные partitions: это удобный поиск,
  но индекс, merges и запросы всё равно стоят RAM/CPU/IO. Retention by disk space может удалить
  историю раньше 14 дней; такой случай должен быть явно показан как неполное покрытие.
  Disk retention VictoriaLogs/Traces не является hard quota: последние два дня сохраняются и могут
  превысить заданный порог. Для строгой защиты основного диска нужна отдельная filesystem quota/volume
  и проверяемая реакция на предел, а не надежда на удаление старых partitions.

Поэтому read-only agent credential не означает дешёвый запрос. Для любого стека: общий query timeout,
ограничение параллельных запросов/выборки, сначала короткая агрегация, затем ограниченные примеры,
пагинация и разделение холодных/тёплых cache runs. Не выдавать агенту unlimited годовой scan raw logs.

### Агентские интерфейсы и совместимость версий

| Контур | Подтверждённый путь для обычного агента | Реальные пределы |
|---|---|---|
| SigNoz | Официальный SigNoz MCP: discovery, metrics, log/trace queries и aggregations, trace detail, dashboards | Mutation tools и SQL-capable query builder требуют viewer backend gate и tool filtering; pinned server/backend совместимость проверяется |
| Grafana + Prometheus/Loki/Tempo | `mcp-grafana v2.0.2`: PromQL, LogQL, Tempo TraceQL/search/get; metadata/discovery и dashboard context | `--disable-write` плюс service account; запрет raw API и cost limits на backend. Наличие tool не доказывает bounded CPU |
| Grafana + Victoria family | Metrics через Prometheus datasource; logs/traces через официальные dedicated MCP; Grafana: общий UI | Это несколько серверов инструментов, но не техническая проблема agent-first. Нужно общее описание service/time/release и query budgets |

Ссылки закреплённых интерфейсов:
[Grafana MCP v2.0.2](https://github.com/grafana/mcp-grafana/tree/v2.0.2),
[SigNoz MCP v0.15.0](https://github.com/SigNoz/signoz-mcp-server/tree/v0.15.0),
[VictoriaTraces MCP v1.5.0](https://github.com/VictoriaMetrics/mcp-victoriatraces/tree/v1.5.0).
HEAD README может описывать больше, чем эти выпуски; конечный tool inventory проверяется по выбранному tag.
VictoriaTraces MCP предоставляет Jaeger-based service/operation/search/get/dependencies; это
полезная диагностика, но не тождество всем TraceQL/diff/aggregation tools Grafana MCP.

[VictoriaTraces v0.12.0](https://github.com/VictoriaMetrics/VictoriaTraces/releases/tag/v0.12.0)
опубликован 29.09.2026. Native Jaeger API интегрируется с Grafana.
[Querying guide v0.12.0](https://github.com/VictoriaMetrics/VictoriaTraces/blob/v0.12.0/docs/victoriatraces/querying/README.md)
также описывает **experimental** Tempo HTTP API/TraceQL с v0.9.4 и неполную совместимость.
Не обещать, что подключение к Tempo datasource автоматически даёт все Grafana MCP tools;
проверить каждый нужный query на закреплённом VT. До этого основной агентский путь: dedicated MCP.
Младший номер версии сам по себе не измеряет надёжность, но experimental compatibility: реальный риск.

Manifest не равен проверенному комплекту версий. Например,
[VT demo в v0.12.0](https://github.com/VictoriaMetrics/VictoriaTraces/blob/v0.12.0/deployment/docker/compose-vt-single.yml)
использует VT image v0.11.1 и содержит HotROD/alerts extras;
[Tempo example в v3.1.0](https://github.com/grafana/tempo/blob/v3.1.0/example/docker-compose/single-binary/docker-compose.yaml)
по умолчанию запускает Tempo image 3.0.0 и generators. Нельзя считать эти extras обязательными,
а checkout tag: гарантией совпадения всех image tags. Перед пилотом нужен собственный explicit lock.

### Как измерить полный контур, чтобы выбрать по фактам

В сравнении менять backend, сохраняя corpus, число services/routes, cardinality, scrape interval,
sampling и семантику APM. Включать или выключать spanmetrics/service graph одинаково; два разных
набора производных метрик не считаются одинаковым покрытием. Umami/основной PostgreSQL измерять
отдельной общей строкой, SDK overhead: на приложении, MCP CPU: на Mac агента и query CPU: на VPS.

| Измерение | Что записать |
|---|---|
| Режимы | idle; одинаковый steady ingest; spike; ingest одновременно с agent queries; restart/WAL replay; retention/merge |
| RAM | все production processes, peak/steady RSS и cgroup usage, page cache, swap/OOM; не сумму limits |
| CPU/диск | CPU seconds, throttling, read/write bytes/IOPS и merges/compaction при равном времени работы |
| Хранение | raw input bytes/day, фактический retained size всех volumes, indexes/WAL и временный запас cleanup |
| Запросы | те же error/latency/dependency/release queries, cold/warm latency, scanned bytes/series/spans, timeouts и размер ответа |
| Качество | одинаковые error counts/quantiles в допустимой семантике, completeness, lag/drops и trace/log correlation |

Первый отсев: функциональность и read-only права. Кандидат без нужного диагностического запроса
не становится победителем из-за низкого RAM. Среди прошедших преимущество считать существенным при устойчивой экономии **не менее 25%**
лимитирующего ресурса (RAM, CPU либо диск) без ухудшения других bottlenecks и качества данных.
При меньшей разнице выбирать по повторяемой успешности агентских расследований и обслуживанию;
привычность инструмента вторична. При размене RAM на CPU решает бюджет
того же VPS: ни один вариант не должен нарушать latency/диск/память приложения.
Для winner claim приложить versions/config/source SHA/raw measurements, а не пересказать минимумы.

### Другие варианты

Uptrace Community имеет core/MCP, но custom retention и RBAC платные; 90 дней метрик не закрываются
заявленной бесплатной редакцией: [editions](https://uptrace.dev/editions),
[MCP](https://uptrace.dev/product/mcp). Российский hosted Yandex Monium принимает metrics/logs/traces
из любой инфраструктуры, однако меняет самостоятельную модель и требует оплаты услуг:
[Monium](https://yandex.cloud/ru/docs/monium/), [цены](https://yandex.cloud/ru/docs/monium/pricing).
Kuma/Healthchecks закрывают uptime/heartbeat, а не полную диагностику. Официальное подтверждение
доступности регистрации Grafana Cloud для российского владельца не найдено; наша рекомендация
не зависит от этого Cloud.

## Порядок будущего внедрения и критерии результата

1. На изолированном стенде закрепить реальные выпуски/digests и совместимые конфигурации; измерить
   нынешнее приложение без мониторинга. Подготовить synthetic workload без реальных платежей/личных данных.
2. Проверить SDK на Node 26/ESM/Next/Prisma, SQL+outbound spans, jobs/RabbitMQ context, browser errors,
   Web telemetry compatibility; отладить очистку до ingestion.
3. Собрать полный предлагаемый стек с лимитами. Проверить обычную и пиковую нагрузку, рестарты,
   недоступное хранилище, тяжёлые запросы и TTL/compaction на корпусе заявленного срока хранения.
4. Подготовить панели, MCP config/runbook и ограниченные business-report tools; отрицательно проверить
   изменения dashboards/datasources/данных, чужую analytics team, отсутствие raw SQL доступа.
5. Согласовать privacy/cookies и семантику аналитики, обеспечить годовую очистку. Только затем включать
   новый analytics collection; техническая диагностика не должна ждать счётчика посетителей.
6. После отдельных проектных classification/review/release gates развернуть на том же VPS, проверить
   данные и ресурсы после выпуска; последующие 7 дней подтвердить фактический прирост и steady-state.

Пилот принят, когда обычный агент без браузерного прокликивания способен выполнить следующие запросы:

- «Какая route даёт 500 за последний час? Покажи частоту, три примера, связанный trace и ошибку зависимости».
- «Сравни p95/p99, долю ошибок и память до/после release SHA; укажи размер выборки и sampling».
- «Почему запрос медленный: SQL/pool/lock, исходящий HTTP или работа приложения? Покажи spans».
- «Какая очередь отстаёт, когда последний успешный job и есть ли paid без доступа?».
- «Сколько посещений и переходов Product→Material→checkout, а сколько подтверждённых оплат по Billing?».
- «Сборщик остановился или ошибок нет? Покажи последнее поступление и dropped/refused/export failures».
- «Данных до начала сбора или старше retention нет»: ответ сообщает границы покрытия, не возвращает
  выдуманный ноль; недоступность источника не называется восстановлением.

Численные стартовые критерии: **предлагаемые критерии пилота**, не измеренный результат:
добавленная p95 latency HTTP не более 5%, средний дополнительный CPU на штатной нагрузке не более
10% всего хоста; ingestion lag до 60 секунд в обычном режиме; bounded MCP запрос до 10 секунд;
нет OOM/ENOSPC; остаток памяти не менее 25%; запас диска и TTL доказаны измерением.
При нарушении сначала установить источник нагрузки/потерь, затем изменить настройки и повторить
этот сценарий. Переход к другому стеку определяется этими результатами, а не рекламным «лёгкий».

Исследование закончено предложением состава и проверяемым планом. Установка, новая бизнес-аналитика,
выдача credentials, миграция Web telemetry и изменения опубликованных документов ещё не выполнены.
