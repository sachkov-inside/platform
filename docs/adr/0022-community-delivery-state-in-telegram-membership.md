---
status: accepted
---

# Состояние доставки community живёт в TelegramMembership

Право участия в сообществе выводит MembershipEntitlements и остаётся его единственным владельцем.
Исполняет это право Telegram. #415 добавляет между ними желаемое состояние, durable outbox, журнал
авторизаций и курсор проекции. Они размещены в схеме `telegram_membership`, а не в
`membership_entitlements` и не в отдельной схеме.

Решение расширяет [ADR 0003](0003-one-postgresql-schema-per-state-owning-module.md). Прежняя
формулировка ограничивала TelegramMembership состоянием link transactions и непрозрачными
provider correlations. Она остаётся верной для доказательства связи и для самого права; новым
фактом становится состояние доставки к конкретному provider. Это не второе хранилище прав:
`community_desired_states.access` — производная инструкция для отправки, вычисленная из публичного
facet `resolveCapabilities`, а не основание доступа. Отзыв, истечение и ручная выдача по-прежнему
меняются только в MembershipEntitlements, и projector туда не пишет.

Владелец отношений с provider и владелец очереди к нему должны совпадать: outbox, повтор с тем же
operationId, наблюдаемое членство и исторические binding для cleanup имеют смысл только рядом с
`account_link_states`, `account_link_history` и `link_transactions`. Размещение их в
`membership_entitlements` заставило бы модуль прав знать про транспорт и получателей; отдельная
схема потребовала бы cross-schema чтения подтверждённой связи на каждом шаге.

Цена решения: `telegram_membership` перестаёт быть только identity-схемой, и запись `access` в ней
можно ошибочно принять за право. Против этого работают три вещи. Тип зависимостей фасета допускает
из AccessGrants только `resolveCapabilities` и `readChangedAccounts`, то есть операции чтения.
Guardrail архитектуры и negative TypeScript fixture запрещают этой схеме трогать `access_grants`,
а модулю прав — трогать таблицы community. ContentAccess не читает эти таблицы вовсе.

Owning module: TelegramMembership. Fitness — `check-backend-architecture.mjs` с negative fixtures и
`test/integration/community-entitlements.test.ts` на реальном PostgreSQL: проекция, монотонная
revision, повтор той же команды, unlink/relink, истечение и отказ авторизации. Реальный чат,
права бота и выдача членства остаются отдельными owner gates.
