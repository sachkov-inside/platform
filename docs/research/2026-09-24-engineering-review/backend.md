# Platform backend и packages: архитектура и качество кода

> Историческое исследование на указанную в документе дату. Оно не задаёт текущие правила.
> Источник: [Workspace](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/2026-09-24-engineering-review/backend.md); текущие правила — [документы Platform](../../../README.md).

Область: `apps/backend/src` и `packages/*` в `/Users/dev/Work/Products/inside/repositories/platform`
(HEAD `6ce6b22f`, 2026-09-24). Проверка только на чтение, без запуска тестов. Горячие точки
выбраны по `git log --oneline -300 --name-only` (коммиты 2026-08-19 … 2026-09-24):

| Путь | Касаний за 300 коммитов |
|---|---|
| modules/materials | 826 (из них infrastructure/postgres — 123) |
| modules/billing | 171 |
| modules/membership-entitlements | 127 |
| modules/content-library | 93 |
| modules/accounts | 89 |
| openapi/platform-api.json | 75 |
| entrypoints/api | 64 |
| src/migrations/index.ts | 59 |

ADR 0001/0003/0004/0005/0009/0021/0023/0024 приняты как данность. Где находка их касается, это
отмечено отдельно. HTML-отчёт с кандидатами на углубление лежит рядом: `architecture-backend.html`.

## Измерения

Все цифры ниже — для кода без `infrastructure/prisma/generated`. Backend src — это 644 файла и
55 981 строк. Workspace packages — 48 файлов и 4 066 строк. Тесты — 187 файлов и 41 666 строк.

| Метрика | backend src | packages | tests |
|---|---|---|---|
| `any` | 0 | 0 | 0 |
| non-null `!` | 0 | 0 | 0 |
| `@ts-ignore` / `@ts-expect-error` | 0 | 0 | 1 |
| `oxlint-disable` | 12, все с причиной (brand-конструкторы, Nest class) | 1 | 15 |
| Настоящие type assertions `as X` (без `as const`, SQL `AS`, import alias) | 16 в 11 файлах, почти все — конструкторы branded id | 2 (`as unknown`) | 97 |
| `as unknown as` | 0 | 1 (`block-definition.ts`) | 7 |
| `z.infer/input/output` | 200 | 4 | 6 |
| Проверки полноты (`assertNever` / `satisfies never` / exhaustive) | 35 | 0 | – |
| `$transaction(` | 114, все interactive; isolation level не задан ни разу | – | 21 |
| `$queryRaw/$executeRaw` | 79 | – | 60 |
| `process.env` вне config | 0 в modules (есть в worker-healthcheck, runtime-identity, mcp, release/, development/) | 0 | – |
| Nest `Logger` | 0 содержательных использований; `console.*` — 35 | – | – |
| Голый `catch {` в modules | 176, ни один не пишет причину | – | – |
| TODO/FIXME | 0 | 0 | 0 |

Строгая типизация на уровне TypeScript сделана образцово. Проблемы лежат не в типах, а в
границах module, транзакциях, наблюдаемости и дублировании.

Самые большие рукописные файлы:

| Файл | Строк | KB |
|---|---|---|
| `modules/materials/infrastructure/postgres/published-material-reader/published-material-projection.ts` | 1183 | 41.7 |
| `modules/materials/facets/guide-artifacts/assemble-guide-artifacts.ts` | 1233 | 41.3 |
| `development/seed-local-development.ts` | 929 | 39.4 |
| `modules/billing/facets/billing-payments/billing-payments.ts` | 472 | 36.9 (плотные строки до 386 символов) |
| `config/platform-config.ts` | 821 | 34.2 (`parsePlatformConfig` — одна функция на 333 строки) |
| `modules/membership-entitlements/facets/tribute-sources/tribute-sources.ts` | 358 | 32.5 |
| `modules/videos/facets/videos/assemble-videos.ts` | 804 | 31.4 |
| `modules/billing/facets/billing-subscriptions/billing-subscriptions.ts` | 411 | 31.2 |
| `modules/assets/facets/material-assets/assemble-material-assets.ts` | 754 | 28.2 |

---

## High

