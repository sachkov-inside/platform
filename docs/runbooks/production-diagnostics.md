# Диагностика Platform для агента

Статус на 19.10.2026: подготовлен код узких отчётов оплаты, выдачи прав и воронки для
[#1566](https://github.com/sachkov-inside/platform/issues/1566) /
[#1565](https://github.com/sachkov-inside/platform/issues/1565). Эта инструкция описывает
подготовленный интерфейс, а не подтверждённый rollout в production. Полный контур наблюдаемости,
Victoria MCP и Umami ещё не подтверждены этой поставкой.
[Технический пилот](observability-pilot.md) имеет отдельные ограничения и проверки;
[журналы backend](backend-logs.md) сохраняют существующий интерфейс.

## Подключение и доступ

Используйте существующий Platform MCP по Streamable HTTP. Настройка endpoint,
protected-resource metadata и делегированного bearer token описана в
[процедуре MCP](local-development.md#mcp-authoring). Секреты в эту инструкцию не записываются.
Клиент вызывает `tools/list` и проверяет наличие `payment_access_diagnostics` и
`sales_funnel_diagnostics`.
Отсутствие инструмента означает, что доступный сервер не предоставляет подготовленный интерфейс;
оно не доказывает отсутствие оплат или проблем.

Оба диагностических отчёта проверяют текущее право `platform:admin` делегированного Account
внутри своего модуля.
Одного `billing:manage` или `materials:manage` недостаточно. Нового права нет;
существующие владельческие команды Billing сохраняют `billing:manage`.
Отчёт не вызывает платёжного провайдера и не меняет платежи, права или очередь.
Сам endpoint `/mcp` содержит и другие инструменты, включая изменяющие состояние;
данная инструкция не делает весь Platform MCP доступом только для чтения.

Ответ отчёта оплат содержит закрытые сведения: `accountId`, `purchaseRef`, время подтверждения оплаты,
сумму подтверждённых возвратов в копейках, состав и сроки оплаченных прав.
Это диагностика администратора, а не публичная аналитика. Не публикуйте ответ в открытых
журналах или панелях. Контакты покупателя, платёжные URL, provider payload и credentials
этот инструмент в ответ не включает.

## Запрос оплаты и выдачи прав

Пример аргументов `tools/call` для календарного дня 19 октября в Москве:

```json
{
  "name": "payment_access_diagnostics",
  "arguments": {
    "from": "2026-10-18T21:00:00Z",
    "to": "2026-10-19T21:00:00Z",
    "limit": 20
  }
}
```

Время хранится и возвращается в UTC. Окно `[from,to)` включает начало и исключает конец;
московский календарный день начинается в 21:00 UTC предыдущего дня. Положительное окно
ограничено 31 сутками, страница — 1–50 оплатами, по умолчанию 20.
Отчёт выбирает подтверждённые оплаты по `confirmedAt`; открытие страницы, checkout и HTTP 200
подтверждением оплаты не являются. Поле `counts.scope=returned_page` означает счётчики
только возвращённой страницы. Это не итог за весь период и не distinct число покупателей.

При непустом `nextCursor` повторите запрос с теми же `from` и `to`, добавив `cursor`
ровно из ответа. Cursor нельзя собирать или изменять вручную. Порядок — по уникальному
`purchaseRef` по возрастанию; одинаковое время оплаты порядок не нарушает.
`nextCursor=null` означает конец текущего обхода источника. Обход живой (`live_source`):
оплаты и права могут изменяться между страницами. Billing и AccountRights читаются независимо,
без общей атомарной исторической копии. `observedAt` обозначает время начала чтения отчёта,
а не доказательство свежести всей системы. Не представляйте сумму страниц как согласованный
снимок всех бизнес-состояний.

## Как читать результат

Для каждого обещанного benefit Billing ищет точное основание `paid` этой покупки через
владельца AccountRights. `granted` означает наличие основания с нужной capability;
это не решение о действующем сейчас доступе. Смотрите `startsAt`, `validUntil` и состояние
`revoked` отдельно. Оплаченный период мог законно закончиться или быть отозван.
`refundedKopecks` показывает подтверждённые возвраты отдельно и не подменяет состояние права.

`missing` означает отсутствие точного оплаченного основания. Нулевые подтверждённые возвраты
вместе с подтверждённой оплатой и `missing` дают проверяемый пример для расследования выдачи.
Это не доказательство отсутствия любого доступа: ручное основание или другая покупка независимы.
Возврат, отзыв и истечение срока сами по себе не объявляются неисправностью. Отчёт не чинит
выдачу и не определяет отставание очереди; эти факты требуют отдельной диагностики владельца.

`coverage=paginated` требует продолжения. `coverage=partial`, `facts=unknown` или grant
`unknown` означают неполное знание. При неизвестных строках `missingPaidGrant=null`, а не 0;
поле `unknown` считает такие оплаты на странице. Ошибка AccountRights показана как
`sources.accountRights=unavailable`; `not_queried` означает, что ключей для чтения прав не было.
Ошибка чтения Billing возвращает `dependency_unavailable`, отказ в праве — `forbidden`.
Ни один из этих исходов не означает «проблем нет». Пустая успешно прочитанная страница без
продолжения означает отсутствие подходящих подтверждённых оплат в данном текущем обходе окна.

Форма запроса и результата принадлежит
[Billing PaymentDiagnostics](../../apps/backend/src/modules/billing/features/read-payment-diagnostics/payment-diagnostics.ts),
регистрация инструмента — [MCP adapter](../../apps/backend/src/modules/billing/features/read-payment-diagnostics/register-payment-diagnostics-tool.ts).
Проверки настоящего PostgreSQL и полного процесса остаются обязательными до принятия поставки.


## Воронка продаж

Подготовленный `sales_funnel_diagnostics` использует то же определение когорты, что и
владельческий отчёт SalesFunnel (#816/#818). Контакт входит по первому входу в бота в
`[from,to)`. Account без известного входа в бота входит по первому шагу выбранного Product;
последующие достигнутые шаги этой когорты учитываются к моменту чтения. Повторные входы не
создают вторую когорту, подтверждённая оплата не выводится из checkout или просмотра.
Респонденты анкеты считаются отдельно по личным ссылкам, без связи username с Account.

Требуется `platform:admin`; существующий REST-отчёт сохраняет `billing:manage`.
Клиент не передаёт actor или permission. Инструмент не пишет события, не управляет оплатами
или ссылками и не вызывает Telegram/банк.

```json
{
  "name": "sales_funnel_diagnostics",
  "arguments": {
    "from": "2026-10-18T21:00:00Z",
    "to": "2026-10-19T21:00:00Z",
    "productId": "10000000-0000-4000-8000-000000000001",
    "limit": 20
  }
}
```

Замените пример `productId` настоящим Product; без него Platform-шаги и покупки респондентов
не измеряются и остаются `null`. `chapterId` необязателен; по умолчанию выбирается первая глава.
Время — UTC, календарный пояс — Europe/Moscow, окно — не более 31 суток.
Запрашиваемый `limit` — 1–50 строк источников, по умолчанию 20. Фактически страница содержит
от 0 до `limit` строк. В отличие от отчёта оплат,
`totalScope=bounded_cohort`: `total` относится ко всей вычисленной когорте, а не странице.
Не складывайте повторяющийся `total` разных страниц. При продолжении передавайте неизменённый
`nextCursor` и те же границы, Product и главу; `nextCursor=null` завершает текущий обход.

Чтения ограничены релевантными кандидатами, а не размером целой исторической таблицы.
SalesFunnel выбирает контакты с **первым** входом в окне. Для Product владельцы ReadingActivity
и Billing сначала возвращают Accounts с первым соответствующим шагом в окне. Их объединение
с Accounts bot-когорты ограничено 2000 уникальными Accounts. Затем владельцы возвращают полные
первые даты и достигнутые шаги этих кандидатов за всю историю; текущий Telegram owner выдаёт
необходимые текущие identities. SalesFunnel дочитывает полные первые входы, первое согласие и
последнюю сообщённую связь только релевантных контактов. Запомненный Account связи сохраняет приоритет;
связь без Account разрешается по текущему verified owner, неоднозначность не превращается в связь.
Более ранний вход другого контакта того же Account исключает его из текущей bot-когорты.
Первый Product-шаг до окна также исключает Account без bot-входа из `outside_bot`.
Более поздние шаги вошедшей когорты считаются достигнутыми, даже если лежат после конца окна.

Каждая карта первых фактов и полная выборка релевантных контактов ограничены 2000 результатами:
SQL возвращает максимум 2001, переполнение даёт `source_budget_exceeded` с `coverage=unknown`,
без усечённых или нулевых итогов. Независимые источники не читают чужие схемы. Каталог по-прежнему
содержит все current Products (существующий предел 200), а его composition prerequisites
ограничены 2000 строками каждого вида **для этих Products**; архив и посторонние Materials
не заполняют этот бюджет. Сохраняется контракт ReadingActivity: не более 1000 Material IDs.
Фильтры Product/material/account/identity и последние receipts поддержаны индексами владельцев.
Это ограничение результата и времени вычисления, не утверждение «прочитано максимум 2000
физических строк PostgreSQL»: aggregate может обработать больше строк через отфильтрованный индекс.

`surveyRespondents` имеет собственную семантику #818 и не является bot-когортой:
`uploaded`/`issued` — полные глобальные scalar counts владельца основания, `paid` — distinct
респонденты с подтверждённой оплатой выбранного Product по личной ссылке в окне платежа.
Исторические основания/оплаты не отсекаются row cap; нельзя складывать эти числа с bot sources
или трактовать их как список связанных Accounts. Значение `null` сохраняет отсутствие основания
или неизмеряемую покупку без выбранного Product. Source rows и `total` относятся ко всей
вычисленной entry cohort, не только видимой странице; source counts не включают исторические
контакты, дочитанные лишь для исключения/атрибуции Account.

Каждое bounded owner-чтение использует RepeatableRead; statement ограничен 2 секундами,
транзакция — 5 секундами, ожидание соединения — 1 секундой. Candidate discovery и последующее
чтение полных фактов — отдельные owner snapshots. Ошибка/таймаут возвращает
`dependency_unavailable` и неизвестное покрытие. Большая релевантная cohort или медленный aggregate
по-прежнему могут дать отказ; полезность всех production workloads не предполагается по
одному успешному fixture.

Индексы поставляются append-only migrations 0100–0104: Product coverage JSON GIN, current
catalog, Material first facts, journal account/identity/receipt и verified Telegram identity.
Production здесь не меняется. Обычный `CREATE INDEX` может блокировать записи на время построения;
стоимость, запас места и допустимое окно требуют отдельной проверки при порученном deployment.
Fixture с тысячами строк не измеряет этот production lock.

После применения 0100–0104 прежний application image запускать нельзя: его короткая migration
registry отвергает новый ledger как не являющийся exact prefix, поэтому readiness/worker startup
не пройдут. Нужен отдельный **rollback build** от принятого нового source: откатить диагностическую
реализацию вместе с соответствующим public tool description, сохранив полную новую registry,
все ранее зарегистрированные migration files и их байтовые checksums.

Для отката именно candidate implementation commit `bcb6a0723` на отдельной ветке шаблон такой
(значения в угловых скобках заменяются проверенными SHA принятой поставки):

```bash
git switch -c rollback/funnel-diagnostics <accepted-release-sha>
git revert --no-commit bcb6a0723
git restore --source bcb6a0723^ -- \
  apps/backend/src/modules/sales-funnel/features/read-funnel-diagnostics/register-funnel-diagnostics-tool.ts
git restore --source <accepted-release-sha> -- \
  apps/backend/src/migrations/index.ts \
  apps/backend/src/modules/sales-funnel/infrastructure/postgres/migrations/0100-funnel-diagnostic-candidates.ts \
  apps/backend/src/modules/billing/infrastructure/postgres/migrations/0101-billing-funnel-diagnostic-sources.ts \
  apps/backend/src/modules/reading-activity/infrastructure/postgres/migrations/0102-reading-funnel-diagnostic-sources.ts \
  apps/backend/src/modules/telegram-membership/infrastructure/postgres/migrations/0103-telegram-funnel-diagnostic-identities.ts \
  apps/backend/src/modules/materials/infrastructure/postgres/migrations/0104-funnel-diagnostic-current-products.ts \
  apps/backend/test/integration/migrations.test.ts
```

При конфликтах требуется review собранного результата; более поздние изменения других features
этот шаблон не разрешает удалять. Public description должен соответствовать возвращённой реализации,
а не оставаться описанием новых scoped candidates. Сохранение migration tests предотвращает возврат
старого ожидаемого ledger. Проверка
[funnel-diagnostics-rollback.test.ts](../../apps/backend/test/unit/funnel-diagnostics-rollback.test.ts)
исполняет настоящий `assertAppliedMigrations`: ledger с checksums индексов, закреплёнными от reviewed `bd524e53`, отвергается прежней registry,
принимается полностью сохранённой новой и снова отвергается при изменении SQL/checksum.

Это проверка совместимости registry, не испытание production rollback. До публикации rollback build
нужны обычные build/checks/review и exact-source CI; migration verification/readiness должны видеть
ту же полную registry принятой БД. Развёртывание поручается отдельно. Ledger, доменные данные и
добавочные индексы сохраняются; автоматическое удаление ledger rows или `DROP INDEX` не является
частью отката. Уже зарегистрированные файлы и checksums не переписываются.

Между владельцами нет общей атомарной копии: `independent_owner_snapshots`, обход живой.
Каждый запрос продолжения заново читает ограниченные источники и не удерживает транзакцию
между запросами. Входящие события и текущие связи могут изменить когорту и итоги между страницами.
`coverage=complete` означает полноту вычисления по прочитанным ограниченным источникам,
а не исправность или свежесть доставки событий. `freshness.status=not_proven` сохраняется
и после успешного чтения; последний receipt не доказывает отсутствие отставших событий.
Без receipt bot-шаги остаются `null` и покрытие частичное. Не трактуйте старый receipt,
неизвестное покрытие или отказ источника как «событий/ошибок нет».

Ответ включает агрегаты по ограниченным кодам источников, названия Product/глав и время
последнего receipt; он предназначен администратору. Сырые контакты бота, Telegram identity,
Account ID и username респондентов в этот отчёт не входят.
Регистрация и форма результата принадлежат
[SalesFunnel diagnostics](../../apps/backend/src/modules/sales-funnel/features/read-funnel-diagnostics/read-funnel-diagnostics.ts);
определения когорты остаются в
[общем отчёте](../../apps/backend/src/modules/sales-funnel/features/read-funnel-report/read-funnel-report.ts).

### Операционные очереди pg-boss

`operational_queue_diagnostics` в Platform MCP требует актуального `platform:admin` делегированного
Account. Вход — строго `{}`: нельзя передать другой Account, имя очереди, SQL, payload или увеличить
бюджеты. Проверка права выполняется перед чтением очередей, в том числе после отзыва права.
Отчёт читает только инфраструктурные `pgboss.version`, `pgboss.queue`, `pgboss.job` через
[owner interface](../../apps/backend/src/infrastructure/pg-boss-queue-diagnostics.ts).
Девять известных имён имеют один
[contract с workers](../../apps/backend/src/infrastructure/job-queues.ts); новые очереди автоматически
не добавляются. Query-путь не вызывает `PgBoss.start`, не создаёт schema/queue/jobs, не выполняет
retry/cancel/purge, не читает `data`, `output` или provider payload и не возвращает сырые job ID.

Один `RepeatableRead READ ONLY`-снимок имеет UTC `asOf`, проверяет точную schema version установленного
pg-boss и агрегирует сохранённые задания. Бюджеты: statement 2 s, transaction 5 s, ожидание соединения
1 s. Объём ответа ограничен девятью очередями и шестью известными states; история не обрезается до
произвольного числа jobs. Агрегация может сканировать всю сохранённую историю выбранных очередей;
при превышении бюджета или недоступности источника ответ — `coverage: unknown` и
`source_unavailable`, при несовместимой версии — `schema_mismatch`. Это не нулевые счётчики.
Отсутствующая очередь имеет `status: unknown / queue_not_registered`, существующая пустая — нули и
`oldestBacklogAgeSeconds: null`.

`states` считает сохранённые `created`, `retry`, `active`, `completed`, `cancelled`, `failed`.
`backlog` — `created + retry`, включая отложенные и blocked задания; `ready` — не blocked с
`start_after <= asOf`, `scheduled` — не blocked с будущим `start_after`, `blocked` — ожидающие
зависимости jobs этих двух states. Возраст старейшего backlog считается от `created_on`, включая
scheduled/blocked. `retrying` — незавершённые `created/retry/active` с `retry_count > 0`;
`retainedRetryAttempts` суммирует `retry_count` всех сохранённых states. После удаления истории эти
значения не являются пожизненными totals. Повторная попытка задания не равна повторному внешнему
платежу. `failed` не доказывает денежную ошибку, а `completed` — успешный внешний эффект.

`workerFreshness: not_proven` и `lastSuccessfulWorkAt: null` остаются даже после успешного запроса:
текущего durable owner-факта, подтверждающего последнее успешное выполнение/доставку, здесь нет.
Отчёт не заменяет worker liveness, readiness или source freshness. RabbitMQ, доменные outbox и
email delivery в этом bounded этапе ещё не покрыты; их отсутствие в отчёте не означает отсутствие
backlog или ошибок. Настройки сбора, entitlement/business semantics и production-конфигурация этим
инструментом не меняются.
