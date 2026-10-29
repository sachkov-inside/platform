# Архитектурные решения

В рабочем дереве 34 действующих ADR: 32 Platform и 2 Telegram.
Заменённые решения и дубли удалены; исходные тексты сохраняются в Git.
Номера оставшихся решений не меняются, удалённые номера не используются повторно.

Продуктовые условия принадлежат [модели доступа](../product/access-model.md),
владельцы фактов указаны в [карте контекстов](../product/domain-context-map.md).
ADR фиксируют причины выбора и компромиссы; точные настройки и исполняемые правила
остаются в owning code/config, стандартах и runbooks.

## Platform

| ADR | Решение |
|---|---|
| [0001](0001-one-backend-multiple-entrypoints.md) | One backend codebase with demand-driven process entrypoints |
| [0003](0003-one-postgresql-schema-per-state-owning-module.md) | One PostgreSQL schema per state-owning module |
| [0004](0004-feature-first-backend-modules.md) | Feature-first backend modules with DI at real seams |
| [0005](0005-prisma-in-use-cases.md) | Use Prisma directly in backend use cases |
| [0006](0006-logto-session-and-local-account.md) | Logto владеет сессией входа, Platform хранит один Account |
| [0009](0009-one-mutable-material.md) | Keep one deep Materials module around one mutable Material |
| [0010](0010-single-typescript-7-oxc-toolchain.md) | Use one TypeScript 7 and Oxc toolchain |
| [0011](0011-client-owned-library-catalog.md) | Keep the Library catalog client-owned |
| [0012](0012-browser-owned-interactive-mutations.md) | Keep interactive Web mutations browser-owned |
| [0013](0013-immutable-ordinal-release-artifacts.md) | Publish immutable ordinal release artifacts from exact main |
| [0014](0014-manifest-bound-production-runtime.md) | Bind the production runtime to one immutable release and schema identity |
| [0015](0015-serialized-manifest-deployment-and-bounded-rollback.md) | Serialize manifest-bound deployment and keep rollback explicit and bounded |
| [0016](0016-one-public-content-library-read-model.md) | Use one public ContentLibrary read model with aggregate-owned covers |
| [0017](0017-reading-state-and-transition-history.md) | Состояние изучения и атомарная история переходов |
| [0021](0021-rabbitmq-notifications-module.md) | Общий модуль Notifications с RabbitMQ |
| [0022](0022-community-delivery-state-in-telegram-membership.md) | Доставка прав сообщества принадлежит Telegram Integration |
| [0023](0023-material-block-registry-package.md) | Один реестр блоков за границей MaterialBody |
| [0024](0024-one-access-capability-vocabulary.md) | Один пакет словаря прав доступа |
| [0025](0025-own-single-node-rabbitmq-broker.md) | Свой RabbitMQ окружения на одном узле VPS |
| [0026](0026-guide-page-from-source-data.md) | Страница продукта из данных источника |
| [0027](0027-web-navigation-and-caching.md) | Навигация и кеширование web |
| [0028](0028-web-edge-hardening.md) | Защита входа web: HSTS, CSP и ограничение частоты |
| [0029](0029-acyclic-module-dependencies.md) | Ацикличные зависимости между Modules |
| [0030](0030-guide-task-module.md) | Задание имеет отдельного владельца и жизненный цикл |
| [0031](0031-inside-product-monorepo.md) | Platform владеет кодом продукта и общими документами Inside |
| [0032](0032-web-http1-logto-sdk.md) | HTTP/1.1 для исходящего fetch серверного web |
| [0035](0035-product-catalogue-programme-and-attachments.md) | Separate Product catalogue, programme placements and chapter attachments |
| [0036](0036-amsterdam-production-placement.md) | Единственная рабочая площадка в Амстердаме |
| [0038](0038-one-definition-per-browser-mutation.md) | One definition per same-origin browser mutation |
| [0039](0039-opaque-transaction-handoff.md) | Opaque transaction handoff between state owners |
| [0040](0040-unified-product-access.md) | Единый Product Access без тарифов и подписок |
| [0041](0041-protected-recording-serves-any-access.md) | Защищённая запись служит уроку с любым доступом |

## Telegram

| ADR | Решение |
|---|---|
| [0001](../../apps/telegram/docs/adr/0001-bot-sign-in-without-confirmation-code.md) | Подтверждение входа в боте без сверки кода |
| [0002](../../apps/telegram/docs/adr/0002-durable-queue-boundary.md) | Граница общей durable-queue и журналов внешнего эффекта |
