# Notifications: настройки, доставка и восстановление

Общий runtime #436 следует [принятой спецификации](../specifications/notifications-v1.md).
[Runbook RabbitMQ](notification-transport.md) остаётся владельцем topology, ACL, TLS, quarantine
и восстановления транспорта. Immutable wire bundle не меняется.

## Включение и граница поставки

API предоставляет настройки без необходимости оплаченного доступа. `notifications-worker`
обрабатывает сохранённые events/results и отдельный email inbox. Для внешнего email требуются
`NOTIFICATIONS_PLATFORM_ORIGIN` (origin приложения; HTTPS везде, кроме петли стенда), отдельный
`NOTIFICATIONS_TELEGRAM_SECRET` (не менее 32 символов) и существующая конфигурация
`BILLING_CONTACT_*`: подтверждённый отправитель, SMTP и ключ шифрования контактов Accounts.
Одинаковая конфигурация origin/dispatch secret задаётся API и worker. RabbitMQ остаётся
отдельной конфигурацией worker. Без email-конфигурации worker сохраняет задания и обрабатывает
результаты, но не начинает SMTP-попытки. Credentials не входят в repository.

Отсутствие адреса читателя — это состояние настройки, а не свойство повода: без
`NOTIFICATIONS_PLATFORM_ORIGIN` повод ждёт настройки, повторяясь раз в тридцать секунд, и
worker называет это наблюдением `delivery_not_configured`. Пустая строка вместо адреса не
принимается нигде: раньше она доходила до шаблона и останавливала разбор целиком.

Адрес читателя проверяется тем же правилом, что публичный адрес сайта, и в production обязан быть
HTTPS. Стенд живёт на петле `http://127.0.0.1:3000`, поэтому шаблон принимает http только для
петлевых адресов; любой другой узел без TLS отвергается как `notification_link_invalid`.

