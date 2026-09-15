---
status: accepted
---

# Свой RabbitMQ окружения на одном узле VPS

Владелец 15.09.2026 решил запускать для production собственный RabbitMQ на том же VPS, что и Platform
([Workspace #183](https://github.com/sachkov-inside/workspace/issues/183),
[Platform #527](https://github.com/sachkov-inside/platform/issues/527)). [ADR 0021](0021-rabbitmq-notifications-module.md)
выбрал RabbitMQ транспортом Notifications, но не решал, где и как он работает в production.

Брокер — сервис `rabbitmq` в `compose.production.yaml`. Это меняет состав выпуска из
[ADR 0014](0014-manifest-bound-production-runtime.md): девять процессов приложения
(`billing-worker` и `notifications-worker` добавлены) и брокер окружения. В отличие от процессов
приложения, образ брокера — публичный, закреплён по digest в самом Compose, а не выбирается
манифестом выпуска; брокер переживает выпуски, deploy его не дренирует и данные хранятся в томе.

Правила брокера:

- наружу не публикуется ничего; единственный слушатель — AMQPS на `5671` во внутренней сети `broker`,
  к которой подключаются `notifications-worker` и Telegram;
- TLS только у сервера: частный CA окружения и сертификат на имя `rabbitmq`; клиенты проверяют
  сертификат и имя и входят паролем своего principal;
- один vhost окружения и пять разных principals — Billing, Materials, Notifications, email и Telegram;
  у каждого нет прав configure, есть только свои exchanges и очереди;
- топологию и пользователей брокер импортирует из определений при запуске; определения выпускает
  команда из backend-образа по тем же URL, что у процессов, и в них попадают только хэши паролей;
- брокер работает пользователем образа с пределом памяти контейнера и порогами памяти и диска, после
  которых он блокирует публикацию.

## Последствия

Отдельный брокер вне VPS или управляемый сервис не нужен, и Platform с Telegram делят одну закрытую
сеть. Цена — один узел без отказоустойчивости: пока брокер остановлен, публикация ждёт в outbox
PostgreSQL, а потребители простаивают. Quorum-очереди с одним узлом дают долговечность, но не
переживают потерю узла или тома. Брокер занимает память общего VPS (2 CPU, 3,9 GiB) рядом с
приложением. Сигналов об отказах до [#245](https://github.com/sachkov-inside/platform/issues/245) нет.

## Путь роста

Когда потеря доставки на время простоя узла станет неприемлемой или VPS перестанет вмещать
приложение и брокер, переходить нужно к трём узлам quorum в независимых доменах отказа или к
управляемому брокеру с тем же vhost, principals и определениями. Такой переход требует нового ADR и
учения с потерей узла: три контейнера на одном хосте его не доказывают.

Owning module: Notifications (транспорт) и production runtime. Fitness —
`scripts/production-runtime-contract.test.mjs` (брокер закреплён по digest, без портов, только AMQPS,
с отрицательными случаями), `scripts/production-deployment.test.mjs` (брокер скачивается и поднимается
до потребителей, воркеры дренируются без него), `apps/backend/test/unit/notification-broker-definitions.test.ts` и
`pnpm compose:production:smoke` (импорт principals и очередей, проверенный TLS, закрытый AMQP).
Процедура — [production release](../runbooks/production-release.md#broker).
