# Поставка уведомлений v1

> Исторический план поставки от 2026-09-08. Текущие результаты принадлежат задачам приложений
> и [runbook Notifications](../runbooks/notifications.md); этот список не является текущим backlog.

Основание: [общий контракт](../history/workspace/specifications/notifications-v1.md), решение владельца от 2026-09-08.
Контрактная поставка — [Workspace #152](https://github.com/sachkov-inside/workspace/issues/152),
[Platform #434](https://github.com/sachkov-inside/platform/issues/434) и
[Telegram #54](https://github.com/sachkov-inside/inside-telegram/issues/54).

## Последовательность реализации

1. [Platform #435](https://github.com/sachkov-inside/platform/issues/435): RabbitMQ infrastructure, transactional outbox/inbox и result relay;
   repository-local Compose/runtime manifests и остановка workers. Telegram принимает
   broker adapter в своей задаче. Конфигурация окружений и HA проверяются отдельно от схем.
2. [Platform #436](https://github.com/sachkov-inside/platform/issues/436): Notifications, настройки категорий/каналов, шаблоны, durable audience expansion,
   Delivery и authorizeDispatch; журнал статусов и операторское восстановление. Это общий модуль
   для обоих источников, без billing-only sender внутри Billing.
3. [Platform #410](https://github.com/sachkov-inside/platform/issues/410): Billing events,
   актуальные reminders через Notifications; email adapter принадлежит #436; опирается на #408/#406 и общий модуль.
4. [Platform #437](https://github.com/sachkov-inside/platform/issues/437): первая публикация Material → событие → аудитория → Notifications; кабинет настроек
   и оба канала. Оплата не нужна для проверки публичного материала; закрытый проверяет ContentAccess.
5. [Telegram #56](https://github.com/sachkov-inside/inside-telegram/issues/56): общий notification
   consumer для subscription/material, inbox, auth/freshness, совместный send capacity и results.
6. [Platform #438](https://github.com/sachkov-inside/platform/issues/438): сквозная приёмка двух источников/двух каналов, restart/replay/unknown/opt-out/unpublish/fairness;
   сначала синтетический внешний транспорт при реальных PostgreSQL/RabbitMQ, затем отдельно
   разрешённые адресаты. Billing DEMO [#413](https://github.com/sachkov-inside/platform/issues/413)
   использует эту поставку, не заменяет доказательство уведомления о материале.

Общий пользовательский результат — [Workspace #153](https://github.com/sachkov-inside/workspace/issues/153).
Каждый шаг имеет собственную issue и native dependencies. Создание карточек
не закрывает пользовательский результат. Исходный Telegram #54 остаётся контрактной задачей;
выдача/отзыв участия реализуется отдельно в #55 и Platform #415.

## Граница доказательств

Schema/fixtures/manifest доказывают переносимость и shape. Runtime checks доказывают
реальные транзакции, broker redelivery, serialization и проекцию результатов. Credentialed smoke
доказывает доставку конкретным разрешённым адресатам; production activation требует отдельного GO.
Migration старых campaigns, внутренний notification center и digest не входят в эти шаги.
