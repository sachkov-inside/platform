# Перенос общих документов Inside: platform#958

Этап документов входит в [platform#957](https://github.com/sachkov-inside/platform/issues/957)
по [workspace#253](https://github.com/sachkov-inside/workspace/issues/253).
Документы взяты из публичного репозитория `sachkov-inside/workspace` на commit `125cbde1631a0c9c314a29c829961ab8aa785a06`.
Исходный `origin/main` Platform перед работой: `cdd8e4c604fc5dd80106768fa1a79a2f9035f8c0`.

## Граница этапа и обратимость

Platform получает общие документы, сохраняя отдельный [brief приложения](../product/platform-mvp-brief.md).
[Общий brief Inside](../product/README.md), [оплата](../product/subscription-billing-v1.md),
[доступ](../product/access-model.md), [юридический индекс](../legal/README.md)
и [GLOSSARY](../../GLOSSARY.md) владеют разными фактами.
Прежние пути юридических источников остаются в истории Workspace; номера, статусы и тексты редакций не переутверждаются.
Публичные страницы и пакет `@inside/legal` этот этап не меняет.

Источники пока доступны. Откат PR возвращает прежнее распределение документов;
исходный commit позволяет восстановить каждый файл.
Telegram ещё не импортирован. CI и выпуск Telegram, перенос задач, архивирование источников
и локальная топология здесь не выполняются.
Принятый дальнейший порядок описывает [ADR 0031](../adr/0031-inside-product-monorepo.md).

## Сопоставление пересекающихся спецификаций

| Источник Workspace | Сохранение и текущий владелец | Различие содержания |
|---|---|---|
| `platform-v1.md` | [Общая историческая версия](../history/workspace/specifications/platform-v1.md); [текущая версия Platform](../specifications/platform-v1.md) | Исходная архитектура и план 2026-08-30/09-06 содержат immutable revisions, Kysely и ранний Membership scope. Platform #27/#132 и ADR 0005/0009 задают Prisma и mutable Material; текущие оплаты и права уточняет модель доступа. Исходный план не возвращается. |
| `notifications-v1.md` | [Общая историческая версия](../history/workspace/specifications/notifications-v1.md); [Notifications Platform](../specifications/notifications-v1.md) и [wire bundle](../contracts/notifications-v1/README.md) | Workspace #152 задавал два источника и два канала. Platform #434/#436 уточняет facets, authorizeDispatch, outbox/inbox и runtime. Оба источника сохраняются; перенос не создаёт второй runtime-контракт. |
| `production-workshop-v1.md` | [Общая историческая версия](../history/workspace/specifications/production-workshop-v1.md); [история case-first](../specifications/production-workshop-v1.md), [Workshop Tracks](../specifications/workshop-tracks.md) | Workspace #108 описывает Tracks, Laboratories и Kafka; прежний Platform #258 описывал один Partner Webhooks case. Оба плана отложены. Текущий brief не обещает Workshop в запускаемой подписке; существующие foundations сохраняются. |

Исторические источники читаются вместе с действующим владельцем. Исследования остаются свидетельствами на исходную дату.
Их советы о библиотеке, инфраструктуре или процессе не становятся текущими инструкциями.
Статусы перенесённых ADR перечислены в [индексе](../adr/workspace/README.md).
Общие контрактные schemas/fixtures Identity/Membership сохранены для прежнего пути;
[исторический subscription-access](../contracts/subscription-access-v1.md) уже был заменён моделью доступа.

## Сопоставление терминов

Исходный `CONTEXT.md` содержит 50 определений. Каждое соответствует одному определению GLOSSARY или совместимому имени.
Product и Guide обозначают одну программу; Format «Гайд» остаётся форматом Material.
Имена со пробелом и camelCase не создают разные права.
Владелец подтвердил состав конкретного тарифа 2026-10-05 в
[Platform #958](https://github.com/sachkov-inside/platform/issues/958), часть
[#957](https://github.com/sachkov-inside/platform/issues/957).
Новые продукты включаются отдельным решением владельца. Вариант «все будущие продукты» не выбран.
Решение записано в модели доступа и согласовано с общим brief и GLOSSARY.
Допуск к подписке отдельно уточняют уже принятые Platform #907/#908/#910: все или личное приглашение;
прежний Tribute-путь сохраняется для исторических условий.
Product Purchase и Guide Purchase соответствуют OneTimePurchase как покупке по принятому Offer,
отдельной от платежа и выданных прав. Определение OneTimePurchase исправлено без изменения wire-имён.
Workshop отмечен как отложенное направление. MembershipEvidence остаётся основанием прежнего пути,
а платежи и назначения не выводятся из присутствия в Telegram.
Member Profile виден только владельцу по Workspace #185/Platform #658; прежняя member-visible модель CONTEXT заменена.
При переносе Identity/Membership-контракта это изменение отмечено отдельно от неизменных wire schemas.
Два прежних определения `Billing Contact` и `BillingContact` сведены к одному; второе имя сохранено как совместимое.

| Термин исходного CONTEXT | Термин GLOSSARY |
|---|---|
| Product | Product |
| Product Purchase | OneTimePurchase |
| Inside Subscription | Subscription |
| Offer | Offer |
| Offer Eligibility | Offer Eligibility |
| Access Scope | AccessScope |
| Subscription Tier | Subscription Tier |
| Content Scope | ContentScope |
| Subscription Enrollment | SubscriptionEnrollment |
| Support | Support |
| Community Entitlement | CommunityEntitlement |
| Admission Restriction | AdmissionRestriction |
| Subscription Option | Subscription Option |
| Access Grant | AccessGrant |
| Lifetime Access Grant | Lifetime Access Grant |
| Direct Right | Direct Right |
| SourceEntitlement | SourceEntitlement |
| Account | Account |
| TelegramIdentity | TelegramIdentity |
| Member Profile | Member Profile |
| Membership Signal | Membership Signal |
| MembershipObservation | MembershipObservation |
| MembershipEvidence | MembershipEvidence |
| MembershipEntitlement | MembershipEntitlement |
| Canonical Membership Chat | Canonical Membership Chat |
| Material | Material |
| Guide | Guide |
| Guide Chapter | Guide Chapter |
| Supplementary Material | Supplementary Material |
| Guide Artifact | Guide Artifact |
| Guide Step Sequence | Guide Step Sequence |
| Guide Purchase | OneTimePurchase |
| Topic | Topic |
| Format | Format |
| Tag | Tag |
| ContentAccess | ContentAccess |
| Subject | Subject |
| Resource | Resource |
| AccessDecision | AccessDecision |
| Workshop | Workshop |
| Workshop Track | Workshop Track |
| Track Item | Track Item |
| Laboratory | Laboratory |
| Production Case | Production Case |
| Case Variant | Case Variant |
| Workshop Entitlement | WorkshopEntitlement |
| Workshop Resource | WorkshopResource |
| WorkshopAccess | WorkshopAccess |
| Notification | Notification |
| Notification Delivery | Notification Delivery |

## Учёт всех 97 tracked-файлов

Список получен из дерева исходного commit. Каждая ссылка на исходный путь закрепляет commit и путь.
«Остаётся в истории» означает явное сохранение исходника без добавления второго активного владельца.
Исполняемый Kinescope-прототип и локальная конфигурация Workspace не импортируются в runtime Platform.

| № | Исходный путь и provenance | Новый путь или причина сохранения |
|---|---|---|
| 1 | [`.gitignore`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/.gitignore) | История Workspace. Остаётся в истории Workspace. Локальная конфигурация или исследовательский исполняемый прототип; не часть runtime Platform |
| 2 | [`AGENTS.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/AGENTS.md) | [AGENTS.md](../../AGENTS.md). Роутер объединён с правилами Platform; исходник остаётся в истории Workspace |
| 3 | [`CLAUDE.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/CLAUDE.md) | [AGENTS.md](../../AGENTS.md). Роутер объединён с правилами Platform; исходник остаётся в истории Workspace |
| 4 | [`CONTEXT.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/CONTEXT.md) | [GLOSSARY.md](../../GLOSSARY.md). Термины объединены; [карта соответствий](#сопоставление-терминов) |
| 5 | [`README.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/README.md) | [README.md](../../README.md). Роутер объединён с правилами Platform; исходник остаётся в истории Workspace |
| 6 | [`REPOSITORIES.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/REPOSITORIES.md) | [REPOSITORIES.md](../../REPOSITORIES.md). Карта переписана для переходного этапа |
| 7 | [`docs/adr/0001-platform-owns-product-brief.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/adr/0001-platform-owns-product-brief.md) | [docs/adr/workspace/0001-platform-owns-product-brief.md](../adr/workspace/0001-platform-owns-product-brief.md). Историческое решение; текущий статус в индексе |
| 8 | [`docs/adr/0002-project-telegram-membership-events-into-postgresql.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/adr/0002-project-telegram-membership-events-into-postgresql.md) | [docs/adr/workspace/0002-project-telegram-membership-events-into-postgresql.md](../adr/workspace/0002-project-telegram-membership-events-into-postgresql.md). Историческое решение; текущий статус в индексе |
| 9 | [`docs/adr/0003-rabbitmq-product-notifications.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/adr/0003-rabbitmq-product-notifications.md) | [docs/adr/workspace/0003-rabbitmq-product-notifications.md](../adr/workspace/0003-rabbitmq-product-notifications.md). Историческое решение; текущий статус в индексе |
| 10 | [`docs/adr/0004-typed-blocks-for-interactive-materials.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/adr/0004-typed-blocks-for-interactive-materials.md) | [docs/adr/workspace/0004-typed-blocks-for-interactive-materials.md](../adr/workspace/0004-typed-blocks-for-interactive-materials.md). Историческое решение; текущий статус в индексе |
| 11 | [`docs/agents/domain.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/agents/domain.md) | [docs/agents/domain.md](../agents/domain.md). Роутер объединён с правилами Platform; исходник остаётся в истории Workspace |
| 12 | [`docs/contracts/identity-membership-v1.fixtures.json`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/contracts/identity-membership-v1.fixtures.json) | [docs/contracts/identity-membership-v1.fixtures.json](../contracts/inside-membership-evidence-v1/fixtures.json). Контракт; область применимости сохранена |
| 13 | [`docs/contracts/identity-membership-v1.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/contracts/identity-membership-v1.md) | [docs/contracts/identity-membership-v1.md](../contracts/identity-membership-v1.md). Контракт; область применимости сохранена |
| 14 | [`docs/contracts/identity-membership-v1.schema.json`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/contracts/identity-membership-v1.schema.json) | [docs/contracts/identity-membership-v1.schema.json](../contracts/inside-membership-evidence-v1/schema.json). Контракт; область применимости сохранена |
| 15 | [`docs/contracts/subscription-access-v1.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/contracts/subscription-access-v1.md) | [docs/contracts/subscription-access-v1.md](../contracts/subscription-access-v1.md). Контракт; область применимости сохранена |
| 16 | [`docs/research/2026-09-05-developer-practice-market.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/2026-09-05-developer-practice-market.md) | [docs/research/2026-09-05-developer-practice-market.md](../research/2026-09-05-developer-practice-market.md). Исследование на исходную дату; не действующее правило |
| 17 | [`docs/research/2026-09-06-telegram-auth-russia-product-options.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/2026-09-06-telegram-auth-russia-product-options.md) | [docs/research/2026-09-06-telegram-auth-russia-product-options.md](../research/2026-09-06-telegram-auth-russia-product-options.md). Исследование на исходную дату; не действующее правило |
| 18 | [`docs/research/2026-09-06-telegram-entry-technical-options.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/2026-09-06-telegram-entry-technical-options.md) | [docs/research/2026-09-06-telegram-entry-technical-options.md](../research/2026-09-06-telegram-entry-technical-options.md). Исследование на исходную дату; не действующее правило |
| 19 | [`docs/research/2026-09-24-agent-knowledge-and-doc-drift.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/2026-09-24-agent-knowledge-and-doc-drift.md) | [docs/research/2026-09-24-agent-knowledge-and-doc-drift.md](../research/2026-09-24-agent-knowledge-and-doc-drift.md). Исследование на исходную дату; не действующее правило |
| 20 | [`docs/research/2026-09-24-engineering-review/README.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/2026-09-24-engineering-review/README.md) | [docs/research/2026-09-24-engineering-review/README.md](../research/2026-09-24-engineering-review/README.md). Исследование на исходную дату; не действующее правило |
| 21 | [`docs/research/2026-09-24-engineering-review/architecture-backend.html`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/2026-09-24-engineering-review/architecture-backend.html) | [docs/research/2026-09-24-engineering-review/architecture-backend.html](../research/2026-09-24-engineering-review/architecture-backend.html). Исследование на исходную дату; не действующее правило |
| 22 | [`docs/research/2026-09-24-engineering-review/backend.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/2026-09-24-engineering-review/backend.md) | [docs/research/2026-09-24-engineering-review/backend.md](../research/2026-09-24-engineering-review/backend.md). Исследование на исходную дату; не действующее правило |
| 23 | [`docs/research/2026-09-24-engineering-review/board-pipeline.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/2026-09-24-engineering-review/board-pipeline.md) | [docs/research/2026-09-24-engineering-review/board-pipeline.md](../research/2026-09-24-engineering-review/board-pipeline.md). Исследование на исходную дату; не действующее правило |
| 24 | [`docs/research/2026-09-24-engineering-review/deps-typescript.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/2026-09-24-engineering-review/deps-typescript.md) | [docs/research/2026-09-24-engineering-review/deps-typescript.md](../research/2026-09-24-engineering-review/deps-typescript.md). Исследование на исходную дату; не действующее правило |
| 25 | [`docs/research/2026-09-24-engineering-review/telegram.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/2026-09-24-engineering-review/telegram.md) | [docs/research/2026-09-24-engineering-review/telegram.md](../research/2026-09-24-engineering-review/telegram.md). Исследование на исходную дату; не действующее правило |
| 26 | [`docs/research/2026-09-24-engineering-review/tests-ci.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/2026-09-24-engineering-review/tests-ci.md) | [docs/research/2026-09-24-engineering-review/tests-ci.md](../research/2026-09-24-engineering-review/tests-ci.md). Исследование на исходную дату; не действующее правило |
| 27 | [`docs/research/2026-09-24-engineering-review/web.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/2026-09-24-engineering-review/web.md) | [docs/research/2026-09-24-engineering-review/web.md](../research/2026-09-24-engineering-review/web.md). Исследование на исходную дату; не действующее правило |
| 28 | [`docs/research/2026-09-24-verifying-agent-context-updates.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/2026-09-24-verifying-agent-context-updates.md) | [docs/research/2026-09-24-verifying-agent-context-updates.md](../research/2026-09-24-verifying-agent-context-updates.md). Исследование на исходную дату; не действующее правило |
| 29 | [`docs/research/2026-10-01-perpetual-access-refund.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/2026-10-01-perpetual-access-refund.md) | [docs/research/2026-10-01-perpetual-access-refund.md](../research/2026-10-01-perpetual-access-refund.md). Исследование на исходную дату; не действующее правило |
| 30 | [`docs/research/one-time-product-offer-legal-sources.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/one-time-product-offer-legal-sources.md) | [docs/research/one-time-product-offer-legal-sources.md](../research/one-time-product-offer-legal-sources.md). Исследование на исходную дату; не действующее правило |
| 31 | [`docs/research/plain-russian-agent-dialogue.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/plain-russian-agent-dialogue.md) | [docs/research/plain-russian-agent-dialogue.md](../research/plain-russian-agent-dialogue.md). Исследование на исходную дату; не действующее правило |
| 32 | [`docs/research/platform-content-access.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/platform-content-access.md) | [docs/research/platform-content-access.md](../research/platform-content-access.md). Исследование на исходную дату; не действующее правило |
| 33 | [`docs/research/platform-content-authoring-model.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/platform-content-authoring-model.md) | [docs/research/platform-content-authoring-model.md](../research/platform-content-authoring-model.md). Исследование на исходную дату; не действующее правило |
| 34 | [`docs/research/platform-current-publishing-audit.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/platform-current-publishing-audit.md) | [docs/research/platform-current-publishing-audit.md](../research/platform-current-publishing-audit.md). Исследование на исходную дату; не действующее правило |
| 35 | [`docs/research/platform-delivery-recovery.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/platform-delivery-recovery.md) | [docs/research/platform-delivery-recovery.md](../research/platform-delivery-recovery.md). Исследование на исходную дату; не действующее правило |
| 36 | [`docs/research/platform-identity-architecture.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/platform-identity-architecture.md) | [docs/research/platform-identity-architecture.md](../research/platform-identity-architecture.md). Исследование на исходную дату; не действующее правило |
| 37 | [`docs/research/platform-kinescope-video-lifecycle.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/platform-kinescope-video-lifecycle.md) | [docs/research/platform-kinescope-video-lifecycle.md](../research/platform-kinescope-video-lifecycle.md). Исследование на исходную дату; не действующее правило |
| 38 | [`docs/research/platform-postgresql-data-access.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/platform-postgresql-data-access.md) | [docs/research/platform-postgresql-data-access.md](../research/platform-postgresql-data-access.md). Исследование на исходную дату; не действующее правило |
| 39 | [`docs/research/platform-telegram-tribute-membership.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/platform-telegram-tribute-membership.md) | [docs/research/platform-telegram-tribute-membership.md](../research/platform-telegram-tribute-membership.md). Исследование на исходную дату; не действующее правило |
| 40 | [`docs/specifications/notifications-delivery-v1.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/specifications/notifications-delivery-v1.md) | [docs/specifications/notifications-delivery-v1.md](../specifications/notifications-delivery-v1.md). Общий контракт или исторический план; исходный статус сохранён |
| 41 | [`docs/specifications/notifications-v1.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/specifications/notifications-v1.md) | [docs/history/workspace/specifications/notifications-v1.md](../history/workspace/specifications/notifications-v1.md). Историческая общая спецификация; текущий владелец указан в [сопоставлении](#сопоставление-пересекающихся-спецификаций) |
| 42 | [`docs/specifications/platform-v1.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/specifications/platform-v1.md) | [docs/history/workspace/specifications/platform-v1.md](../history/workspace/specifications/platform-v1.md). Историческая общая спецификация; текущий владелец указан в [сопоставлении](#сопоставление-пересекающихся-спецификаций) |
| 43 | [`docs/specifications/production-workshop-v1.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/specifications/production-workshop-v1.md) | [docs/history/workspace/specifications/production-workshop-v1.md](../history/workspace/specifications/production-workshop-v1.md). Историческая общая спецификация; текущий владелец указан в [сопоставлении](#сопоставление-пересекающихся-спецификаций) |
| 44 | [`docs/specifications/subscription-billing-delivery-v1.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/specifications/subscription-billing-delivery-v1.md) | [docs/specifications/subscription-billing-delivery-v1.md](../specifications/subscription-billing-delivery-v1.md). Общий контракт или исторический план; исходный статус сохранён |
| 45 | [`docs/specifications/telegram-communications-v1.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/specifications/telegram-communications-v1.md) | [docs/specifications/telegram-communications-v1.md](../specifications/telegram-communications-v1.md). Общий контракт или исторический план; исходный статус сохранён |
| 46 | [`inside.code-workspace`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/inside.code-workspace) | История Workspace. Остаётся в истории Workspace. Локальная конфигурация или исследовательский исполняемый прототип; не часть runtime Platform |
| 47 | [`product/README.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/README.md) | [docs/product/README.md](../product/README.md). Общий продуктовый документ |
| 48 | [`product/access-model.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/access-model.md) | [docs/product/access-model.md](../product/access-model.md). Общий продуктовый документ |
| 49 | [`product/content-series-authoring-brief.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/content-series-authoring-brief.md) | [docs/product/content-series-authoring-brief.md](../product/content-series-authoring-brief.md). Общий продуктовый документ |
| 50 | [`product/examples/2026-09-05-series-design-samples.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/examples/2026-09-05-series-design-samples.md) | [docs/product/examples/2026-09-05-series-design-samples.md](../product/examples/2026-09-05-series-design-samples.md). Общий продуктовый документ |
| 51 | [`product/guides-delivery-plan.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/guides-delivery-plan.md) | [docs/product/guides-delivery-plan.md](../product/guides-delivery-plan.md). Общий продуктовый документ |
| 52 | [`product/legal/README.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/README.md) | [docs/legal/README.md](../legal/README.md). Юридический источник; прежний статус сохранён |
| 53 | [`product/legal/consents-inventory.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/consents-inventory.md) | [docs/legal/consents-inventory.md](../legal/consents-inventory.md). Юридический источник; прежний статус сохранён |
| 54 | [`product/legal/consents-requirements.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/consents-requirements.md) | [docs/legal/consents-requirements.md](../legal/consents-requirements.md). Юридический источник; прежний статус сохранён |
| 55 | [`product/legal/consents-unified-path.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/consents-unified-path.md) | [docs/legal/consents-unified-path.md](../legal/consents-unified-path.md). Юридический источник; прежний статус сохранён |
| 56 | [`product/legal/contacts-v1.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/contacts-v1.md) | [docs/legal/contacts-v1.md](../legal/contacts-v1.md). Юридический источник; прежний статус сохранён |
| 57 | [`product/legal/contacts-v2.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/contacts-v2.md) | [docs/legal/contacts-v2.md](../legal/contacts-v2.md). Юридический источник; прежний статус сохранён |
| 58 | [`product/legal/cookies-v1.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/cookies-v1.md) | [docs/legal/cookies-v1.md](../legal/cookies-v1.md). Юридический источник; прежний статус сохранён |
| 59 | [`product/legal/cookies-v2.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/cookies-v2.md) | [docs/legal/cookies-v2.md](../legal/cookies-v2.md). Юридический источник; прежний статус сохранён |
| 60 | [`product/legal/facts-and-applicability.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/facts-and-applicability.md) | [docs/legal/facts-and-applicability.md](../legal/facts-and-applicability.md). Юридический источник; прежний статус сохранён |
| 61 | [`product/legal/fixed-term-guide-access.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/fixed-term-guide-access.md) | [docs/legal/fixed-term-guide-access.md](../legal/fixed-term-guide-access.md). Юридический источник; прежний статус сохранён |
| 62 | [`product/legal/privacy-v2.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/privacy-v2.md) | [docs/legal/privacy-v2.md](../legal/privacy-v2.md). Юридический источник; прежний статус сохранён |
| 63 | [`product/legal/privacy-v3.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/privacy-v3.md) | [docs/legal/privacy-v3.md](../legal/privacy-v3.md). Юридический источник; прежний статус сохранён |
| 64 | [`product/legal/processes.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/processes.md) | [docs/legal/processes.md](../legal/processes.md). Юридический источник; прежний статус сохранён |
| 65 | [`product/legal/prototypes/185-consents/index.html`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/prototypes/185-consents/index.html) | [docs/legal/prototypes/185-consents/index.html](../legal/prototypes/185-consents/index.html). Юридический источник; прежний статус сохранён |
| 66 | [`product/legal/prototypes/185-consents/screenshots/a-account-desktop.png`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/prototypes/185-consents/screenshots/a-account-desktop.png) | [docs/legal/prototypes/185-consents/screenshots/a-account-desktop.png](../legal/prototypes/185-consents/screenshots/a-account-desktop.png). Юридический источник; прежний статус сохранён |
| 67 | [`product/legal/prototypes/185-consents/screenshots/a-account-mobile.png`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/prototypes/185-consents/screenshots/a-account-mobile.png) | [docs/legal/prototypes/185-consents/screenshots/a-account-mobile.png](../legal/prototypes/185-consents/screenshots/a-account-mobile.png). Юридический источник; прежний статус сохранён |
| 68 | [`product/legal/prototypes/185-consents/screenshots/a-cookies-desktop.png`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/prototypes/185-consents/screenshots/a-cookies-desktop.png) | [docs/legal/prototypes/185-consents/screenshots/a-cookies-desktop.png](../legal/prototypes/185-consents/screenshots/a-cookies-desktop.png). Юридический источник; прежний статус сохранён |
| 69 | [`product/legal/prototypes/185-consents/screenshots/a-cookies-mobile.png`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/prototypes/185-consents/screenshots/a-cookies-mobile.png) | [docs/legal/prototypes/185-consents/screenshots/a-cookies-mobile.png](../legal/prototypes/185-consents/screenshots/a-cookies-mobile.png). Юридический источник; прежний статус сохранён |
| 70 | [`product/legal/prototypes/185-consents/screenshots/a-guide-desktop.png`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/prototypes/185-consents/screenshots/a-guide-desktop.png) | [docs/legal/prototypes/185-consents/screenshots/a-guide-desktop.png](../legal/prototypes/185-consents/screenshots/a-guide-desktop.png). Юридический источник; прежний статус сохранён |
| 71 | [`product/legal/prototypes/185-consents/screenshots/a-guide-mobile.png`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/prototypes/185-consents/screenshots/a-guide-mobile.png) | [docs/legal/prototypes/185-consents/screenshots/a-guide-mobile.png](../legal/prototypes/185-consents/screenshots/a-guide-mobile.png). Юридический источник; прежний статус сохранён |
| 72 | [`product/legal/prototypes/185-consents/screenshots/a-profile-desktop.png`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/prototypes/185-consents/screenshots/a-profile-desktop.png) | [docs/legal/prototypes/185-consents/screenshots/a-profile-desktop.png](../legal/prototypes/185-consents/screenshots/a-profile-desktop.png). Юридический источник; прежний статус сохранён |
| 73 | [`product/legal/prototypes/185-consents/screenshots/a-profile-mobile.png`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/prototypes/185-consents/screenshots/a-profile-mobile.png) | [docs/legal/prototypes/185-consents/screenshots/a-profile-mobile.png](../legal/prototypes/185-consents/screenshots/a-profile-mobile.png). Юридический источник; прежний статус сохранён |
| 74 | [`product/legal/prototypes/185-consents/screenshots/a-signin-desktop.png`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/prototypes/185-consents/screenshots/a-signin-desktop.png) | [docs/legal/prototypes/185-consents/screenshots/a-signin-desktop.png](../legal/prototypes/185-consents/screenshots/a-signin-desktop.png). Юридический источник; прежний статус сохранён |
| 75 | [`product/legal/prototypes/185-consents/screenshots/a-signin-mobile.png`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/prototypes/185-consents/screenshots/a-signin-mobile.png) | [docs/legal/prototypes/185-consents/screenshots/a-signin-mobile.png](../legal/prototypes/185-consents/screenshots/a-signin-mobile.png). Юридический источник; прежний статус сохранён |
| 76 | [`product/legal/prototypes/185-consents/screenshots/a-subscription-desktop.png`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/prototypes/185-consents/screenshots/a-subscription-desktop.png) | [docs/legal/prototypes/185-consents/screenshots/a-subscription-desktop.png](../legal/prototypes/185-consents/screenshots/a-subscription-desktop.png). Юридический источник; прежний статус сохранён |
| 77 | [`product/legal/prototypes/185-consents/screenshots/a-subscription-mobile.png`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/prototypes/185-consents/screenshots/a-subscription-mobile.png) | [docs/legal/prototypes/185-consents/screenshots/a-subscription-mobile.png](../legal/prototypes/185-consents/screenshots/a-subscription-mobile.png). Юридический источник; прежний статус сохранён |
| 78 | [`product/legal/prototypes/185-consents/screenshots/a-telegram-desktop.png`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/prototypes/185-consents/screenshots/a-telegram-desktop.png) | [docs/legal/prototypes/185-consents/screenshots/a-telegram-desktop.png](../legal/prototypes/185-consents/screenshots/a-telegram-desktop.png). Юридический источник; прежний статус сохранён |
| 79 | [`product/legal/prototypes/185-consents/screenshots/a-telegram-mobile.png`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/prototypes/185-consents/screenshots/a-telegram-mobile.png) | [docs/legal/prototypes/185-consents/screenshots/a-telegram-mobile.png](../legal/prototypes/185-consents/screenshots/a-telegram-mobile.png). Юридический источник; прежний статус сохранён |
| 80 | [`product/legal/prototypes/185-consents/screenshots/a-welcome-desktop.png`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/prototypes/185-consents/screenshots/a-welcome-desktop.png) | [docs/legal/prototypes/185-consents/screenshots/a-welcome-desktop.png](../legal/prototypes/185-consents/screenshots/a-welcome-desktop.png). Юридический источник; прежний статус сохранён |
| 81 | [`product/legal/prototypes/185-consents/screenshots/a-welcome-mobile.png`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/prototypes/185-consents/screenshots/a-welcome-mobile.png) | [docs/legal/prototypes/185-consents/screenshots/a-welcome-mobile.png](../legal/prototypes/185-consents/screenshots/a-welcome-mobile.png). Юридический источник; прежний статус сохранён |
| 82 | [`product/legal/purchase-v1.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/purchase-v1.md) | [docs/legal/purchase-v1.md](../legal/purchase-v1.md). Юридический источник; прежний статус сохранён |
| 83 | [`product/legal/purchase-v2.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/purchase-v2.md) | [docs/legal/purchase-v2.md](../legal/purchase-v2.md). Юридический источник; прежний статус сохранён |
| 84 | [`product/legal/purchase-v3-preparation.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/purchase-v3-preparation.md) | [docs/legal/purchase-v3-preparation.md](../legal/purchase-v3-preparation.md). Юридический источник; прежний статус сохранён |
| 85 | [`product/legal/purchase-v3.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/purchase-v3.md) | [docs/legal/purchase-v3.md](../legal/purchase-v3.md). Юридический источник; прежний статус сохранён |
| 86 | [`product/legal/purchase-v4.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/purchase-v4.md) | [docs/legal/purchase-v4.md](../legal/purchase-v4.md). Юридический источник; прежний статус сохранён |
| 87 | [`product/legal/purchase-v5.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/purchase-v5.md) | [docs/legal/purchase-v5.md](../legal/purchase-v5.md). Юридический источник; прежний статус сохранён |
| 88 | [`product/legal/recurring-consent-v1.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/recurring-consent-v1.md) | [docs/legal/recurring-consent-v1.md](../legal/recurring-consent-v1.md). Юридический источник; прежний статус сохранён |
| 89 | [`product/legal/rkn-notification.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/rkn-notification.md) | [docs/legal/rkn-notification.md](../legal/rkn-notification.md). Юридический источник; прежний статус сохранён |
| 90 | [`product/legal/subscription-v1.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/subscription-v1.md) | [docs/legal/subscription-v1.md](../legal/subscription-v1.md). Юридический источник; прежний статус сохранён |
| 91 | [`product/legal/subscription-v2.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/subscription-v2.md) | [docs/legal/subscription-v2.md](../legal/subscription-v2.md). Юридический источник; прежний статус сохранён |
| 92 | [`product/legal/terms-v1.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/terms-v1.md) | [docs/legal/terms-v1.md](../legal/terms-v1.md). Юридический источник; прежний статус сохранён |
| 93 | [`product/legal/terms-v2.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/terms-v2.md) | [docs/legal/terms-v2.md](../legal/terms-v2.md). Юридический источник; прежний статус сохранён |
| 94 | [`product/legal/tribute-v1.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/legal/tribute-v1.md) | [docs/legal/tribute-v1.md](../legal/tribute-v1.md). Юридический источник; прежний статус сохранён |
| 95 | [`product/series-planning-handoff.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/series-planning-handoff.md) | [docs/product/series-planning-handoff.md](../product/series-planning-handoff.md). Общий продуктовый документ |
| 96 | [`product/subscription-billing-v1.md`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/product/subscription-billing-v1.md) | [docs/product/subscription-billing-v1.md](../product/subscription-billing-v1.md). Общий продуктовый документ |
| 97 | [`prototypes/kinescope-auth-backend/check.mjs`](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/prototypes/kinescope-auth-backend/check.mjs) | История Workspace. Остаётся в истории Workspace. Локальная конфигурация или исследовательский исполняемый прототип; не часть runtime Platform |