### H1. Сбои зависимостей не оставляют следа: 176 `catch {}`, логгера нет
- **Где видно.**
  - `modules/**`: 176 голых `catch {`. Больше всего в `videos/facets/videos/assemble-videos.ts` (20), `materials/facets/guide-artifacts/assemble-guide-artifacts.ts` (18), `telegram-membership/.../assemble-telegram-membership.ts` (7). Типичный пример — `assemble-guide-artifacts.ts:253`: `catch { return dependencyUnavailable(); }`. Ни один из 176 не пишет причину.
  - `entrypoints/billing-worker.ts:21`: `.catch(() => { console.error("Billing worker failed") })`. Ошибка запуска теряется целиком, кроме `SaleConfigurationError`.
  - `billing-worker.ts:42`: `jobs.on("error", () => console.error("Billing recovery queue unavailable"))`.
  - `notifications-worker.ts:13`: выводит только `worker_stopped`, поэтому брошенная рядом `Notifications configuration required` пропадает.
  - Обработчики pg-boss бросают `new Error(result.error.code)` (`billing-worker.ts:49` и далее). Причина остаётся только в таблице pg-boss.
  - `infrastructure/http/problem-details.filter.ts` ловит только `HttpException`. Логгер Fastify выключен (`entrypoints/api/create-api-application.ts:22-26`), request id нет, метрик и трассировки нет.
- **Почему важно.** Сбой PostgreSQL, S3, Kinescope, Т-Банка или ошибка программиста одинаково превращаются в `dependency_unavailable` (503) без строки в логе. Скоро платёжный запуск, и каждый инцидент придётся восстанавливать по памяти.
- **Что сделать.**
  - Сделать один module, например `reportDependencyFailure(scope, error)`, за seam структурного логгера (Nest Logger или pino): он классифицирует ошибку, пишет модуль, операцию, причину и request id и возвращает вариант union. Этим вызовом заменить `catch {}`.
  - Включить журнал запросов Fastify с request id.
  - В worker при старте всегда писать `error` со stack.
  - Позже закрепить правило в oxlint или guardrail: запретить `catch {}` без вызова reporter.
- **Трудоёмкость:** M. Замена механическая, но охватывает 176 мест.

### H2. Запись другого module выходит из транзакции save; вложенные соединения
- **Где видно.**
  - `modules/materials/features/save-material/save-material.ts:414-420` внутри транзакции save вызывает `materialAssets.markUnreferenced`.
  - Тот открывает **свою** `prisma.$transaction` (`modules/assets/facets/material-assets/assemble-material-assets.ts:351`) и коммитится независимо.
  - Последующий откат save (`:423` — удаление видео, `:435` — detachment) эту пометку не отменяет.
  - Такие вызовы держат второе соединение из пула, пока первое держит блокировки. Размер пула — `max: 10` (`infrastructure/prisma/prisma-adapter.ts:4`).
  - Тот же приём есть в `workshop/features/grant-entitlement/grant-entitlement.ts:74` (`resolveForAccess` открывает свою транзакцию), `reading-activity/.../record-material-open.ts:31` и `notifications/features/authorize-dispatch/authorize-dispatch.ts:10`.
- **Почему важно.**
  - Состояние assets может разойтись с Materials. Сейчас последствия смягчает перепроверка `isReferenced` под той же advisory lock в очистке (`assemble-material-assets.ts:520-526`).
  - При 10 одновременных сохранениях пул может заблокироваться: каждое держит одно соединение и ждёт второе. При одном авторе это маловероятно, но риск растёт вместе с MCP-агентами.
- **Что сделать.** Передавать транзакцию вызывающего в interface assets, типизированную capability-scoped клиентом Assets. ADR 0003 прямо допускает простые транзакции приложения на одном пуле. Это кандидат 2 в HTML-отчёте.
- **Трудоёмкость:** M.

