---
status: accepted
---

# Общие уведомления через RabbitMQ

> Решение перенесено из [Workspace](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/adr/0003-rabbitmq-product-notifications.md).
> Область действия и текущий статус указаны в [индексе](README.md).

2026-09-08 владелец одобрил RabbitMQ и общую систему для платежей и новых материалов вместо
billing-only HTTP доставки. Platform Notifications определяет уведомления, аудиторию и каналы;
источники сохраняют собственные факты, Telegram/email сохраняют внешний результат.
RabbitMQ передаёт события, задания и результаты. Контракт —
[notifications v1](../../history/workspace/specifications/notifications-v1.md).

HTTP с pg-boss достаточен для одного адресного provider. Несколько источников, каналов и
независимых consumers оправдывают отдельный broker, routing и очереди с разным обслуживанием.
NATS JetStream рассматривался для сохраняемого потока/replay; для текущих delivery queues выбран
RabbitMQ. pg-boss остаётся локальной инфраструктурой заданий Platform, не межсервисной шиной.

Цена решения — эксплуатация брокера и согласованность двух хранилищ. Поэтому PostgreSQL outbox,
inbox, дедупликация и журнал внешнего эффекта обязательны. Broker ack не равен отправке.
Community entitlement и существующие воронки сохраняют свои модели.

Owning modules: Platform Notifications и Telegram delivery. Ближайшая fitness function —
переносимый corpus в обеих локальных спецификациях; runtime enforcement принадлежит
implementation tickets из плана. До появления runtime шва schema/integrity checks
не доказывают ack ordering или crash safety; обязательны positive/negative
PostgreSQL/RabbitMQ проверки с остановкой процесса на каждой границе.
