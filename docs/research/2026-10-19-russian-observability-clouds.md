# Российские облачные варианты наблюдаемости Platform

Проверено 19.10.2026. Статус: исследование публичных предложений, не разрешение на подключение,
покупку или передачу данных. В кабинеты не входили, с поставщиками не связывались, production не меняли.
Базовое выбранное направление: [самостоятельный стек](2026-10-19-platform-observability-stack.md).

## Результат

Российское облако может уменьшить расходы на собственные хранилища и их обслуживание, но по
найденным документам **готовая эквивалентная замена всему выбранному стеку пока не подтверждена**.
Yandex Monium ближе остальных по трём техническим сигналам; его невысокая цена при малом потоке
интересна. Однако 4 дня всех traces вместо 14 и неподтверждённый публичный trace-query API для
агентов: существенные разрывы. Timeweb monitoring: полезное дополнение, но CPU-графики и uptime
не заменяют логи приложения, SQL/outbound spans и расследование ошибок.

Поэтому считать self-host выбранным направлением, а Monium: кандидатом проверки отдельных
слоёв после уточнения retention и доступа агентов. Не менять архитектуру только по цене ingestion.
Назвать самый дешёвый полный вариант сейчас нельзя: текущий тариф Timeweb и фактический поток
Platform не измерены, а облачные варианты отличаются покрытием и сроками хранения.

## Что сравнивается

Нужны logs/traces 14 дней, metrics 90 дней, аналитика год, приём с нынешнего сервера Timeweb,
read-only программные запросы обычных агентов. Product analytics и авторитетные факты оплаты/прав
остаются отдельными: ни один рассмотренный инфраструктурный монитор сам не заменяет Umami и
модульные отчёты Platform.

| Вариант | Приём внешней инфраструктуры | Покрытие и retention | Доступ агентов |
|---|---|---|---|
| Yandex Monium | Да, OTel/агенты для любой инфраструктуры | Metrics/logs/traces; logs 31d, все spans 4d; 90d metrics требует проверки resolution/TTL | Metrics API/Prometheus документированы; LogReading gRPC найден; публичный fulltrace search/get и официальный MCP не подтверждены |
| Timeweb Cloud | Собственные VPS и managed resources | Resource metrics/alerts, отдельные uptime probes; полный managed application logs/traces не найден | Официальный инфраструктурный MCP есть; полного application diagnostics им не доказано |
| Selectel Logs | Приём через Fluent Bit/Vector документирован | Логи, default 30d, срок изменяемый; полный metrics+traces контур не подтверждён | AWS CLI/SDK documented; специализированный read-only MCP не найден |
| Cloud.ru Evolution | On-prem/custom metrics и logs через API | Metrics default30d, logs3d; увеличение log retention через support; полная tracing замена не доказана | Prometheus-like metrics API и logs API; full diagnostic MCP не найден |

«Не найден» обозначает результат исследования документации, а не доказательство отсутствия
закрытой функции. До сравнения по цене полного контура такой пробел нельзя считать закрытым.

## Yandex Monium: возможности, ограничения и счёт

