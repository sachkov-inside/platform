# Инженерное ревью Sachkov Inside — 2026-09-24

> Историческое исследование на указанную в документе дату. Оно не задаёт текущие правила.
> Источник: [Workspace](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/2026-09-24-engineering-review/README.md); текущие правила — [документы Platform](../../../README.md).

Сводка семи независимых проверок, выполненных только чтением: код, конфиги, история CI и
GitHub Projects. Код, issues и Project fields не менялись. Снимки: platform `6ce6b22f`,
telegram `9a2a4e5`, landing `f227684`; GitHub — 24.09 около 14:20 UTC.

Подробные отчёты лежат рядом. Отчёт по безопасности не публикуется: repositories открыты, а часть
находок ещё не исправлена. Он хранится локально у владельца и будет добавлен после исправлений.

| Направление | Файл |
|---|---|
| Архитектура backend и packages platform (по `improve-codebase-architecture`) | [backend.md](backend.md), [architecture-backend.html](architecture-backend.html) |
| Frontend platform и landing | [web.md](web.md) |
| Версии зависимостей, строгость TypeScript, линтинг | [deps-typescript.md](deps-typescript.md) |
| Тесты и CI | [tests-ci.md](tests-ci.md) |
| Telegram целиком | [telegram.md](telegram.md) |
| Доски и Developer Pipeline | [board-pipeline.md](board-pipeline.md) |

## Итог

Основа сильная. В рабочем коде platform ноль `any`, `!` и `ts-ignore`. Слои FSD в web не
нарушены. Авторизация проверяется на всех controllers backend, подписи платежей T-Bank и
идемпотентность корректны. Telegram хранит updates надёжно и использует transactional outbox.
Critical- и High-находок по безопасности нет.

Слабые места в другом: надёжность под нагрузкой, наблюдаемость сбоев, скорость CI и порядок
в очереди задач. Стек почти актуален, но разошёлся между repositories: NestJS 11 и 12,
TypeScript 7 и 6, Node 24 и 22, pnpm и npm.

## Решения владельца 2026-09-24

- Публичность `workspace`, `platform` и `inside-telegram` задумана; `REPOSITORIES.md` исправлен.
- Подтверждение входа в боте остаётся без кода сверки; принятый риск записывается ADR в inside-telegram.
- Merge PR задач программы разрешён заранее после `Ready and Done`; деплой и релиз — отдельно.
- Приоритеты на досках агент расставляет по плану ревью.
- Merge queue в platform, Prettier во всех repositories с кодом, обязательные проверки в inside-telegram.
- Landing устарел с 2026-09-15 и в программу не входит. Выбор шрифта Manrope записан на будущее.

## Задачи