### H3. Взаимное исключение между module держится на совпадении строки ключа
- **Где видно.**
  - `infrastructure/prisma/transaction-locks.ts:17-27`: `pg_advisory_xact_lock(hashtextextended(${materialId}, 0::bigint))`, голый UUID без пространства имён.
  - Тот же ключ написан вручную в `modules/assets/facets/material-assets/assemble-material-assets.ts:520` и `modules/videos/features/process-video-deletions/process-video-deletions.ts:157`.
  - Всего 24 места advisory lock в 18 файлах. Пять ключей без пространства имён, в том числе `member-profiles/features/change-profile-avatar/change-profile-avatar.ts:111,176` и `cleanup-profile-avatar-orphans.ts:58` (голый `accountId`).
  - Три блокировки обходят общий помощник: `materials/facets/content-covers/content-covers.ts:275`, `cleanup-content-covers.ts:44`, `infrastructure/postgres/material-slug.ts:67`.
- **Почему важно.** Если Materials добавит к ключу префикс, как это уже сделано у `account-entitlement:` и `telegram-link-state:`, очистка assets и удаление видео молча перестанут исключать save. Компилятор и тесты этого не увидят, а результат — удаление файлов, на которые ещё есть ссылки.
- **Что сделать.** Одно именованное interface блокировки ссылок Material, например `lockMaterialReferences(tx, ids)` с пространством имён, и один реестр пространств ключей. Прямой `pg_advisory_xact_lock` вне него запретить guardrail-правилом.
- **Трудоёмкость:** S–M.

## Medium

### M1. Цикл зависимостей между 8 module; маскировка через dynamic import
- **Где видно.**
  - С учётом type-only импортов 8 module образуют одну сильно связную компоненту: billing, notifications, telegram-membership, membership-entitlements, workshop, materials, content-access, videos.
  - Runtime-цикл: materials → workshop (`materials/assemble-materials.ts:21`, type) и workshop → materials, где `workshop/adapters/materials/workshop-material-catalog.ts:1` импортирует значение `materialId`.
  - `membership-entitlements/membership-entitlements.module.ts:26,33,43-44` делает `await import("../telegram-membership/index.js")` и `../materials/index.js`, чтобы обойти цикл Nest.
  - Materials сам собирает `CONTENT_ACCESS` (`materials/materials.module.ts:238-267`), хотя content-access зависит от Materials.
  - `scripts/check-backend-architecture.mjs` запрещает deep imports (нарушений 0), но циклы не проверяет.
- **Почему важно.** Порядок инициализации становится хрупким, а module нельзя понять или протестировать отдельно. Dynamic import скрывает зависимость от guardrail и от читателя.
- **Что сделать.**
  - Добавить в guardrail проверку циклов (madge или свой обход графа), сначала с allowlist текущих рёбер.
  - Разорвать runtime-цикл materials↔workshop: оба module могут взять `MaterialId` из места без зависимостей.
  - Перенести сборку CONTENT_ACCESS в `content-access.module`.
- **Трудоёмкость:** M.

### M2. Interface Materials широкий и мелкий; неиспользуемые экспорты по всему backend
- **Где видно.**
  - `modules/materials/index.ts` (246 строк) экспортирует 188 символов: 122 типа и 66 значений, из них 30 Nest controllers. 106 символов никто вне module не использует.
  - Токены `GUIDE_ARTIFACTS`, `VIDEO_PLAYBACK`, `GUIDE_ARTIFACT_DELIVERY` экспортируются без внешнего потребителя. Это противоречит `apps/backend/CODING_STANDARDS.md` («Export a provider token only for a current production inter-module or process consumer»).
  - `entrypoints/api/api.module.ts:29-60` регистрирует controllers Materials сам.
  - По всем module: 245 из 544 экспортов `index.ts` (45%) не используются снаружи, даже с учётом тестов и scripts.
  - 35 тестовых файлов импортируют внутренности Materials в обход `index.ts`.
- **Почему важно.** Interface почти равен реализации, поэтому leverage нет, а любой внутренний тип становится публичным обязательством.
- **Что сделать.** `MaterialsModule` сам регистрирует свои controllers. Сузить `index.ts` до примерно 82 используемых символов и добавить проверку неиспользуемых экспортов index (knip или свой скрипт).
- **Трудоёмкость:** S–M.

### M3. Materials вобрал отдельные понятия
- **Где видно.**
  - Guide Artifact: около 2 400 строк и 4 Prisma models (`prisma/schema.prisma:347-424`). Он импортирует только `ports/author-policy` и assets, domain Materials не использует.
  - `materials/facets/video-playback/video-playback.ts` ничего из Materials не импортирует; зависит от content-access, videos и accounts.
