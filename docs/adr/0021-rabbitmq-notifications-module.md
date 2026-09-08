---
status: accepted
---

# Notifications — общий модуль Platform с RabbitMQ

Владелец 2026-09-08 одобрил RabbitMQ и первые источники Billing/Materials. Notifications владеет
предпочтениями, аудиторией, шаблонами, уведомлениями и проекцией доставки. Sources сохраняют факты,
Telegram/email — физические попытки. [Локальная specification](../specifications/notifications-v1.md)
содержит переносимый snapshot Workspace решения.

Это расширяет ADR 0001: pg-boss остаётся локальной job infrastructure, RabbitMQ становится
межсервисным транспортом events/commands/results. Отдельное приложение Notifications не создаётся;
worker добавляется с первым durable job. HTTP остаётся для короткой проверки актуальности перед
внешним эффектом. Broker ack не заменяет business receipt или provider success.

Billing-only HTTP был достаточен для адресного сообщения одному provider, но два источника и
независимые каналы требуют общего владения пользовательскими настройками и результатами.
Цена RabbitMQ — эксплуатация и outbox/inbox; цена общего модуля — явные публичные source facets.
Ни shared DB, ни чтение чужих Prisma delegates не разрешаются.

Owning module: Notifications. Artifact fitness — notification-contract-artifacts.test.ts,
включая negative wire fixtures. Runtime fitness — #435/#436/#437/#438: real PostgreSQL/RabbitMQ
crash/replay, ACL, import guards с negative fixtures и два source сценария. До реализации
contract tests не доказывают runtime ограничения; отсутствующие runtime seams не заполняются mocks.
