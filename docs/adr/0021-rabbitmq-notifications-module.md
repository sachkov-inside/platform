---
status: accepted
---

# Общий модуль Notifications с RabbitMQ

Владелец одобрил RabbitMQ и первые источники Billing/Materials 08.09.2026.
Notifications остаётся capability внутри backend, с отдельным worker для долговечной работы.
Он владеет поводом уведомления, получателем, настройками и проекцией результата; источники владеют
исходными фактами, а Telegram/email, физическими попытками доставки.

RabbitMQ переносит события, команды и результаты между приложениями. `pg-boss` остаётся локальной
инфраструктурой заданий Platform по [ADR 0001](0001-one-backend-multiple-entrypoints.md).
HTTP используется для короткой проверки актуальности перед внешним эффектом; broker ack
не заменяет бизнес-подтверждение или успех провайдера.

NATS JetStream рассматривался для сохраняемого потока и replay; RabbitMQ выбран для очередей
доставки с разными routing и consumers. Broker ack не является отправкой внешнего сообщения.

Адресный HTTP был достаточен для одного источника и получателя. Несколько источников и независимые
каналы оправдывают общий интерфейс и отдельный транспорт. Цена выбора: эксплуатация RabbitMQ,
PostgreSQL outbox/inbox, дедупликация и восстановление. Общая база приложений и чужие Prisma delegates
не становятся допустимыми. Журнал внешнего эффекта должен различать подтверждённый результат
и неизвестный исход, который нельзя повторять вслепую.

Текущий контракт: [Notifications](../specifications/notifications-v1.md).
Эксплуатационный выбор: [ADR 0025](0025-own-single-node-rabbitmq-broker.md).
Worker включён в [production Compose](../../compose.production.yaml).
Проверки разделены на [артефакты контракта](../../apps/backend/test/unit/notification-contract-artifacts.test.ts),
[broker](../../apps/backend/test/integration/notifications-broker.test.ts) и
[приёмочные сценарии](../../apps/backend/test/integration/notifications-acceptance.test.ts).
Проверка схемы сама по себе не доказывает порядок ack или восстановление после остановки процесса.

## История

[Редакция до аудита 28.10.2026](https://github.com/sachkov-inside/platform/blob/0d60a4da243edd8ba19b92f99394e58586d0b7d9/docs/adr/0021-rabbitmq-notifications-module.md) сохраняет исходное обоснование,
этапы реализации и прежние имена. Эта редактура уточняет действующую область решения.