- **Почему важно.** По тесту удаления Materials теряет без них только проводку. Они увеличивают interface и число касаний самого горячего module.
- **Что сделать.** Вынести Guide Artifact в отдельный module, Video Playback — в Videos. Guides/Series, коллекции и импорт источника оставить внутри: они участвуют в транзакции save.
- **ADR.** По ADR 0003 новой схеме нужна миграция переноса таблиц. ADR 0009 не затронут.
- **Трудоёмкость:** L.

### M4. Замыкания `assemble-*` и классы facet как god-functions
- **Где видно.**
  - `assemble-guide-artifacts.ts`: одна функция `assembleGuideArtifacts` на 847 строк (165–1014) с 7 транзакциями, импортом источника на 265 строк и файловым хранилищем.
  - `assemble-videos.ts`: 647 строк, 16 методов, 33 обращения к БД, 0 импортов из `features/`.
  - `assemble-material-assets.ts`: 564 строки.
  - `assemble-access-grants.ts`: 269 строк; в нём самая длинная строка репозитория — 883 символа.
  - Классы billing того же рода: `billing-payments.ts` (472 строки, 37 KB), `billing-subscriptions.ts`, `billing-operations.ts`, `accounts/facets/billing-contact/billing-contact.ts` (490).
  - Для сравнения `assemble-accounts.ts` — 30 строк чистой проводки.
- **Почему важно.** ADR 0004 и стандарт называют `assemble` проводкой, а `features/` — местом операции. Чтобы изменить одну операцию, приходится читать 600–850 строк, и ревью и агенты теряют locality.
- **Что сделать.** Перенести операции в `features/<action>/` как функции с явными зависимостями. Facet interface и тесты через него не меняются.
- **Трудоёмкость:** M для каждого файла.

### M5. Дублирование: отображение ошибок, схемы, отпечатки, SMTP
- **Где видно.**
  - Отображение код → HTTP написано вручную как минимум 26 раз. В Materials 6 копий: `adapters/nest/material-authoring-http.ts:327-380`, `guide-artifacts.controller.ts:590-635`, `content-covers.controller.ts:346-411`, `upload-material-asset.controller.ts:143-176`, `video-playback.controller.ts:119`, `read-published-material.controller.ts:86`. Ещё не меньше 20 помощников `throw*Error` в других module.
  - `accounts/adapters/nest/account-problem-details.filter.ts` почти копирует `infrastructure/http/problem-details.filter.ts`.
  - `billing/shared/payment-http.filter.ts`, `pricing-http.filter.ts` и `billing/adapters/nest/owner-http.filter.ts` называются filter, но это помощники throw.
  - **Controller и facet уже расходятся:** `guide-artifacts.controller.ts:54` — `title: z.string().min(1).max(200)`, а `assemble-guide-artifacts.ts:30` — `z.string().trim().min(1).max(200)`.
  - Схема discovery-запроса повторена в двух module: `materials/.../discover-published-material-projections.ts:15-32` и `content-library/.../discover-published-materials.ts:12-30`.
  - Канонический JSON-отпечаток реализован 5 раз: `infrastructure/contracts/canonical-digest.ts`, `billing/shared/command-fingerprint.ts`, `membership-entitlements/domain/tribute-webhook.ts:21`, `notifications/domain/notification-wire.ts:57` и другие. Есть и варианты на `JSON.stringify`, зависящие от порядка ключей: `billing-payments.ts:53`, `quote-purchase.ts:26`, `manage-catalog.ts:30`, `accept-evidence.ts:556`.
  - Два одинаковых nodemailer-транспорта: `accounts/infrastructure/send-billing-contact-code.ts` и `notifications/infrastructure/send-notification-email.ts`.
- **Почему важно.** Правила существуют в нескольких копиях и расходятся (пример с `.trim()` выше). Отпечаток, который зависит от порядка ключей, может дать ложный `payload_conflict` при идемпотентном повторе.
- **Что сделать.**
  - Одна таблица problem на union с проверкой полноты и один filter (кандидат 6 в HTML).
  - Controller переиспользует схемы facet.
  - Один `canonicalDigest` из `infrastructure/contracts` и один SMTP-адаптер.