Monium принимает телеметрию из любой инфраструктуры; OTel позволяет сохранить instrumented apps
на Timeweb. Это не требует переноса основного приложения в Yandex Cloud.
[Описание платформы](https://yandex.cloud/ru/docs/monium/),
[OTLP traces](https://yandex.cloud/ru/docs/monium/traces/).

Retention отличается от нашей договорённости. [Logs TTL](https://yandex.cloud/ru/docs/monium/logs/concepts/ttl)
равен 31 дню. [Лимиты traces](https://yandex.cloud/ru/docs/monium/concepts/limits) задают 4 дня для
всех spans. Автоархив открытого trace не означает хранения всего потока 14 дней. Для metrics
[удаление устаревших рядов](https://yandex.cloud/ru/docs/monium/concepts/ttl) зависит от прекращения
поступления данных и типа ряда; это не обещание независимого «90d raw samples» для любого pipeline.
Перед переносом проверить ещё прореживание/разрешение данных на всём периоде.

### Сценарий стоимости

Расчёт на 30 дней: 1 GB/day logs + 1 GB/day traces, 1000 постоянных временных рядов, точка каждые
60 секунд. Это **синтетический сценарий**, не текущая нагрузка. GB здесь: единица billable input
поставщика; локальный compressed volume не является той же величиной.

[Тариф Monium](https://yandex.cloud/ru/docs/monium/pricing), 16.10.2026: рубли с НДС;
logs/traces: 4,40 ₽/GB записи, минимум 1 MB. Чтение logs/traces и Prometheus Remote Read бесплатно.
Native metrics write пример: 0,32 ₽/million values; Remote Write rate отдельно не подтверждён.

| Поток | Расчёт за 30 дней | ₽ |
|---|---|---:|
| Logs | 30 GB × 4,40 | 132 |
| Traces | 30 GB × 4,40 | 132 |
| Оба | 60 GB × 4,40 | **264** |

Native 1000 series/min = 43,2 million values/month, условно 13,824 ₽; не переносить этот тариф на
Remote Write. Это ingestion estimate, не цена эквивалентного стека. Хранение/retention, query API,
поддержка нужного pipeline и фактический счёт ещё не проверены. Alerts исключены по согласованному
объёму. Гарантированная free quota/minimum fee не установлена; trial credits не учитывались.

### Можно ли расследовать через API

Metrics API и Prometheus read позволяют получить числа программно. В общем справочнике также
есть [LogReading.Read gRPC](https://yandex.cloud/ru/docs/monium/api-ref/grpc/LogReading/read) с
filter/page token; документ называет протокол Cloud Logging. Его применимость к выбранному пути
Monium ingestion и всем нужным log queries надо проверить, а не считать автоматической.
[Trace query language](https://yandex.cloud/en/docs/monium/traces/operations/query-language)
описывает поиск в интерфейсе. Стабильный публичный endpoint search spans/get full trace и
официальный MCP для этих данных в просмотренных источниках не найдены.

[IAM Monium](https://yandex.cloud/ru/docs/monium/security/) позволяет отделять чтение от изменений,
но наличие роли не доказывает существование нужного API. Для принятия облачного варианта агент
должен без UI найти slow/error trace, прочитать spans/attributes и связанный log, сравнить release,
получить completeness/freshness. Записывающий OTLP key не выдаётся агентам как диагностический.

## Timeweb Cloud: что действительно заменяет

Timeweb: текущий провайдер приложения, но это не означает, что существующий кабинет бесплатно
хранит всю прикладную телеметрию. Подтверждены resource alerts, отдельные проверки доступности
и Prometheus exporters managed Kubernetes; последний продукт не относится автоматически к VPS
с Docker Compose. [Monitoring](https://timeweb.cloud/docs/monitoring),
[бесплатные resource alerts](https://timeweb.cloud/docs/monitoring/alerts),
[Kubernetes exporters](https://timeweb.cloud/docs/k8s/manage-cluster/prometheus-exporter).

Uptime стоит 30 ₽/месяц за сервис. Пример пяти checks: 150 ₽/месяц; это цена probes, не logs/traces
storage и не посетителей сайта. Resource alerts имеют другую функцию и бесплатны.
В рамках текущей задачи новые notifications пока отложены, поэтому платный uptime не включается
в обязательную стоимость выбранного self-host стека.

[Статистика VPS](https://timeweb.cloud/docs/cloud-servers/manage-servers/resource-stats) документирует
CPU/network за сутки; RAM/disk требуют Zabbix agent, занятость диска обновляется раз в час.
Это не обещание 90 дней метрик. [Официальный SDK](https://github.com/timeweb-cloud/sdk-javascript/blob/master/docs/ServersApi.md#getServerStatisticsNew)
имеет statistics API, но сама сигнатура не доказывает глубину истории.

[Официальный Timeweb MCP](https://github.com/timeweb-cloud/mcp) действительно есть: он управляет
облачной инфраструктурой и наследует права token. Путь search→definition→execute не означает, что
все tools только читают. [IAM](https://timeweb.cloud/docs/iam/osobennosti-nastrojki-dostupov) и
[token settings](https://timeweb.cloud/docs/account-management/token) дают режим просмотра;
нужно отдельно скрыть пароли/чувствительные данные. Наличие конкретного statistics tool и scopes
в действующем кабинете не проверялось. Полноценные traces/log queries отсутствием или наличием
инфраструктурного MCP не доказываются.

### Цена увеличения VPS

Сравнивать нужно **дельту текущего тарифа**, а не цену нового VPS целиком: основной сервер уже
оплачивается и нужен приложению независимо от мониторинга. Достоверная дельта требует текущего
региона, CPU line, RAM, disk, срока оплаты, скидок и доступного upgrade пути. В кабинет не входили;
эта сумма пока неизвестна.

На [публичной странице Timeweb](https://timeweb.cloud/services/cloud-servers) цены зависят от
состояния конфигуратора. Проверенные способы получения страницы дали несогласованные значения
карточек и скидок; воспроизводимую сопоставимую пару тарифов не установили. Численную дельту
увеличения VPS поэтому не фиксируем. Маркетинговое «от» и скидка на новый заказ не заменяют
предложение об изменении существующего тарифа в кабинете владельца.

## Selectel: бесплатные логи как частичная альтернатива

[Сервис Logs](https://docs.selectel.ru/logs/about/about-logs/) сейчас бесплатен; поставщик обещает
предупредить о введении оплаты. Default retention 30 дней можно изменить. Документированы
загрузка через Fluent Bit/Vector и чтение AWS CLI/SDK. Это может убрать своё хранилище журналов,
но не доказывает стоимость полного metrics+traces решения для Timeweb. Ограничения произвольной
внешней загрузки/объёма и query-only credential нужно проверить до пилота. Бесплатность этого
продукта не равна бесплатной эквивалентной observability platform.

Отдельные [audit logs](https://selectel.ru/services/audit-logs/) фиксируют действия с ресурсами
провайдера; они не являются HTTP errors/SQL spans нашего приложения. Не подменять ими требуемый
каталог событий. Внешняя сеть Timeweb→Selectel, collectors и поддержание интеграции остаются затратами.

## Cloud.ru: разделять Evolution и Advanced

[Cloud Monitoring](https://cloud.ru/products/cloud-monitoring) принимает custom/on-prem metrics,
даёт Prometheus-like API; публичный default retention 30 дней. [Cloud Logging](https://cloud.ru/products/cloud-logging)
принимает внешние application logs через API/Fluent Bit, объявлен бесплатным; default 3 дня,
увеличение: через запрос в поддержку. Архив S3 не означает интерактивные logs queries на 14 дней.
Гарантированные бесплатные объёмы ingestion/query/storage и цена требуемого retention для нашего
сценария не установлены, поэтому «0 ₽ за весь контур» не вычисляется.

[Advanced APM](https://cloud.ru/products/advanced-application-performance-management): отдельное
предложение другой платформы. Нельзя собрать его название с Evolution metrics/logs и обещать единый
поддержанный OTLP/MCP контур для Node/Next/Telegram без проверки совместимости и тарифов.
Cloud Trace Service в документах провайдера: аудит действий с облаком, а не автоматически
распределённые spans приложения.

## Как определить, что дешевле именно для Platform

Сравнивать одинаковые возможности и сроки, затем считать:

`self-host delta = доплата Timeweb за нужный CPU/RAM/disk + эксплуатация`

`managed delta = billable input/read/storage/alerts + остаточные collector/Umami ресурсы + интеграция`

Первое может оказаться близким к нулю, если измеренный self-host помещается в уже оплаченный сервер.
Второе может выиграть при малом input, но только после устранения функциональных разрывов.
Umami/основной PostgreSQL/SDK/доменные MCP остаются общими и не должны исчезать из одной стороны расчёта.

Для решения нужны измеренные input/day, series cardinality/scrape interval, agent query volume,
нужный raw resolution через 90 дней и точная Timeweb upgrade delta. Когда эти величины известны:

1. Отсеять варианты без 14d traces и программного read-only расследования.
2. Посчитать месячный steady-state счёт с НДС по одному 30-дневному сценарию и spike сценарию.
3. Сравнить с доплатой к существующему серверу, проверив запас приложения и обслуживание.
4. Сохранить выбранный self-host, если облако не даёт эквивалентного покрытия или экономия меньше
   стоимости новой интеграции. Для гибрида отдельно назвать сохранённые локальные хранилища.

Исследование не меняет согласованные сроки хранения, не подключает SaaS и не выдаёт credentials.
