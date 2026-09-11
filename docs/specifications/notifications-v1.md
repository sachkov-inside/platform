# Platform Notifications v1

Принятый контракт [#434](https://github.com/sachkov-inside/platform/issues/434); общий runtime
#436 описан в [runbook](../runbooks/notifications.md). Owner-approved RabbitMQ и оба первых сценария из Workspace #152 сохранены в
[локальном bundle](../contracts/notifications-v1/README.md). В первой поставке работают сообщения
подписки и новых материалов, не только transport abstraction для будущего источника.

## Модель и интерфейсы

Notifications — capability `notifications` в текущем Nest backend и собственный worker с первым
durable job. Сохраняются ADR 0001/0004/0005: feature slices, публичные facets и private Prisma schema.
RabbitMQ adapters принадлежат infrastructure; доменные операции не импортируют broker SDK.
pg-boss обслуживает локальные задания и sweeps; межсервисные events/delivery/results идут RabbitMQ.
Runtime #436 добавляет core/facets/email; producers подключаются в #410/#437.

| Владелец | Интерфейс, вводимый вместе с потребителем |
|---|---|
| Billing | Immutable notice-ready event/outbox; `resolveNotice(event)` возвращает актуальные purpose, template data, recipient Account и deadline или superseded/unavailable |
| Materials | First-publication event/outbox; `resolveAnnouncement(materialRef, occurrenceRef)` возвращает publication identity, текущие title/reader path/contentVersion или unpublished/not_found |
| Accounts | Публичные verified email/contact revision и Account enumeration; никакого чтения чужой schema |
| ContentAccess | Текущий доступ Account к Material через существующий публичный facet; нет provider I/O |
| Notifications | `acceptEvent`, `readPreferences`, `changePreferences`, `authorizeDispatch`, `acceptDeliveryResult`, `readDeliveries`, `resolveUnknown` |
| Telegram/email | Schema-valid command inbox, собственный effect ledger и correlated result outbox |

Названия выше задают ответственность и требуемый результат, не пустые DI tokens. Exact HTTP schemas
публичных endpoints вводятся вместе с #436/#437; actor берётся из trusted session, не body.
Preferences: собственный Account, expectedRevision и operationId; повтор payload idempotent,
stale revision конфликт. Просмотр своей history не раскрывает provider payload/чужие recipients.
Операторские операции используют действующего владельца через Accounts и audit. Notifications
не добавляет новых администраторов и не предоставляет marketing caller служебные полномочия.

## Хранилище и доставка

В schema notifications: EventReceipt, Notification, Delivery, immutable DeliveryCommand,
DeliveryResultReceipt, PreferenceRevision, audience checkpoint и result projection. Таблицы Billing
и Materials содержат собственный outbox, атомарный с их событием. Публичный facet не даёт consumer
координировать чужие транзакции. Email effect ledger и result outbox принадлежат email sender части
Notifications; Telegram хранит свои отдельно. Миграции и serialization появляются в runtime задачах.

Обязательные уникальности: source scope + messageId; source kind + occurrenceRef + Account;
Notification + channel; Delivery + commandRevision; publisher scope + operationId;
Delivery + resultRevision. Payload conflict — ошибка, не успешная дедупликация. Fingerprint и
protocol сроки нормативны в [protocol.md](../contracts/notifications-v1/protocol.md).

EventReceipt и recoverable audience job сохраняются одной транзакцией до broker ack. Раскрытие
аудитории использует keyset batches с durable checkpoint и unique Notification key. Верхняя граница
Account.createdAt — occurredAt. История PreferenceRevision позволяет доказать opt-in до события;
current opt-in/access проверяются снова. Не хранить весь fanout в одном broker message или одной
транзакции; batch size ограничивается измеренной ёмкостью и не влияет на состав исторической аудитории.

Первая публикация получает стабильный occurrenceRef в той же Materials transaction. Existing
Material модель остаётся mutable; publication occurrence не является версией тела или restore
history. Migration фиксирует отсутствие новых событий для ранее опубликованных материалов:
republication после cutover не становится ложной первой публикацией.

Шаблоны первой версии versioned и принадлежат Notifications. Закрытые категории/kinds выбираются
по authoritative source, не caller text. Они формируют plain text и email subject из нормализованных
данных; ссылки только на configured HTTPS Platform origin. Изменённый материал требует обновить
ещё не начатую command по protocol revision rules, если заголовок/ссылка стали неактуальны.
Нельзя просто подменить payload ранее поставленной команды или послать новый ID после unknown.

Notifications сохраняет сведения о неподключённом/неподтверждённом канале; не выдаёт его за sent.
Доставки каналов независимы, но смена binding в том же канале не снимает запрет повторного
потенциально начатого send. Preference UI и правило opt-in описаны в shared snapshot; доступ
к настройкам не требует платной подписки. Физическая недоступность Telegram не равна opt-out.

## Billing и community

Эта specification заменяет `billing` notice intent/sender ownership из #403: Billing оставляет
source facts, notice occurrence и due reminder; Notifications владеет Notification/Delivery,
шаблонами и отправкой через каналы. Кабинет Billing показывает собственные поводы, а состояния
доставок читаются endpoint Notifications: обратной зависимости Billing на Notifications нет, и у
доставки остаётся один владелец. Следующие charge attempts не ждут успеха уведомлений.

Community entitlement и его permit остаются в telegram-membership и отдельном billing-v1 corpus.
Общая шина не превращает notification в выдачу права. Один paid event может дать два независимых
последствия: entitlement projector и Notification. Ошибка одного не откатывает подтверждённый факт.
Существующий communications API сохраняет campaigns/funnels и свой scheduling, без автоматической
миграции в Notifications. Его Telegram send capacity согласуется в #56.

## Проверка и реализация

`apps/backend/test/unit/notification-contract-artifacts.test.ts` проверяет положительные и
отрицательные wire examples, digest integrity и обязательные scenario references. Это fitness
формы двух источников/двух каналов, не runtime replay или очередь на mock.

- #435: [RabbitMQ transport runtime](../runbooks/notification-transport.md), source outbox staging,
  durable pending inbox/checkpoint, lifecycle/ACL/backpressure; real broker crash tests. Business
  facts, audience jobs and channel effects are integrated by the following tickets.
- #436: core/facets/email, PostgreSQL uniqueness/rollback/concurrency и positive/negative module guards.
- #410 (поставлено): Billing events/reminders через общий модуль; `NotificationSources.resolve`
  отвечает подтверждёнными фактами Billing, а `billing.notice-ready` проходит оба канала.
  Границы поводов описаны в [billing v1](subscription-billing-v1.md#текущая-поставка-410).
- #494 (поставлено): раздел «Уведомления» личного кабинета даёт собственные opt-in переключатели
  каналов «Новые материалы» поверх уже поставленных `readPreferences`/`changePreferences`.
- #437 (поставлено): Materials записывает анонс первой публикации, его revision и строку outbox в
  той же транзакции, что и саму публикацию, и отвечает на `material.published` фасетом
  `resolveAnnouncement`. Анонс принадлежит Material, а не месту в руководстве: повторная
  публикация, переименование, перестановка и включение в другое руководство второго анонса не
  создают, а материал, впервые опубликованный до этой поставки, анонса не получает. Изменившийся
  заголовок живого анонса выпускает следующую revision, снятие с публикации закрывает повод.
  Собственные настройки каналов поставлены в #494.
- Telegram #56: real consumer/inbox/effect ledger, shared bot limits и result relay.
- #438: реальные PostgreSQL/RabbitMQ и обе стороны при synthetic provider; отдельное разрешённое
  credentialed доказательство обоих каналов. #413 использует его для billing DEMO.

Самостоятельные schema checks выполняются без чужого checkout/network. Полная проверка этого
артефакта — `pnpm docs:check` и `pnpm check`; persistence/infrastructure runtime не изменены.
Развёртывание RabbitMQ, production HA, реальные контакты и отправки здесь не проверены.