- **Трудоёмкость:** M.

### M6. Вероятный дефект: смена публикации не передаёт подтверждение снятия из руководства
- **Где видно.**
  - `modules/materials/features/transition-material-publication/transition-material-publication.ts:18-39` собирает `SaveMaterialCommand` без `confirmedGuideRemovals`, а в `.contract.ts:7-13` такого поля нет.
  - `save-material.ts:313-326` при `publicationState !== "published"` считает все руководства снимаемыми и возвращает `guide_removal_confirmation_required`.
  - Интеграционный тест `test/integration/guide-removal-confirmation.test.ts:100-102` проверяет отказ через save, а не успешный путь через transition.
- **Почему важно.** Снять с публикации через этот endpoint или MCP-инструмент Material, который входит в купленное руководство, скорее всего невозможно: подтвердить нечем. Вывод сделан по чтению кода, запуском не проверен.
- **Что сделать.** Добавить `confirmedGuideRemovals` в команду transition и в её HTTP/MCP-схему. Тест: снятие с публикации с подтверждением проходит.
- **Трудоёмкость:** S.

### M7. Церемония pg-boss повторена 8 раз; политика повторов без имени
- **Где видно.**
  - `entrypoints/billing-worker.ts:45-93` пять раз повторяет `createQueue` / `schedule` / `send` / `work`. Ещё по одному разу в `material-assets-worker.ts`, `profile-avatars-worker.ts`, `video-deletions-worker.ts`. `new PgBoss({schema:"pgboss",…})` создаётся в 4 местах.
  - Billing использует `retryLimit: 0`, очистка — 5 повторов с backoff 30–300 с.
  - `material-assets-worker.ts` и `profile-avatars-worker.ts` отличаются примерно на 10 строк.
- **Почему важно.** Каждый новый sweep копирует церемонию, а политика повторов и запись результата выбираются заново каждый раз.
- **Что сделать.** `runWorker({ process, sweeps: [{ queue, cron, retry, run }] })` в `infrastructure/worker-runtime.ts` (кандидат 3 в HTML).
- **Трудоёмкость:** S–M.

### M8. Пропускная способность уведомлений ограничена сверху
- **Где видно.**
  - `infrastructure/notification-transport/outbox.ts:29-31`: `relay()` берёт одну строку через `findFirst`.
  - `worker.ts:29-31` игнорирует результат `relay` и ждёт `RELAY_SWEEP_MS = 1_000` (`worker.ts:9`). Итого около 1 сообщения в секунду на дорожку.
  - `modules/notifications/features/dispatch-email/dispatch-email.ts:93,119` возвращается после первой строки, то есть одно письмо на категорию за обход.
- **Почему важно.** Если рассылка по многим получателям создаёт по сообщению на человека, очередь растянется на часы. Сейчас объёмы малы, поэтому это потолок роста, а не текущий сбой.
- **Что сделать.** Пока `relay` возвращает `true`, продолжать без паузы; брать строки пакетом с `FOR UPDATE SKIP LOCKED`. До изменения стоит измерить реальные объёмы.
- **Трудоёмкость:** S–M.

### M9. Нет форматтера: стиль расходится между module
- **Где видно.**
  - В корне нет конфигурации prettier, oxfmt или biome. Есть только `lint` на oxlint (`package.json:32`), без правил длины строки и кавычек.
  - Доля строк длиннее 120 символов: notifications — 240 из 1 156 (21%), billing — 736 из 4 357 (17%), membership-entitlements — 356 из 4 238 (8%), materials — 310 из 18 413 (1.7%).
  - В 22 из 24 файлов notifications одинарные кавычки, в остальном коде двойные. Самая длинная строка — 883 символа.
- **Почему важно.** Плотные строки прячут логику: `billing-payments.ts` по объёму в KB равен файлу на 1 200 строк. Diff и ревью становятся шумными.
- **Что сделать.** Подключить oxfmt или prettier и применить одним отдельным коммитом, добавив его в `.git-blame-ignore-revs`.
- **Трудоёмкость:** S.