Источники подключаются в `NotificationsModule` через `NotificationSources.resolve`. Оба
подключены: `billing.notice-ready` отвечает публичный фасет Billing `resolveNotice`
([границы поводов](../specifications/subscription-billing-v1.md#текущая-поставка-410)), а
`material.published` — фасет Materials `resolveAnnouncement`. Анонс первой публикации
записывается в той же транзакции, что и сама публикация, и остаётся у материала один: повторная
публикация, переименование, перестановка и включение в другое руководство нового анонса не
создают, а материал, впервые опубликованный до этой поставки, анонса не получает вовсе.
Изменившийся заголовок живого анонса выпускает следующую revision, поэтому ещё не выданная
команда обещает читателю то, что он увидит; снятый с публикации материал перестаёт быть поводом.
Источник обязан вернуть подтверждённый собственными данными occurrence, source revision, время,
назначение, Account и данные шаблона; пересказ broker payload не является реализацией проверки.
`canRead` уже использует ContentAccess.
Новые guide purchase schemas вводятся отдельной версией в #407/#410. Контакты разрешаются
через `NotificationAccounts`, Telegram binding — через `TelegramAccountLinks`.

Ни установка модуля, ни наличие verified contact не дают marketing opt-in: сообщения о новых
материалах идут только тем, кто сам включил канал в разделе «Уведомления». Оба источника доведены
до обоих каналов и обратно [приёмкой #438](../evidence/issue-438/README.md) на реальных PostgreSQL
и RabbitMQ с синтетическими провайдерами. Реальные внешние отправки, ключи и production-разрешения
остаются отдельным шагом: синтетическая доставка не является доказательством реальной.

## API

Все Account endpoints используют действующую Logto session и `private, no-store`.
Идентификатор действующего Account не принимается из body.

| Операция | Endpoint | Результат |
| --- | --- | --- |
| Прочитать настройки | `GET /accounts/current/notifications/preferences` | revision и email/Telegram opt-in новых материалов; по умолчанию оба false |
| Изменить настройки | `POST /accounts/current/notifications/preferences` | operationId, expectedRevision, email, telegram; replay возвращает исходный ответ, stale revision даёт 409 |
| Свои доставки | `GET /accounts/current/notifications/deliveries?after=<uuid>` | До 50 безопасных summaries с keyset cursor |
| Операторский просмотр | `GET /operations/notifications/accounts/:accountId/deliveries?after=<uuid>` | Только текущий `platform:admin`; без адресов, текста и provider payload |
| Пропустить unknown | `POST /operations/notifications/unknown/resolve` | operationId, deliveryRef, action=`skip`; текущий admin, durable audit |
| Разрешить Telegram attempt | `POST /internal/notifications/dispatch/authorize` | Отдельный service bearer, exact schema/correlation из v1 bundle |

Раздел «Уведомления» личного кабинета (`/account/notifications`) читает и меняет эти настройки
через собственные маршруты BFF `GET /api/account/notifications/preferences` и
`POST /api/account/notifications/preferences/change`.

Email использует тот же facet с email authority. Telegram credential не разрешает email
Delivery. Dispatch errors сохраняют wire JSON и correlation при 409/422/503; неподдающийся
разбору запрос и неверный credential возвращают generic 400/401.

## Постоянное состояние и сбои

Event inbox фиксируется до ack. Expansion идёт по 25 Accounts с keyset checkpoint и верхней
границей `createdAt <= occurredAt`. История preferences доказывает opt-in до публикации;
current preference/access проверяются при раскрытии и перед отправкой. Нет backfill после
нового opt-in. Notification уникален по source kind + occurrence + Account; Delivery — по
Notification + channel. Неподключённый канал остаётся `no_channel`, а не `sent`.

Команда и outbox фиксируются вместе. Её текст, template revision и binding immutable.
Подтверждённая suppression по expired/superseded допускает следующую команду в том же Delivery,
если источник ещё актуален и binding не сменился. Само истечение срока, новая source revision,
смена контакта и новое разрешение не доказывают отсутствие отправки.

Email inbox, effect, attempts и result outbox хранятся отдельно. Под Delivery lock worker
фиксирует attempt/permit и `unknown` до SMTP I/O. После commit он снова проверяет deadline.
Положительный SMTP ответ означает `sent`, а не доставку во входящие или прочтение.
Явный отрицательный временный SMTP ответ допускает максимум три повтора с задержками 1/5/30
секунд и fresh permit. Потерянный ответ, timeout и restart после started остаются `unknown`.
Повтор исходной команды публикует сохранённый результат и не вызывает SMTP снова.

Проекция results проверяет channel, command revision/hash и разрешённую attempt, принимает
новые correlated revisions, сохраняет поздние результаты и отвергает conflicts в quarantine.
Отставшая проекция не заменяет журнал эффекта отправителя и не отменяет доказанный not_sent retry.
При недоступной result lane SMTP success остаётся в effect/result outbox до восстановления.

Оператор сначала читает конкретную доставку и проверяет корреляцию. `skip` сохраняет её исторический
`unknown` и audit; поздний success той же attempt может уточнить состояние. API не предоставляет
обходной resend: отдельный рискованный recovery с возможным дублем требует отдельного решения,
нового контракта и разрешения владельца. Tombstones и журналы дедупликации не удаляются автоматически.

## Проверки

`billing-notices.test.ts` проводит подтверждённую оплату, напоминание, отмену и конец срока через
реальные фасеты Billing и Notifications на PostgreSQL, а `billing-notices-broker.test.ts` повторяет
оплату через реальный RabbitMQ до письма и команды Telegram в её очереди.
`notifications.test.ts` использует PostgreSQL, Accounts verified contact и синтетические
source/provider факты: concurrency, opt-in history, checkpoints, correlation, смену контакта,
задержанные results, fresh permit, replay и SIGKILL после started. Broker test проводит оба
сценария через реальные RabbitMQ queues и PostgreSQL, временно запрещает публикацию email results
через ACL, затем проверяет восстановление проекции без повторной отправки.

```bash
pnpm --filter @inside/backend test:integration test/integration/notifications.test.ts test/integration/notifications-broker.test.ts test/integration/notification-transport.test.ts test/integration/billing-notices.test.ts test/integration/billing-notices-broker.test.ts
pnpm test:integration
pnpm check
```

Первый набор не отправляет письма или сообщения людям. Transport suite отдельно проверяет AMQPS,
invalid producer, publisher confirm/return и crash около commit/ack на реальном брокере.
Реальные SMTP/Telegram credentials, production HA, deploy и delivery людям здесь не проверены.