Родительская задача: [workspace#209](https://github.com/sachkov-inside/workspace/issues/209).

| Задача | Приоритет | Зависит от |
|---|---|---|
| [workspace#210](https://github.com/sachkov-inside/workspace/issues/210) Порядок на досках и в документах | Now | — |
| [workspace#211](https://github.com/sachkov-inside/workspace/issues/211) Harness 0.4.8: приёмка, actions по SHA, health в CI | Now | — |
| [platform#688](https://github.com/sachkov-inside/platform/issues/688) Укрепление защиты platform | Now | — |
| [platform#689](https://github.com/sachkov-inside/platform/issues/689) Атомарное сохранение материала | Now | — |
| [platform#691](https://github.com/sachkov-inside/platform/issues/691) CI за 6 минут, merge queue | Now | — |
| [platform#692](https://github.com/sachkov-inside/platform/issues/692) Web: мигание, LCP, страницы ошибок | Now | — |
| [platform#690](https://github.com/sachkov-inside/platform/issues/690) Сбои зависимостей видны в логе | Next | лучше после #689 |
| [platform#693](https://github.com/sachkov-inside/platform/issues/693) Актуальный стек, строгий tsconfig, Prettier | Next | #691 |
| [platform#694](https://github.com/sachkov-inside/platform/issues/694) Строгие правила линта | Later | #693 |
| [platform#695](https://github.com/sachkov-inside/platform/issues/695) Interface Materials и сборка Guide | Later | #689, #690 |
| [inside-telegram#80](https://github.com/sachkov-inside/inside-telegram/issues/80) Конфигурация бота и ADR о входе | Now | — |
| [inside-telegram#81](https://github.com/sachkov-inside/inside-telegram/issues/81) Воронки не блокируют `/start` | Now | — |
| [inside-telegram#82](https://github.com/sachkov-inside/inside-telegram/issues/82) Надёжность при деплое и сбоях | Next | #81 |
| [inside-telegram#83](https://github.com/sachkov-inside/inside-telegram/issues/83) Модули-владельцы и state machine автора | Later | #82 |
| [inside-telegram#84](https://github.com/sachkov-inside/inside-telegram/issues/84) Актуальный стек и гейт CI | Later | #83 |

## Приоритеты

### Сейчас: риски для людей и денег, небольшие правки

| # | Что | Repository | Источник | Трудоёмкость |
|---|---|---|---|---|
| 1 | Укрепить конфигурацию бота | telegram | security | S |
| 2 | Закрепить сторонние actions по SHA | все | security | S |
| 3 | Обновить зависимости с предупреждениями audit, заголовки защиты | platform | security | S |
| 4 | Исправить дубль ADR 0026 и добавить `inside-harness health` в CI platform | platform | board H3 | S |
| 5 | Транзакция `save-material`: `markUnreferenced` открывает свою транзакцию и не откатывается вместе с save | platform | backend H2 | M |
| 6 | Не сбрасывать статус входа при возврате во вкладку: личные блоки мигают | platform web | web H1 | S |
| 7 | Разобрать очередь: Priority и Area у 23 открытых issue, хотя бы одна `Now` | доски | board H1 | S |

### Далее: надёжность, скорость CI, наблюдаемость

- **Наблюдаемость сбоев.** В backend platform 176 пустых `catch`, в telegram 53. Нет logger
  и request id, а причина ошибки теряется. Нужен один module для сбоя зависимости, который записывает
  причину и возвращает вариант union (кандидат 1 в HTML-отчёте).
- **Планировщик воронок telegram.** Под глобальной блокировкой он пересчитывает всех
  получателей через N+1 запросы. Первая большая рассылка остановит `/start`, вход и привязку.
  Нужно исправить до включения маркетинговых рассылок.
- **Именованные ключи блокировок** вместо совпадения строки `hashtextextended(materialId)`
  в трёх модулях (backend H3).
- **CI platform.** Разбить `pnpm check` на параллельные jobs. Для integration-тестов один раз
  мигрировать шаблон базы. Вынести тесты брокера в последовательный набор, это лечит
  flake `notification-transport`. Выключить rebase у Dependabot. Цель — около 5–6 минут вместо 10.
- **Гейт в telegram.** Сейчас там нет ни branch protection, ни обязательных проверок.
- **Web.** Приоритет загрузки обложки первого экрана, `not-found`/`global-error`, сбор
  Core Web Vitals с реальных посещений.

### Потом: единый современный стек и максимальная строгость

Порядок взят из [deps-typescript.md](deps-typescript.md#5-план-обновлений-по-порядку):

1. Все patch/minor, Node 24.21.0 и pnpm 11.27.1 в platform и telegram.
2. Общий `tsconfig.base.json` с бесплатными флагами. `verbatimModuleSyntax`, `isolatedModules`
   и `noUnusedLocals/Parameters` дают всего 1 ошибку. `packages/legal` и
   `packages/access-capabilities` добавить под type-aware lint.
3. NestJS 12 в platform. `@nestjs/swagger` 12 требует TS ≤ 6, а в platform TS 7 и strict peers.
   Нужен `peerDependencyRules`, swagger обновляется только вместе с core. Отдельно amqplib 2.
4. Telegram: сначала линт на oxlint + tsgolint (typescript-eslint не пускает TS 7),
   потом убрать 146 `!` в `communications`, затем TS 7 и `exactOptionalPropertyTypes`.
5. Landing устарел: находки по нему в [web.md](web.md) сохраняются на случай возврата.
6. Строгие правила линта по одному на PR: `no-unsafe-type-assertion` в web (72),
   `no-unnecessary-condition` (68), `strict-boolean-expressions` (277), затем
   `noPropertyAccessFromIndexSignature` (743, механически).
7. vitest 5 во всех repositories сразу, затем pnpm 12; Node 26 LTS после выхода в конце октября.

Архитектурные углубления (подробно в HTML-отчёте и [telegram.md](telegram.md)):
- **platform:** единый interface изменения ссылок Material. Оно берёт транзакцию вызывающего
  и именованный ключ блокировки. Сузить экспорт Materials: 106 из 188 символов не
  используются снаружи. Разбить `assembleGuideArtifacts` на 847 строк.
- **telegram:** один module для durable-очередей в PostgreSQL (сейчас 7 копий); модули-владельцы
  для reply outbox и PlatformLink; типизированная state machine автора.

## Итог исполнения (2026-09-27)

Программа [workspace#209](https://github.com/sachkov-inside/workspace/issues/209) выполнена: из 43
задач закрыты 42, открытой осталась [platform#713](https://github.com/sachkov-inside/platform/issues/713).
Её владелец решил отложить до выхода механизма nonce/hash в стабильном Next.js: замеры и условие
пересмотра записаны в ADR 0028 platform. Каждая задача закрыта своим PR после зелёного CI и ревью по
Standards и Spec.

| Направление | Что стало |
|---|---|
| Безопасность | Actions и базовые образы закреплены по SHA/digest; HSTS; production-контейнеры с `cap_drop`, лимитами и `read_only`; `pnpm audit` чистый; ограничение частоты входа, оплаты и ссылок рассылки в web и запросов к боту (10 за 10 с); секреты бота от 32 символов и раздельные; evidence только по HTTPS; ротация журналов Docker на хосте. Подтверждение входа в боте без кода сверки — принятый риск (ADR-0001 inside-telegram). |
| Надёжность и данные | Save материала атомарен с assets и видео; ключи advisory lock из одного источника; чтения чужих Module не держат второе соединение под транзакцией; сбой зависимости виден в журнале с причиной и request id; бот: общий durable-queue, очереди по отправителю, корректная остановка при деплое, классификация сбоев, сроки хранения истории. |
| Производительность | Рассылка воронки больше не блокирует `/start` (14–15 с → 4–5 мс на 5000 контактов); простой бота 110 → 9,7 SQL/с; web без мигания личных блоков и лишней гидрации, обложка первого экрана с приоритетом. |
| Архитектура | Граф Module backend ацикличен (guardrail); убраны 262 неиспользуемых экспорта; сборка Guide и видео разбита на шаги; одна форма problem-ответов `urn:inside:problem:<code>`; у данных бота модули-владельцы, диалог автора — чистая `transition`. |
| Стек и строгость | platform: Nest 12.1, amqplib 2, Node 24.21, pnpm 11.27, Go 1.27, общий `tsconfig.base`, type-aware lint везде (включая `.mjs`), `strict-boolean-expressions`, `noPropertyAccessFromIndexSignature`, Prettier. telegram: oxlint + tsgolint, TypeScript 7, 0 `!`, тот же строгий линт для тестов. |
| Тесты и CI | CI platform ~5,5 мин вместо 10; merge queue; нестабильные тесты устранены по причине; сквозной smoke снова зелёный; dev/test-хранилище RustFS вместо недоступного MinIO; гейт CI в telegram. |
| Процесс | Harness 0.4.9–0.4.12: трекер переживает обрывы GitHub API, статус «ждёт приёмки», `health` в CI, закреплённые runner и actions; доски: у всех открытых issue есть Priority, Area и тип. |
| Продукт (по решениям владельца) | В Telegram-админку возвращены полноценные настройки воронки и работа с рассылками (сохранённые посты, правка, создание, пакетная). |

Условия выкладки, которые остаются за владельцем, записаны в
[#209](https://github.com/sachkov-inside/workspace/issues/209): согласованная смена секрета рассылок
Telegram/Platform и применение ротации журналов Docker на сервере.
