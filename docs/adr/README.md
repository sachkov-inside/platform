# Указатель архитектурных решений

В корпусе 46 ADR: 39 Platform, 4 исторических Workspace и 3 Telegram. Номера уникальны
внутри своего каталога: «Telegram 0001» и «Platform 0001» являются разными решениями.
Пропуск Platform 0018 не заполняется переименованием существующих документов.

`accepted` означает, что решение сохраняет силу в указанной области. Более поздняя поправка
может заменить часть решения, сохранив остальные границы. `superseded by ADR-NNNN` направляет
к замене, а `deprecated` означает, что прежний путь выведен из текущей модели без отдельного
замещающего ADR. Старое обоснование сохраняется как история.

Текущие продуктовые правила доступа принадлежат
[модели доступа](../product/access-model.md#единая-выдача-доступа-решение-владельца-23102026).
[ADR 0040](0040-unified-product-access.md) заменяет ADR 0033, 0034 и 0037 и сохраняет
действующие границы Product, сообщества и отзыва доступа.
Текущий состав владельцев находится в [карте контекстов](../product/domain-context-map.md).
Этот указатель помогает читать решения, но не дублирует их нормативные контракты.

[Аудит 28.10.2026](../research/2026-10-28-adr-audit.md) объясняет проверенные расхождения,
выполненную редактуру и границы проверки. Проверка проведена по checkout, без аудита production.

## Platform

| ADR | Статус | Результат проверки и область действия |
|---|---|---|
| [0001: One backend codebase with demand-driven process entrypoints](0001-one-backend-multiple-entrypoints.md) | `accepted` | Сохраняется; текущий состав процессов указан в Compose. |
| [0002: One deep Materials module with an internal versioned body schema](0002-deep-materials-module.md) | `superseded by ADR-0009` | Заменён целиком ADR 0009. |
| [0003: One PostgreSQL schema per state-owning module](0003-one-postgresql-schema-per-state-owning-module.md) | `accepted` | Граница схем сохранена; перечень владельцев заменён ссылкой на карту контекстов. |
| [0004: Feature-first backend modules with DI at real seams](0004-feature-first-backend-modules.md) | `accepted` | Сохраняется; критерии в стандартах backend. |
| [0005: Use Prisma directly in backend use cases](0005-prisma-in-use-cases.md) | `accepted` | Сохраняется; текущие схемы у владельца, передачу транзакции уточняет ADR 0039. |
| [0006: Logto владеет сессией входа, Platform хранит один Account](0006-logto-session-and-local-account.md) | `accepted` | Сведены правила единого Account и первого email; прежний единственный permission не закреплён. |
| [0007: Generate the Web transport contract from Nest OpenAPI](0007-generated-openapi-web-transport.md) | `superseded by ADR-0011` | Заменён целиком ADR 0011. |
| [0008: Separate stable and Next-managed TypeScript projects](0008-separate-stable-and-next-managed-typescript-projects.md) | `superseded by ADR-0010` | История checker; разделение конфигураций явно сохранён в ADR 0010. |
| [0009: Keep one deep Materials module around one mutable Material](0009-one-mutable-material.md) | `accepted` | Сохраняется; блоки уточнены ADR 0023, Products выделен отдельно. |
| [0010: Use one TypeScript 7 and Oxc toolchain](0010-single-typescript-7-oxc-toolchain.md) | `accepted` | Сохраняется единый toolchain и разделение editor/Next configs. |
| [0011: Keep the Library catalog client-owned](0011-client-owned-library-catalog.md) | `accepted` | Сохраняется; пределы клиентского каталога названы явно. |
| [0012: Keep interactive Web mutations browser-owned](0012-browser-owned-interactive-mutations.md) | `accepted` | Сохраняется путь браузерной записи, разбор ввода согласован с ADR 0038. |
| [0013: Publish immutable ordinal release artifacts from exact main](0013-immutable-ordinal-release-artifacts.md) | `accepted` | Сохраняется; bundle и доставка уточнены ADR 0015, Telegram имеет отдельные теги. |
| [0014: Bind the production runtime to one immutable release and schema identity](0014-manifest-bound-production-runtime.md) | `accepted` | Сохраняются identity/readiness; список процессов принадлежит Compose. |
| [0015: Serialize manifest-bound deployment and keep rollback explicit and bounded](0015-serialized-manifest-deployment-and-bounded-rollback.md) | `accepted` | Сохраняется; процедуры принадлежат production runbook. |
| [0016: Use one public ContentLibrary read model with aggregate-owned covers](0016-one-public-content-library-read-model.md) | `accepted` | Общий read model сохранён; выбор обложки отделён от общего lifecycle Content Covers. |
| [0017: Состояние изучения и атомарная история переходов](0017-reading-state-and-transition-history.md) | `accepted` | Убрано обещание будущей реализации; сохранены состояние, история и Product Learning Started. |
| [0019: Run the Workshop evaluator as a pinned native Go CLI](0019-pinned-native-go-workshop-evaluator.md) | `superseded by ADR-0020` | История evaluator; цепочка 0019 → 0020 → 0033, Мастерская отменена. |
| [0020: Defer Kafka Case evaluation until the CaseSpec is accepted](0020-defer-kafka-case-evaluation-until-casespec.md) | `superseded by ADR-0033` | История отсрочки; Мастерская отменена ADR 0033. |
| [0021: Общий модуль Notifications с RabbitMQ](0021-rabbitmq-notifications-module.md) | `accepted` | Сформулированы границы реализованного Notifications и транспорта, без списка будущих задач. |
| [0022: Доставка прав сообщества принадлежит Telegram Integration](0022-community-delivery-state-in-telegram-membership.md) | `accepted` | Сохранён владелец доставки; Account Rights и Product Access отделены от состояния провайдера. |
| [0023: Один реестр блоков за границей MaterialBody](0023-material-block-registry-package.md) | `accepted` | Сохранён единый реестр; исходный этап Markdown отделён от нынешней границы импорта. |
| [0024: Один пакет словаря прав доступа](0024-one-access-capability-vocabulary.md) | `accepted` | Обновлены словарь и явные capabilities, прежняя неявная выдача community не предписывается. |
| [0025: Свой RabbitMQ окружения на одном узле VPS](0025-own-single-node-rabbitmq-broker.md) | `accepted` | Топология одного узла сохранена; размер VPS и отсутствие мониторинга датированы как история. |
| [0026: Страница продукта из данных источника](0026-guide-page-from-source-data.md) | `accepted` | Описание страницы, source ownership и fallback сведены без старых правил продажи Offer. |
| [0027: Навигация и кеширование web](0027-web-navigation-and-caching.md) | `accepted` | Сокращён до решения, компромиссов кеша и условий пересмотра; история замеров сохранена. |
| [0028: Защита входа web: HSTS, CSP и ограничение частоты](0028-web-edge-hardening.md) | `accepted` | Сокращён до выбора edge/CSP/лимитов и условий пересмотра; точная политика в конфигурации приложения. |
| [0029: Ацикличные зависимости между Modules](0029-acyclic-module-dependencies.md) | `accepted` | Сохранены ацикличность и публичный interface, убрана прежняя сборка модулей из текущих указаний. |
| [0030: Задание имеет отдельного владельца и жизненный цикл](0030-guide-task-module.md) | `accepted` | Сформулирован текущий владелец Product Tasks без прежних связей Materials/Guide. |
| [0031: Platform владеет кодом продукта и общими документами Inside](0031-inside-product-monorepo.md) | `accepted` | Сформулирована завершённая миграция; временное merge-исключение не является действующим. |
| [0032: HTTP/1.1 для исходящего fetch серверного web](0032-web-http1-logto-sdk.md) | `accepted` | Сохраняется workaround; отменять после проверки callback/refresh/sign-out. |
| [0033: Модель продукта: продукты, тарифы и способы оплаты; мастерской нет](0033-product-tariff-payment-model.md) | `superseded by ADR-0040` | История; все сохраняемые границы явно перенесены в ADR 0040. |
| [0034: Explicit Product community rights and whole-Product revocation](0034-product-community-and-product-revocation.md) | `superseded by ADR-0040` | История; владение community и учебными фактами сохранено в ADR 0040. |
| [0035: Separate Product catalogue, programme placements and chapter attachments](0035-product-catalogue-programme-and-attachments.md) | `accepted` | Сохраняются каталог, позиции и вложения; статус приведён к общему формату. |
| [0036: Единственная рабочая площадка в Амстердаме](0036-amsterdam-production-placement.md) | `accepted` | Сохраняется размещение; текущее восстановление принадлежит runbook. |
| [0037: Products without subscription commerce](0037-products-without-subscriptions.md) | `superseded by ADR-0040` | История; единая действующая модель записана в ADR 0040. |
| [0038: One definition per same-origin browser mutation](0038-one-definition-per-browser-mutation.md) | `accepted` | Сохраняется единое определение операции; уточняет ADR 0012. |
| [0039: Opaque transaction handoff between state owners](0039-opaque-transaction-handoff.md) | `accepted` | Сохраняется opaque transaction handoff; уточняет ADR 0005. |
| [0040: Единый Product Access без тарифов и подписок](0040-unified-product-access.md) | `accepted` | Оформляет принятое 23.10.2026 решение; полностью заменяет 0033, 0034 и 0037. |

## Workspace

Исходные номера и provenance сохранены в [отдельном индексе](workspace/README.md).

| ADR | Статус | Результат проверки и область действия |
|---|---|---|
| [0001: владелец brief](workspace/0001-platform-owns-product-brief.md) | `superseded by ADR-0031` | История распределения документов; отдельный brief Platform сохраняется. |
| [0002: проекция Membership](workspace/0002-project-telegram-membership-events-into-postgresql.md) | `deprecated` | Мост доступа по evidence отменён; его срок сверки не правило Product Access. |
| [0003: RabbitMQ](workspace/0003-rabbitmq-product-notifications.md) | `accepted` | Выбор транспорта сохраняется; runtime описывают Platform 0021/0025. |
| [0004: типизированные блоки](workspace/0004-typed-blocks-for-interactive-materials.md) | `accepted` | Граница авторства сохраняется; две копии схемы являются историей до Platform 0023. |

## Telegram

| ADR | Статус | Результат проверки и область действия |
|---|---|---|
| [0001: вход без сверки кода](../../apps/telegram/docs/adr/0001-bot-sign-in-without-confirmation-code.md) | `accepted` | Риск принят явно; условия пересмотра сохраняются. Аудит не переоценивает этот риск за владельца. |
| [0002: граница durable-queue](../../apps/telegram/docs/adr/0002-durable-queue-boundary.md) | `accepted` | Оставлены критерии повтора и неизвестного результата; прежний перечень очередей вынесен в историю. |
| [0003: lock доставки evidence](../../apps/telegram/docs/adr/0003-evidence-delivery-lock.md) | `deprecated` | Путь доставки выведен из runtime; ADR сохраняет прежний компромисс. |
