# Engineering review: inside-telegram (архитектура, качество кода, производительность, тесты)

> Историческое исследование на указанную в документе дату. Оно не задаёт текущие правила.
> Источник: [Workspace](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/2026-09-24-engineering-review/telegram.md); текущие правила — [документы Platform](../../../README.md).

Репозиторий: `/Users/dev/Work/Products/inside/repositories/telegram`, `main` @ `9a2a4e5`
(2026-09-24). Объём: `src` ≈ 21.9k строк TS (117 файлов), `test` + `scripts` ≈ 16.6k строк.
Режим: только чтение. `node_modules` в checkout нет, поэтому тесты, lint и typecheck не
запускались; выводы получены чтением кода, миграций, конфигурации и сравнением контрактов с
`repositories/platform`. Поведение `onApplicationShutdown` в NestJS сверено по исходнику
`@nestjs/core` 11.2.1 из `platform/node_modules`; в Nest 12 механизм тот же.

Файлов `CODING_STANDARDS.md` и `docs/adr/` в репозитории нет. Решения лежат в
`docs/decisions/seed-decisions.md`. Там прямо сказано, что worker mechanism, retry и scheduling
относятся к «applicable vertical ticket or later application ADR», но ни одного application ADR
так и не записали (см. L11).

Словарь: module, interface, depth, seam, adapter, leverage, locality, deletion test (из
`codebase-design`). Доменные термины взяты из `CONTEXT.md`: BotContact, PlatformLink,
MembershipEvidence, CommunityEffect, DispatchPermit, Notification Delivery.

---

## 1. Что сделано хорошо (сохранить)

- **Durable inbox для updates.** Webhook только кладёт update в `telegram_updates`: dedupe по
  `(bot_identity, update_id)`, секретные токены вырезаются до записи (`prepareTelegramUpdateForInbox`),
  payload обнуляется после обработки. Обработка идёт асинхронно, с lease и backoff.
- **Семантика «не больше одного раза» для внешних эффектов.** Везде записывается
  `started → call → settle`, а состояние `unknown` / `unknown_exhausted` честно фиксирует
  неопределённость вместо повторной отправки. Примеры: `notification-provider.ts:294-355`,
  `community-provider.ts:640-800`, `start-response-delivery-queue.ts`.
- **AMQP consumer делает ack только после commit в PostgreSQL** (`notification-broker.ts:70-94`).
  Idempotency по `operationId`. Poison-сообщения уходят в зашифрованный quarantine, а не в
  бесконечный redelivery. Публикация результатов идёт через transactional outbox
  (`notification_result_outbox`) с publisher confirms и `mandatory`. Runtime не объявляет topology.
- **Проверка config при старте.** Validation жёсткая: алфавиты секретов, запрет повторного
  использования секретов, TLS вне loopback.
