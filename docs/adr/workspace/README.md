# Решения, перенесённые из Workspace

Имена и номера исходных ADR сохранены в отдельном каталоге, чтобы не совпасть с ADR Platform.
Они фиксируют историю решений, а действующие правила перечислены ниже.

| Исходное решение | Статус после переноса | Текущий владелец |
|---|---|---|
| [0001: владелец brief](0001-platform-owns-product-brief.md) | Заменено только распределение документов между репозиториями | [ADR 0031](../0031-inside-product-monorepo.md); отдельный Platform brief сохраняется |
| [0002: проекция Membership](0002-project-telegram-membership-events-into-postgresql.md) | Сохраняется для прежнего Membership-пути; не правило новых оплат | [Контракт Identity/Membership](../../contracts/identity-membership-v1.md), [модель доступа](../../product/access-model.md) |
| [0003: RabbitMQ](0003-rabbitmq-product-notifications.md) | Принятый выбор транспорта; первоначальный план поставки исторический | [ADR 0021](../0021-rabbitmq-notifications-module.md), [Notifications](../../specifications/notifications-v1.md) |
| [0004: типизированные блоки](0004-typed-blocks-for-interactive-materials.md) | Принятая граница авторства; описание двух копий схемы историческое | [ADR 0023](../0023-material-block-registry-package.md), [реестр блоков](../../../packages/material-blocks/) |