### M10. Реестр миграций: дубли номеров и порядок, не совпадающий с номерами
- **Где видно.**
  - `src/migrations/index.ts`: 72 записи вручную, 59 касаний за 300 коммитов.
  - Номера повторяются: `0038` (materials home-material-pin и membership-entitlements account-access), `0039` (materials и telegram-membership), `0065` (videos video-detachment и materials authoring-source).
  - Порядок в конце реестра: 0067, 0065, 0069, 0066, 0068, 0065, 0070.
- **Почему важно.** Номер в имени вводит в заблуждение. Ledger привязан к позиции, поэтому ошибка при слиянии веток ловится только integration-тестом.
- **Что сделать.** Для новых миграций (с 0071) проверять уникальность номера и его равенство позиции. Уже применённые имена не трогать из-за контрольных сумм. ADR 0005 не затронут.
- **Трудоёмкость:** S.

### M11. Путь чтения опубликованного Material: 6 переходов и около 6 запросов
- **Где видно.** Controller `read-published-material.controller.ts:57` → `published-material-reader.ts` → `materials.module.ts:269` → `assemble-published-material-reader.ts:31` (чистый pass-through) → `read-published-material.ts:39` → projection `:193/1026/1125`. Строка Material читается 3 раза: projection, `loadPublishedBody` на `:108` и главы на `:121`. При гонке версий всё повторяется (`:61`).
- **Почему важно.** Это самый частый запрос участника, и лишние переходы и запросы идут на каждый вызов.
- **Что сделать.** Удалить проходной assemble; проекция сразу возвращает тело и главы.
- **Трудоёмкость:** M.

### M12. OpenAPI-артефакт на 5.3 MB без переиспользования схем
- **Где видно.**
  - `apps/backend/openapi/platform-api.json`: 5 262 792 байта, 123 164 строки, 75 касаний за 300 коммитов.
  - В `components.schemas` только 2 схемы, всё остальное встроено в операции. Три операции больше 100 KB каждая: `POST /communications` — 177 KB, `POST /billing/admin` — 165 KB, `POST /communications/templates/resolve` — 116 KB.
- **Почему важно.** Артефакт регулярно конфликтует при слияниях, а сгенерированный transport в web дублирует типы на каждую операцию.
- **Что сделать.** Регистрировать повторяющиеся zod-схемы как именованные components (`.meta({ id })`) в `infrastructure/http/zod-openapi.ts`. Сам подход ADR 0007 не меняется.
- **Трудоёмкость:** M.

## Low