- **Строгий `tsconfig`** (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`). В `src`
  нет `any` и `@ts-ignore`.
- **Discriminated unions на seam адаптеров:** `TelegramUpdateCommand`, `TelegramDeliveryResult`,
  `CommunityAdmission`, `ResultState`.
- **Integration-тесты поднимают настоящий `AppModule`** поверх реальных PostgreSQL и RabbitMQ
  (в CI тоже). Telegram и Platform подменяются fakes через `overrideProvider`, то есть по принципу
  «replace, don't layer». `vi.fn` встречается только в 6 файлах.
- **Вендоренные контракты communications, identity-linking и membership-evidence** байт-в-байт
  совпадают с копиями в Platform (проверено `cmp`).

---

## 2. Findings

Сводная таблица (подробности ниже):

| ID | Severity | Тема | Effort |
|---|---|---|---|
| H1 | High | FunnelScheduler: квадратичная работа и N+1 под глобальным lock, блокирует `/start` | M–L |
| H2 | High | Последовательная обработка updates: head-of-line blocking и HTTP внутри транзакций | M |
| H3 | High | Ошибки проглатываются без диагностики: 53 `catch {}`, константный `failure_code` | S–M |
| M1 | Medium | Graceful shutdown: воркеры гоняются с `database.destroy()` | S |
| M2 | Medium | Architecture guardrail слишком узкий, направление зависимостей нарушено | S |
| M3 | Medium | Reply outbox и PlatformLink без владельца: 8 и ~20 мест прямого доступа к таблицам | S–M |
| M4 | Medium | Механика durable queue скопирована 7+ раз, lease не ограждён fencing | M |
| M5 | Medium | Холостая нагрузка polling: ~150–200 SQL/с в простое, тик 40 мс | S–M |
| M6 | Medium | `/ready` пишет в таблицу evidence и ходит в Telegram на каждый вызов | S |
| M7 | Medium | Дрейф и дублирование вендоренных контрактов (community v1 против v2, notifications ×2) | S |
| M8 | Medium | Author admin как строковая state machine; persisted state без validation | M |
| M9 | Medium | Нетипизированные ajv validators, отсюда 7 cast'ов в controller | S |
| M10 | Medium | ESLint без type-aware правил; часть scripts вне typecheck | S |
| L1–L11 | Low | миграции, retention, индексы, Telegram adapters, имена, Clock, DI, tooling, `__pycache__`, Caddy, ADR | S |

### H1. FunnelScheduler: квадратичная работа и N+1 под глобальным advisory lock — High

**Evidence**

- `src/modules/communications/funnel-scheduler.ts:83-88`: весь `claim()` выполняется в
  транзакции под `communicationLock("communications-scheduler:{bot}")`.
- `:119` вызывает `reconcileFunnels(tx, bot, now)` **на каждый claim**. В
  `funnel-timeline.ts:66-178` эта функция обходит **все enrollments всех опубликованных воронок**.
  На каждый enrollment уходит 2 `select` из `communication_deliveries` плюс по одному `select` на
  step (`:77-95`, `:114-119`) и возможные `update`.
- В миграции `011-communication-funnels.ts:48-56` нет индекса на
  `communication_deliveries(contact_id, funnel_id)`, поэтому каждый per-enrollment запрос
  становится seq scan по всей таблице доставок. Итог: O(enrollments × deliveries) на один claim.
- `:130-157`: запрос кандидатов без `LIMIT` загружает все due-доставки с jsonb `parts` и
  `snapshot`. Дальше на каждого кандидата идут отдельные запросы: broadcast (`:165-170`), funnel
  и history (`:181-196`), intro (`:215-219`), eligibility с `FOR SHARE` (`:223-233`) и
  `reserveTelegramSlot` (`:240-247`), который берёт ещё один advisory lock и делает 3–5 statements.
- Когда `reserveTelegramSlot` возвращает `false` (глобальный lane 40 мс занят или по fairness
  сейчас очередь `subscription`/`material`: 3 из 4 turns в `telegram-transport-slots.ts:48-59`),
  цикл делает `continue` к **следующему** кандидату и повторяет все запросы, хотя глобальный lane
  для него тоже занят. При одновременных Notifications и рассылке один claim проходит по всем N
  кандидатам по ~7 запросов на каждого.
- `processAvailable` вызывает `claim()` до 25 раз за цикл, цикл запускается каждые 500 мс
  (`background-workers.ts:81-86`).
- Тот же глобальный lock берут `BotContacts.observeStart` и `observeContactability`
  (`bot-contacts.ts:52-55`, `:162-165`), `MarketingEntry` (`marketing-entry.ts:30-33`, `:106`) и
  `Funnels.execute` (`funnels.ts:111-114`).

**Почему это важно.** Аудитория рассылки — «все BotContacts» (`communications-v1.md:172`). При
первой рассылке или воронке на тысячи контактов claim начнёт выполняться секундами, при этом
**каждый `/start` ждёт тот же lock**. А update worker последовательный (H2), поэтому встанет
обработка всех updates, включая sign-in и linking, и бот перестанет отвечать. Сейчас marketing
выключен по умолчанию, поэтому это ещё не авария, а бомба замедленного действия: при реальном
объёме находка становится Critical. Нагрузочного теста нет.

**Рекомендация.**
1. Вынести планирование (`reconcileFunnels`/`reconcileBroadcasts`) из `claim`. Запускать его по
   событиям (publish или edit воронки, enrollment, stop/resume) для затронутого contact или funnel,
   плюс редкий фоновый проход с курсором.
2. Сделать `claim` дешёвым: `LIMIT`, индекс `(bot_identity, due_at) WHERE completed_at IS NULL`,
   индекс `(contact_id, funnel_id)`, `FOR UPDATE SKIP LOCKED` на строке доставки. Прерывать цикл,
   когда отказал глобальный lane или fairness turn (per-chat отказ пусть по-прежнему ведёт к
   следующему кандидату).
3. Сузить lock: ставить его per contact, а не per bot. Убрать scheduler lock из
   `observeStart`: там нужна только сериализация по контакту.
4. Добавить integration-тест на объём (например, 5k контактов и рассылка) с порогом по числу
   запросов или времени claim.

Effort: M–L.

### H2. Последовательная обработка updates: head-of-line blocking и сетевой I/O внутри транзакций — High

**Evidence**

- `telegram-update-processor.ts:56-158`: один цикл `claimNext → handle → markProcessed`, по
  одному update, глобально по `update_id` (`telegram-update-inbox.ts:76-90`).
- Обработчики делают HTTP в Platform **внутри транзакции** под advisory lock и `FOR SHARE`:
  `author-admin.ts:130-183` (`authorization.authorize`, таймаут 5 с в
  `http-author-authorization.adapter.ts:25`) и `communications.ts:195-260`.
- Pool — 10 соединений (`create-database.ts:11`).
- Порядок по отправителю гарантируется точечными хаками: сканированием jsonb в
  `telegram_updates` (`author-admin.ts:159-170`, `communications.ts:207-217`) и `throw` при
  «earlier pending». Retry с backoff 1–16 с (`telegram-update-inbox.ts:157`) может довести
  **более поздний** update до `failed` (5 попыток ≈ 15 с), пока ранний ждёт своего backoff.

**Почему это важно.** Одна медленная зависимость (Platform 5 с, Telegram до 10 с) задерживает
`/start`, linking и sign-in для всех пользователей. Отказ Platform при открытой транзакции держит
соединение из pool на 10. Упорядоченность — неявный invariant, размазанный по модулям.

**Рекомендация.** Записывать `sender_id` (from.id или chat.id) в колонку при `accept`. В claim
брать самый ранний pending update отправителя, у которого нет processing или более раннего
pending, чтобы получить per-sender lanes. Это позволит запускать N параллельных воркеров и уберёт
jsonb-хаки. Проверку прав Platform делать до транзакции, а внутри повторно сверять `platform_links`
(или кешировать решение на короткий TTL). Effort: M.

### H3. Ошибки проглатываются без диагностики — High (operability)

**Evidence**

- В `src` 53 `catch {}` / `.catch(() => …)`, `Logger` используется всего 11 раз.
- `telegram-update-processor.ts:151` пишет `markFailed` только с константой `processing_failed`
  (`telegram-update-inbox.ts:145,162`).
- `background-workers.ts:137-139, 150-152, 169-171, 194-196, 217-219, 232-234` и
  `notification-worker.ts:93-96` логируют фиксированную строку без класса ошибки.
- `notification-provider.ts:189-191` превращает недоступность permit в
  `source_unavailable` без причины.

**Почему это важно.** Редакция данных в логах требуется AGENTS.md и оправдана. Но имя ошибки,
SQLSTATE, `error_code` Telegram, HTTP status и `AbortError` не являются секретами. Сейчас на
инциденте невозможно отличить deadlock или constraint violation от timeout Platform или 429.
Update после 5 попыток молча становится `failed`, а метрика `update_failed` есть только в памяти
процесса.

**Рекомендация.** Завести один module-классификатор `failureCode(error)` (pg SQLSTATE, GrammyError
code, HTTP status, timeout, `CommunicationsError.code`, иначе `error.name`). Писать результат в
`failure_code` и в структурированный JSON-лог вместе с непрозрачными ссылками (`update_id`,
`operation_id`) по allowlist полей. Effort: S–M.

### M1. Graceful shutdown: воркеры гоняются с закрытием БД — Medium

**Evidence**

- `background-workers.ts:115-128` ждёт только `membershipCycle`, `marketingCycle` и
  `communityCycle`. Циклы update, delivery и evidence (`runUpdateCycle`, `runDeliveryCycle`,
  `runEvidenceCycle`) не отслеживаются.
- `database-lifecycle.ts:19-21` уничтожает pool тоже в `onApplicationShutdown`. Nest вызывает этот
  hook у всех providers одного module через `Promise.all`, а все providers лежат в `AppModule`.
  Значит закрытие БД идёт параллельно с ожиданием воркеров.
- `NotificationWorker` сделан правильно: использует `onModuleDestroy`
  (`notification-worker.ts:103-108`), который срабатывает раньше.

**Почему это важно.** Отправка в Telegram, которая была в полёте во время деплоя, не успевает
записать `settle`. Доставка остаётся в `sending`/`unknown` и после lease превращается в
`transport_unknown`/`unknown_exhausted`: сообщение фактически ушло, но система считает результат
неизвестным, а для некоторых очередей это означает повторную отправку. `stop_grace_period: 60s`
в compose при этом не помогает.

**Рекомендация.** Останавливать все таймеры и ждать все циклы в `beforeApplicationShutdown` или
`onModuleDestroy`, а pool закрывать последним. Добавить тест на `app.close()` при активном цикле.
Effort: S.

### M2. Architecture guardrail слишком узкий, направление зависимостей нарушено — Medium

**Evidence.** `scripts/check-architecture.mjs:5-11,14` проверяет только `src/adapters` и только
на импорты `database`, `infrastructure`, `@nestjs`, `kysely`, `pg`. Не проверяются:

- modules → adapters: `telegram-update-processor.ts:2,5,8`, `telegram-webhook.ts:12`,
  `communications.ts:14`, `author-admin.ts:45`;
- modules → operations: `RuntimeMetrics` в `telegram-update-processor.ts:22`,
  `telegram-webhook.ts:13`, `start-response-delivery-processor.ts:3`;
- цикл bot-contacts ↔ communications: `bot-contacts.ts:1-2` и `marketing-entry.ts:11`;
- shared kernel `Clock` живёт в `identity-linking/clock.ts`, его импортируют 10 файлов других
  modules;
- `grammy` и `amqplib` пока используются только в adapters и `app.module.ts`, но это никак не
  закреплено.

**Почему это важно.** Правило «adapter зависит от application interface» соблюдается только в
одну сторону. Обратная зависимость domain → adapter уже есть, и lint её не ловит.

**Рекомендация.** Перейти на `dependency-cruiser` или расширить скрипт правилами:
(a) `src/modules/**` не импортирует `src/adapters/**` и `src/operations/**`;
(b) никаких циклов между modules;
(c) `grammy`/`amqplib`/`fetch` только в `src/adapters/**`;
(d) вынести `Clock` и порт метрик в `src/shared/`.
Типы `AuthorInput`/`TemplateIntake` перенести в modules (см. кандидат D5). Effort: S.

### M3. Reply outbox и PlatformLink без модуля-владельца — Medium (locality)

**Evidence.**

- `start_response_deliveries` вставляется напрямую в **8 местах**, и везде повторяется строка из
  14 колонок: `bot-contacts.ts:127`, `bot-sign-in.ts:155`, `queue-sign-in-result.ts:27`,
  `marketing-entry.ts:79`, `communications.ts:380`, `author-admin.ts:201`,
  `membership-evidence-provider.ts:418`, `start-response-delivery-queue.ts:56`.
  `StartResponseDeliveryQueue.enqueue` при этом существует, но не может принять `tx`.
- `author-admin.ts:210` пишет `private_chat_id: input.telegramUserId`. Это верно только для
  private chat, и знание об этом неявное.
- `platform_links` читается примерно в 20 местах из 8 modules, с разными режимами lock
  (`forShare`, `forUpdate`, без lock): `community-provider.ts:301,383,443`,
  `membership-evidence-provider.ts:134,161,304,344`, `notification-provider.ts:252`,
  `author-delivery.ts:120,204`, `communications.ts:245`, `author-admin.ts:172` и другие.

**Почему это важно.** Изменение схемы или правил reply либо resolution PlatformLink требует правки
8–20 мест. Deletion test показывает, что `StartResponseDeliveryQueue.enqueue` сейчас shallow: его
удаление ничего не концентрирует.

**Рекомендация.** `enqueueReply(tx, {contact, text, sourceKey, trigger?})` как единственный путь
записи. `PlatformLinks.resolve(tx, bot, telegramUserId, {lock})` как interface, которым владеет
identity-linking. Effort: S–M.

### M4. Механика durable queue скопирована 7+ раз, lease без fencing — Medium

**Evidence.** Claim, stale-lease recovery, backoff и terminal states реализованы отдельно в
`telegram-update-inbox.ts:46-170`, `start-response-delivery-queue.ts:76-…`,
`membership-evidence-outbox.ts:29-…`, `initial-membership-check-queue.ts`,
`membership-reconciliation.ts`, `funnel-scheduler.ts:90-118`, `notification-provider.ts`,
`community-provider.ts`. Константы lease (60 с) и формулы backoff у каждого свои.
`markProcessed` проверяет только `state = 'processing'` (`telegram-update-inbox.ts:118-135`), а не
номер попытки. Воркер, у которого истёк lease, может завершить строку, которую уже взял другой
воркер.

**Почему это важно.** Мало locality: исправление, например fencing, нужно делать в 7 местах.
Каждая копия тестируется отдельно через тяжёлые integration-тесты.

**Рекомендация.** См. кандидат D1. Effort: M.

### M5. Холостая нагрузка polling — Medium (performance)

**Evidence.** Семь `setInterval` по 250–500 мс (`background-workers.ts:72-111`). У
`NotificationWorker` тик 40 мс (`notification-worker.ts:59`): каждый тик запускает транзакцию
`publishResults` и два `processCategory`. Оценка в простое: 150–200 SQL statements в секунду на
pool из 10. Кроме того, `publishResults` держит транзакцию и row lock, пока ждёт broker confirm (до
5 с, `notification-provider.ts:581-597`).

**Рекомендация.** Адаптивный backoff при пустом цикле (40 мс → 2 с, сброс при работе) и/или
`LISTEN/NOTIFY`-пробуждение из `inbox.accept` и `enqueue`. Для outbox публиковать вне транзакции:
сначала пометить `publishing` с lease, потом отправить. Effort: S–M.

### M6. `/ready` пишет в таблицу evidence и ходит в Telegram — Medium

**Evidence.** `operations.controller.ts:34-50` → `validateReadiness`
(`membership-evidence-provider.ts:96-116`) делает `getMe` + `getChatMember` и **вставляет** строку
`membership_provider_observations` с `sourceRef: readiness:{uuid}` (`:110`, `:927-941`). Такая
строка участвует в `rejectUnsafePositiveEvidence` (`:943-957`). Снаружи endpoint закрыт Caddy, а
Docker healthcheck использует `check-readiness.js`. Но любой внутренний probe на `/ready`
(мониторинг, будущий k8s) будет раздувать таблицу и влиять на evidence.

**Рекомендация.** Отделить readiness (кешированный последний результат, без записи) от наблюдения
за provider. Effort: S.

### M7. Дрейф и дублирование вендоренных контрактов — Medium

**Evidence.**

- `src/modules/community/contracts/schema.json:3-4`: `$id …/billing-integration-v1.schema.json`,
  title «proposed wire shape, no runtime enablement». При этом схема используется в runtime.
- В Platform уже есть `docs/contracts/community-v2` (2026-09-14) с обязательным
  `admissionRestriction`. Platform переключается между v1 и v2 конфигом
  (`platform/apps/backend/src/config/platform-config.ts:238`), а Telegram говорит только на v1.
- Схема notifications хранится в Telegram дважды: `docs/contracts/notifications-v1/schema.json` и
  `src/modules/notifications/contracts/schema.json`. Сейчас они совпадают, но ничего не держит их
  равными.
- `docs/contracts/notifications-v1/provenance.json`: `sourceStatus: "candidate-unmerged"`, хотя
  контракт уже в runtime.

**Рекомендация.** Один manifest вендоринга с sha256 каждого артефакта, проверяемый в `pnpm check`
(и зеркальный manifest в Platform). Одна копия схемы на контракт. Явная задача на переход к
community v2 или на запись решения «остаёмся на v1». Effort: S.

### M8. Author admin как строковая state machine — Medium (code quality)

**Evidence.**

- `author-admin.ts` (1417 строк) + `author-funnels.ts` (1144) + composer/sequence ≈ 3.5k строк
  диалоговой логики.
- `Action = { kind: string; id?: string; value?: string }` (`author-admin.ts:63`), около 67
  строковых сравнений, диспетчеризация через `a.kind.startsWith("sequence:")` (`:699-…`).
- Persisted session читается как `session?.state as State` без validation (`:221`). Если деплой
  меняет форму `State`, старые сессии тихо ломаются.
- 43 `!` в `author-admin.ts`, 18 в `author-funnels.ts`.
- jsonb без проверки приводится cast'ом: `delivery.parts as DeliveryPart[]`
  (`funnel-scheduler.ts:98,160`), `funnel.published as FunnelDraft` (`:186`).

**Рекомендация.** Discriminated union `AuthorAction` с exhaustive switch. Версионированный и
валидируемый `State` со сбросом в home при несовпадении. Parse-функции для jsonb-колонок. Effort: M.

### M9. Нетипизированные ajv validators — Medium (effective TS)

**Evidence.**

- `communications-contract.ts:95-98`: `ajv.compile(...)` без generic, поэтому `validRequest`
  ничего не сужает, и `communications.controller.ts:49-63` семь раз пишет
  `body as CommunicationsRequest` внутри вложенного тернарного routing.
- `community-contract.ts:188`: `record as unknown as CommunitySetCommand`.
- `http-author-authorization.adapter.ts:40-44`: cast после validation.
- Три экземпляра Ajv с разной строгостью: `strict: true` в communications, `strict: false` в
  community и notifications.

**Рекомендация.** `ajv.compile<T>` или `JSONSchemaType<T>` (либо обёртка-guard). Routing через
таблицу `operation → handler`. Единая фабрика Ajv со `strict: true`. Effort: S.

### M10. ESLint без type-aware правил, часть scripts вне typecheck — Medium

**Evidence.** `eslint.config.mjs` подключает `tseslint.configs.recommended`, а не
`recommendedTypeChecked`. Код полагается на fire-and-forget (`void this.runUpdateCycle()` и т. п.),
при этом `no-floating-promises`, `no-misused-promises` и `switch-exhaustiveness-check` не
включены. В `tsconfig.json` `include` нет `scripts/platform-conformance-provider.ts` и
`scripts/conformance-safety.ts`.

**Рекомендация.** Включить type-checked preset (минимум три названных правила) и добавить в
typecheck `scripts/**/*.ts`. Effort: S (плюс разбор того, что всплывёт).

### Low

- **L1. Миграции.** Две миграции с номером `010` и `allowUnorderedMigrations` с собственной
  проверкой порядка (`migrator.ts:28-86`). Импорты перемешаны. Приложение мигрирует БД при
  старте (`database-lifecycle.ts:15-17`), а в production есть ещё и отдельный сервис `migrate`
  (`infra/production/compose.yaml:24-28`): два пути, и неудачная миграция отправляет app в
  crash-loop. Рекомендация: оставить явный шаг `migrate`, закрепить правило нумерации. S.
- **L2. Нет retention** для append-only таблиц: `telegram_updates` (payload обнуляется, строки
  остаются навсегда), `bot_contact_events`, `membership_event_audit`,
  `membership_provider_observations`, опубликованные строки `notification_result_outbox`,
  `start_response_delivery_attempts`, `communication_tracking_hits`. Payload с ограниченным сроком
  есть только у notification quarantine. S–M.
- **L3. Индексы.** Claim в `telegram_updates` сортирует по `update_id` при диапазоне по
  `available_at`, а индекс `(state, available_at, update_id)` (`001-ordinary-start.ts:37-39`) это
  не покрывает, поэтому выполняется сортировка. Stale-запросы по `locked_at` без индекса. При
  текущем объёме некритично. S.
- **L4. Telegram adapters.** Классификация `GrammyError` продублирована трижды
  (`grammy-messages.adapter.ts:71-80`, `grammy-communications.adapter.ts:111-121`,
  `grammy-community-chat.adapter.ts:203-212`). Шесть отдельных `new Api(...)`.
  `GrammyMembershipAdapter` создаёт `new Api(token)` без `timeoutSeconds`
  (`grammy-membership.adapter.ts:12`). Внешний race-таймаут не отменяет сам запрос: он продолжает
  висеть. `getBotChatMember` каждый раз вызывает `getMe`, итого 3 вызова API на одну проверку
  membership. S.
- **L5. Вводящие в заблуждение имена.** `InMemoryIdentityLinkingAdapter` — это production-mapper
  HTTP-конвертов (`in-memory-identity-linking.adapter.ts:18`, `app.module.ts:294`). `Clock` лежит
  в identity-linking. `parseBoolean` в любом случае ругается на `WORKERS_ENABLED`
  (`application-config.ts:481`), хотя используется и для `TELEGRAM_MARKETING_ENABLED`. S.
- **L6. Обход `CLOCK`.** 22 вызова `new Date()`/`Date.now()` в `src/modules` (author-delivery,
  update-processor, communications, processors). `BackgroundWorkers` передаёт `systemClock` мимо
  DI (`background-workers.ts:19,190`). S.
- **L7. `NotificationWorker` собирает `NotificationProvider`, `HttpNotificationAuthorization` и
  `NotificationBroker` вручную, вне DI** (`notification-worker.ts:42-58`). Однобуквенные имена
  (`n`, `b`, `p`), `config.notifications!` (`:83`). Стиль расходится с остальным кодом, а подменить
  зависимости через `overrideProvider` нельзя. S.
- **L8. Tooling в runtime-образе.** `src/operations/credentialed-proof.ts` (1132 строки)
  компилируется в `dist` и читает runtime-таблицы напрямую (`:216` и далее). Разовый proof-инструмент
  связан со схемой. Можно вынести в `scripts/` с отдельным tsconfig. S.
- **L9. `.github/scripts/__pycache__/`** не отслеживается git, но и не игнорируется (`git status`
  показывает `??`). В `.gitignore` нет `__pycache__/` и `*.pyc`. Скрипты tracker управляются
  harness, поэтому правку лучше внести в канонический пакет `inside-engineering` (шаблон
  ignore), либо локально. S.
- **L10. Caddy.** `infra/production/telegram.caddy.example:3` не маршрутизирует
  `integrations/platform/v1/communications`. Нужно проверить: если Platform ходит туда через
  публичный хост, communications API вернёт 404. S.
- **L11. Нет application ADR** для реально принятых решений: inbox с polling в PostgreSQL,
  advisory locks, протокол DispatchPermit и attempt ledger, семантика `unknown`, модель одного
  экземпляра. `seed-decisions.md` явно оставляет эти решения для ADR. Без ADR будущие review
  будут заново поднимать одни и те же вопросы. S.

---

## 3. Effective TypeScript: подсчёт

| Метрика | `src` | `test`+`scripts` | Комментарий |
|---|---|---|---|
| `any` | 0 | 1 | хорошо |
| `as X` (без `as const`, без импортов) | 84 | 44 | 60%+ в communications: author-funnels 19, funnels 10, funnel-scheduler 7, controller 7 |
| `as unknown as` | 1 | 8 | `community-contract.ts:188` |
| non-null `!` | ~148 | ~180 | около 110 в communications (author-admin 43) |
| `@ts-ignore`/`@ts-expect-error` | 0 | 0 | — |
| `eslint-disable` | 0 | 1 | — |
| проглоченные `catch` | 53 | 3 | см. H3 |
| branded types | 0 | 0 | `telegramUserId`, `privateChatId`, `accountRef`, `telegramIdentityRef`, `botIdentity` — просто `string`; путаница уже видна в `author-admin.ts:210` |
| exhaustiveness (`never`) | 21 | 3 | есть в community/notifications, но `TelegramUpdateProcessor` обрабатывает команды цепочкой `if/else` без проверки полноты (`:72-145`) |

Вывод. Ядро (membership, identity, community, notifications) написано аккуратно. Весь технический
долг по типам собран в communications / author admin, а эта часть в последние недели меняется
чаще всего.

---

## 4. Тесты

- **Баланс.** 107 unit-кейсов (около 3k строк: в основном contracts, adapters, config, CLI) против
  265 integration-кейсов (около 13k строк, реальные PostgreSQL и RabbitMQ). Domain logic почти
  целиком проверяется через integration: высокая достоверность, но медленно. Файлы запускаются
  последовательно (`vitest.integration.config.ts: fileParallelism: false`), поэтому suite будет
  расти линейно.
- **Fakes, а не mocks.** Это хорошо: `test/support/community-chat.ts`,
  `synthetic-telegram-updates.ts`, transport-fakes через `overrideProvider`.
- **Не покрыто или покрыто слабо:**
  - `BackgroundWorkers` и shutdown: 0 упоминаний в тестах (M1);
  - финальный переход update в `failed` после 5 попыток: `processing_failed` нигде не
    проверяется; истечение lease покрыто (`ordinary-start.integration.test.ts:342`);
  - объём и производительность планировщика: нет (H1);
  - `reconcileFunnels` на уровне module: нет;
  - fairness в `reserveTelegramSlot`: косвенно, 2 файла;
  - навигация author admin: около 67 action kinds против примерно 5 integration-сценариев и
    100-строчного unit-файла;
  - сверка байтов вендоренных контрактов: только billing (`subscription-contract-artifacts.test.ts`).
- **Architecture-тест** (`test/architecture/adapter-boundary.test.ts`) проверяет только узкое
  правило из M2.

---

## 5. Кандидаты на deepening (по силе рекомендации)

### Strong

**D1. Module «Durable work lane» (inbox и outbox очереди в PostgreSQL).**
Files: `telegram-update-inbox.ts`, `start-response-delivery-queue.ts`,
`membership-evidence-outbox.ts`, `initial-membership-check-queue.ts`,
`membership-reconciliation.ts`, stale-часть `funnel-scheduler.ts`, author outbox.
Problem: 7+ shallow копий claim/lease/backoff без fencing (M4). Порядок по отправителю
обеспечен jsonb-хаками (H2).
Solution: один module с маленьким interface примерно такого вида:
`claim(lane, {orderingKey?}) → Lease`, `complete(lease)`, `retry(lease, code, after?)`,
`fail(lease, code)`. Внутри: fencing по attempt, политика backoff, stale-recovery, метрики backlog,
ordering по ключу. Domain-specific terminal states (`unknown_exhausted`, `rejected`) передаются
как параметр.
Benefits: locality (fencing и backoff исправляются один раз), leverage (новая очередь пишется в
несколько строк), тесты идут через один interface вместо 7 integration-копий. Deletion test:
удаление module вернёт сложность в 7 мест, значит он настоящий.

**D2. Communication timeline: разделить «планирование» и «dispatch».**
Files: `funnel-scheduler.ts`, `funnel-timeline.ts`, `broadcasts.ts`, `marketing-entry.ts`,
`bot-contacts.ts`.
Problem: H1. Планирование всей аудитории выполняется внутри каждого claim под глобальным lock.
Solution: module планирования с interface `replan(scope: contact | funnel | broadcast)`, который
вызывается событиями. Dispatch становится дешёвым `nextDue(limit)` по индексу.
Benefits: стоимость claim перестаёт зависеть от размера аудитории, `/start` больше не
сериализуется с рассылками, планирование можно тестировать на уровне module без Telegram.

**D3. Reply outbox и PlatformLink resolution как глубокие modules.**
Problem: M3.
Solution: `enqueueReply(tx, …)` как единственный путь записи в reply outbox и
`resolveLinkedIdentity(tx, bot, telegramUserId, {lock})`.
Benefits: 8 + ~20 мест сводятся к двум interfaces, правила lock и private chat становятся явными.
Effort S–M, лучшее соотношение пользы и затрат.

**D4. Composition по capability (feature modules плюс единый WorkerLoop).**
Files: самые часто меняемые с августа: `database/migrator.ts` (16 правок), `database.ts` (16),
`app.module.ts` (12), `application-config.ts` (11), `telegram-update-processor.ts` (9),
`background-workers.ts` (7).
Problem: каждая capability правит 6 центральных файлов. Воркеры запускаются вручную, с
копипастой флагов и неполным shutdown (M1).
Solution: Nest-module на каждую capability (membership, community, communications,
notifications, sign-in). Он владеет своими providers, срезом config и tables type. Циклы
регистрируются в одном `WorkerLoop`, который отвечает за backoff в простое (M5), shutdown (M1),
логирование ошибок (H3) и метрики.
Benefits: locality для новых capability, одно место для lifecycle.

### Worth exploring

**D5. Завершить seam `TelegramUpdateCommand`.** Включить `AuthorInput` и `TemplateIntake` в
union, processor превратить в exhaustive router, а modules отвязать от adapters (M2). Сейчас
`telegram-update-processor.ts:126-144` второй раз разбирает сырой payload в ветке `ignored`.

**D6. Общий «attempt ledger» для внешних эффектов.** Notifications и community реализуют
одинаковый протокол `permit → started → call → settle/unknown`
(`notification-provider.ts:173-439`, `community-provider.ts:640-960`). Здесь два adapter, то есть
seam настоящий. Осторожно: семантика retry и supersede у них различается, объединять только
ledger и settle.

**D7. Author admin как типизированная state machine** (M8): union действий, версионированное
состояние сессии, чистая функция `transition(state, action) → {state, replies}`. Её можно
тестировать unit-тестами без БД.

### Speculative

**D8. Config как discriminated union по capability**
(`telegram: {mode:'live', token} | {mode:'disabled'}` и т. д.). Уберёт повторяющиеся проверки
`mode === "live" && botToken` в `app.module.ts:112-230` и неявные связи вроде
`platformAuthorContentValidationUrl` + `platformAuthorAuthorizationSecret`
(`app.module.ts:257-266`).

**D9. Один Telegram API client adapter**: общий `Api`, единый классификатор ошибок, кеширование
`getMe` (L4).

**Top recommendation.** Начать с **D2 вместе с H1**: это единственная находка, которая при первом
реальном объёме рассылок выведет из строя весь бот, включая sign-in и linking. Сразу за ней идут
**M1 и H3** (дёшево, заметно повышает надёжность деплоев и разбор инцидентов), затем **D1**, который
закрывает M4 и H2 одним module.