- **L1. 26 FK-колонок без индекса, где они первые.** Колонки в живых схемах, у которых нет индекса или PK/UNIQUE, начинающегося с этой колонки. Примеры: `billing.purchase_commands.purchase_ref`, `billing.fulfillment_outbox.purchase_ref`, `billing.change_quotes.subscription_ref`, `billing.notices.attempt_ref`, `materials.series_memberships.material_id` (PK начинается с `series_id`), `materials.content_covers.material_id/series_id/topic_id`, `videos.upload_attempts.video_id`, `videos.playback_progress.video_id` (PK `account_id, video_id`), `notifications.email_attempts.delivery_id`, `workshop.hint_reveals.case_version_id`, `member_profiles.avatars.account_id`. Список получен разбором SQL-миграций скриптом, возможны единичные ложные срабатывания. При текущих объёмах некритично, но замедляет удаление родительских строк и выборки по FK. Что сделать: одна миграция с индексами для колонок, по которым реально идут запросы. Трудоёмкость: S.
- **L2. Result-тип объявлен десятки раз.** Форма `{ ok: true; value } | { ok: false; error }` заново объявлена в 60 файлах, есть 10 локальных `failure()`. В materials два result-module: `materials/result.ts` и `shared/application-result.ts` (в последнем на деле лежит transaction runner). Что сделать: один `Result` в `infrastructure/contracts`. Трудоёмкость: S.
- **L3. Branded id в двух стилях.** Шаблон `unique symbol` скопирован в 5 файлов, у каждого по 2 `oxlint-disable`. Videos использует `z.brand` и заново объявляет `VideoAccountId` / `VideoMaterialId`, хотя `AccountId` и `MaterialId` уже есть. Что сделать: один помощник `brandedUuid<Tag>()`. Трудоёмкость: S.
- **L4. Время внедряется по-разному.** `clock`, `clock?` и `now` встречаются 16, 17 и 9 раз, плюс 59 прямых `new Date()` в коде module. Это противоречит правилу «одно чтение часов» из корневого `CODING_STANDARDS.md` там, где проверяются пары границ. Трудоёмкость: S–M.
- **L5. N+1 на пути запроса.** `workshop/facets/workshop-material-access/assemble-workshop-material-access.ts:28-45`: `resolveCurrentCaseVersionAccess` и `findUnique` на каждую связь. Остальные запросы в циклах (billing-payments, tribute-sources, notifications, cleanup) — это обходы с ограниченным пакетом 20–100 строк, для worker это допустимо. Трудоёмкость: S.
- **L6. Импорт Guide Artifact не атомарен.** `assemble-guide-artifacts.ts` начиная с 758 делает до 250 последовательных транзакций плюс записи в хранилище. Сбой оставляет частично применённый импорт, а `placeInGuide` выполняется вне транзакции. Трудоёмкость: M.
- **L7. У `@inside/material-blocks` нет собственных тестов.** 1 787 строк, 0 тестовых файлов в пакете. Проверяется только через `apps/backend/test/unit/material-body.test.ts` и 3 теста web. Реестр блоков — общий контракт двух приложений (ADR 0023), и тесты на уровне пакета ловили бы регрессию до сборки приложений. Трудоёмкость: S.
- **L8. Мелкие несоответствия.**
  - `modules/identity-principals` содержит только замороженную миграцию; схема удалена в `accounts/.../0004_accounts.ts:75`.
  - Словарь расходится: «Guide» (`CONTEXT.md:88`) против `series` в коде; в materials 64 файла на «guide» и 69 на «series».
  - Capability-scoped типы Prisma лежат в двух местах: централизованно в `infrastructure/prisma/prisma-client.ts` и локально в `workshop/infrastructure/prisma.ts` и `membership-entitlements/infrastructure/prisma.ts`.
  - `infrastructure/notification-transport/worker.ts:4` импортирует типы из `modules/notifications`, то есть зависимость направлена от infrastructure к module.
- **L9. `videos/features/request-video-deletion/request-video-deletion.ts:45-70`: проверка и запись в несколько шагов.** Безопасно только потому, что вызывающий (save) передаёт свою транзакцию и держит блокировку Material. Сама функция это не требует и не проверяет. Трудоёмкость: S.

## Что сделано хорошо
- **TypeScript.** Ноль `any`, `!` и `ts-ignore` в production-коде. Все `oxlint-disable` объяснены. Внешние данные проходят через zod, есть 200 выводов типов из схем, 35 проверок полноты union.
- **Границы module.** Deep imports между module отсутствуют и проверяются guardrail с отрицательными fixtures. Capability-scoped Prisma соблюдён: `PlatformPrisma` в modules встречается только в двух файлах локальных scope-типов.
- **Транзакции.** Внешние HTTP, email и Telegram не вызываются внутри транзакций, а находятся между двумя фиксациями (`dispatch-email.ts:70-99`, `execute-refund.ts`). Идемпотентность держится на таблицах квитанций с отпечатком.
- **Конфигурация.** Один владелец, `config/platform-config.ts` на zod. В production отсутствие значения — ошибка. Modules не читают `process.env`.
- **Deep module.** `published-material-projection.ts` оправдывает свой размер: шесть селекторов на одном `projectionQuery`.

## Рекомендуемый порядок
1. H1 — reporter сбоев, журнал запросов и ошибки запуска worker. Больше всего пользы, ADR не затрагивает.
2. H2 и H3 — одно interface изменения ссылок Material с транзакцией вызывающего и именованным ключом блокировки.
3. M6 — вероятный дефект снятия с публикации; сначала подтвердить тестом.
4. M9 — форматтер, до крупных переносов, чтобы diff переносов были чистыми.
5. M1 и M2 — проверка циклов в guardrail и сужение interface Materials; затем M3 и M4.
