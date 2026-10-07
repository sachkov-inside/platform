# Мониторинг production

Этот runbook описывает сигналы владельцу об отказах production
([#245](https://github.com/sachkov-inside/platform/issues/245)). Вариант выбран 07.10.2026: сторож на
сервере и внешняя проверка из GitHub Actions, без нового стека на VPS и без затрат. Сравнение
вариантов — в [комментарии к #245](https://github.com/sachkov-inside/platform/issues/245#issuecomment-6034672582).

Мониторинг состоит из трёх частей:

| Часть | Где работает | Как часто | Что замечает |
|---|---|---|---|
| Сторож `inside-watchdog` | systemd timer на production-сервере | раз в минуту | контейнеры, память, диск, бэкап, путь покупателя в базе, бот, журналы |
| Workflow `Production monitor` | GitHub-hosted runner | раз в 10 минут | сайт, публичный API потоков, discovery Logto, срок TLS; потерю всего VPS |
| Workflow `Production access pass` | GitHub-hosted runner | раз в сутки и после выпуска | вход тестовыми identities и доступ к материалам |

Сигнал несёт версию выпуска из `/var/lib/inside/deployments/state.json` (у внешней проверки — ссылку
на запуск) и не несёт персональных данных: только счётчики, состояния и имена контейнеров.

## Сигналы сторожа

Сторож отправляет сигнал, когда условие держится нужное число запусков подряд. Повтор того же сигнала
не отправляется, пока условие не пропадёт; восстановление приходит одной строкой. Если у активного
сигнала число (покупок, писем, строк outbox, операций сообщества) выросло с прошлого запуска, приходит
строка «Хуже».

Сигналы по журналам, операциям сообщества и счётчикам бота смотрят в окно 5 или 10 минут.
Восстановление по ним значит, что за окно не было новых событий, а не что причина устранена.

Пока `operation.json` выпуска в статусе `running`, сторож пропускает запуски: deploy останавливает и
пересоздаёт процессы намеренно. `deploy-release` обновляет `recordedAt` на каждой фазе. Запись
`running` старше часа значит, что операцию убили без журнала; тогда сторож работает и сообщает об
этом.

| Шаг пути | Условие | Запусков подряд |
|---|---|---|
| Процессы | контейнер проектов Platform, PostgreSQL, Logto или Telegram `unhealthy` | 2 |
| Процессы | контейнер в любом состоянии, кроме `running`, `created` и `exited` с кодом 0 | 1 |
| Процессы | у контейнера `OOMKilled: true` | 1 |
| Сервер | доступно меньше 300 MiB памяти | 2 |
| Сервер | корневой диск занят больше чем на 85% | 1 |
| Бэкап | последний запуск `inside-pgbackrest-backup@{incr,diff,full}` не `success`; таймер не `active` | 1 |
| Бэкап | самый свежий успешный бэкап старше 8 часов | 1 |
| Оплата | покупка в `unknown` или `authorized` дольше 15 минут | 1 |
| Оплата | покупка в `sent` или `pending` дольше 25 часов | 1 |
| Выдача доступа | строка `billing.fulfillment_outbox` без `applied_at` дольше 5 минут после события оплаты | 1 |
| Письма | строка трёх `notification_outbox` без `published_at` дольше 10 минут | 1 |
| Письма | `notifications.email_effects` в `accepted`, `retrying` или `unknown` дольше 10 минут | 1 |
| Фоновая работа | у `billing.payment-recovery` нет `completed` за 5 минут | 2 |
| Бот | Telegram `/ready` не отвечает 200 | 2 |
| Бот | `getWebhookInfo` сообщает ошибку доставки за 10 минут | 1 |
| Бот | `getWebhookInfo` не читается через relay | 2 |
| Выпуск | `operation.json` в `running` дольше часа без новой фазы | 1 |
| Бот | у webhook больше 100 необработанных обновлений | 2 |
| Вступление в группу | `community_operations` в базе `inside_telegram` перешла в `failed` или `unknown` за 10 минут | 1 |
| Вступление в группу | `inside_telegram_community_oldest_due_seconds` больше 600 | 1 |
| Активация в боте | `inside_telegram_activation_oldest_pending_seconds` больше 600 | 1 |
| Бот | `update_failed_total` или `delivery_api_rejected_total` выросли за 10 минут | 1 |
| Webhook банка | ответ 4xx или 5xx на `/billing/tbank/notification` в журнале `api` за 5 минут | 1 |
| Фоновая работа | `"status":"operator_attention"` в журнале процесса Platform за 5 минут | 1 |
| Вход | 5 и больше событий `authentication_failed` в журнале `web` за 10 минут | 1 |

Почему пороги такие:

- `sent` значит, что покупатель получил ссылку на оплату. Пока банк отвечает `NEW` или `FORM_SHOWED`,
  сверка `billing.payment-recovery` переводит покупку в `pending`. Брошенную оплату банк закрывает
  после истечения ссылки, поэтому 15 минут для `sent` и `pending` дали бы сигнал на каждого ушедшего
  покупателя.
- `unhealthy` ждёт второго запуска: Docker ставит эту отметку уже после двух сбоев проверки за 30
  секунд ([production delivery](production-delivery.md)), и короткий сбой базы иначе давал бы пару
  «отказ — восстановлено».
- Сторож не реагирует на `job_failed`: этот шум убран в v18 (#1038), но сигналом служит только
  `operator_attention`.

Если сторож не может прочитать источник (базу, `/metrics`, Docker, systemd), сигналы этого источника
сохраняют прежнее состояние: без данных сторож не снимает тревогу. Недоступность баз приходит
отдельными сигналами «Сторож не может прочитать базу Platform» и «… базу Telegram» после двух запусков
подряд.

Пороги заданы в начале `infra/production/watchdog/inside-watchdog`; строки `WATCHDOG_*` в файле
настройки их заменяют.

## Каналы

Сторож пишет каждый сигнал в журнал systemd (`journalctl -u inside-watchdog`) и в
`/var/lib/inside/watchdog/signals.log` (последние 1000 строк). Доставка владельцу настраивается в
`/etc/inside/watchdog/watchdog.env` (`root:root`, `0600`), строки `KEY=value` без кавычек:

| Ключ | Назначение |
|---|---|
| `WATCHDOG_TELEGRAM_BOT_TOKEN`, `WATCHDOG_TELEGRAM_CHAT_ID` | бот сигналов и личный чат владельца |
| `WATCHDOG_TELEGRAM_RELAY_ADDRESS` | адрес relay `telegram-transport`, по умолчанию `172.30.244.2` |
| `WATCHDOG_SMTP_URL`, `WATCHDOG_SMTP_USER`, `WATCHDOG_SMTP_PASSWORD` | почта запасным путём, например `smtps://smtp.example:465` |
| `WATCHDOG_EMAIL_FROM`, `WATCHDOG_EMAIL_TO` | отправитель и адрес владельца |

Сервер не достаёт `api.telegram.org` напрямую. Сторож идёт в Bot API тем же relay, что и бот:
`curl --resolve api.telegram.org:443:<relay>`. Поэтому при поломке relay
([inside-telegram#126](https://github.com/sachkov-inside/inside-telegram/issues/126)) сигнал через
Telegram не дойдёт; его донесёт почта, а `getWebhookInfo` сам станет сигналом.

Пока ни один канал не настроен, сигналы только копятся в журнале. Если канал настроен, но доставка не
удалась, сообщение ждёт в `/var/lib/inside/watchdog/outbox` и уходит следующим запуском; outbox
хранит не больше 50 строк. Сообщение несёт последние 20 строк, чтобы уложиться в предел Telegram 4096
символов, и называет число остальных; полный перечень — в `signals.log`.

Основной бот продаж для сигналов не используется: при его поломке сигнал о ней не дошёл бы. Сторож
читает токен бота продаж из `/etc/inside/telegram/application.env` только для `getWebhookInfo`.

Внешняя проверка и суточный access pass шлют сигнал боту сигналов из repository secrets
`MONITOR_TELEGRAM_BOT_TOKEN` и `MONITOR_TELEGRAM_CHAT_ID`. Без них отказ виден как красный запуск:
GitHub уведомляет о нём по своим настройкам уведомлений. Внешняя проверка краснеет только в запуске,
который должен отправить сигнал и не отправил его.

## Установка и обновление

Сторож приходит с выпуском, отдельной операции на сервере нет. Скрипт и systemd units лежат в
`infra/production/watchdog` и попадают в backend-образ в `/app/ops/watchdog`. После успешного
`deploy` или `rollback` команда `deploy-release` копирует их из образа выбранного выпуска:

- `/usr/local/libexec/inside/inside-watchdog`;
- `/etc/systemd/system/inside-watchdog.service` и `inside-watchdog.timer`;

затем выполняет `systemctl daemon-reload` и `systemctl enable --now inside-watchdog.timer`. Каталог
состояния `/var/lib/inside/watchdog` создаёт systemd по `StateDirectory` службы. Пакет
выпуска не меняется: его состав закрыт шлюзом `inside-deploy`, а образ уже проверен по digest из
манифеста. Сбой установки выпуск не отменяет: прежняя версия сторожа продолжает работать, а в журнале
deploy остаётся `Warning: the production watchdog from vN was not installed`. Откат на выпуск,
собранный до #245, оставляет установленного сторожа на месте.

Сторож только читает: SQL идёт в транзакции `default_transaction_read_only` с `statement_timeout`
10 секунд, к Docker он обращается командами `ps`, `inspect`, `logs` и `exec psql`.

## Проверка после выпуска

С сервера, только чтение:

```bash
systemctl list-timers inside-watchdog.timer
journalctl -u inside-watchdog --since -10min
sudo tail -n 20 /var/lib/inside/watchdog/signals.log
```

Таймер активен, запуски завершаются без ошибки. В `signals.log` после выпуска ожидаются только
сигналы о настоящих отказах; ложный сигнал — повод поправить порог.

Проверка пути к Bot API через relay с токеном бота сигналов (метод `getMe` ничего не отправляет):

```bash
sudo sed -n 's/^WATCHDOG_TELEGRAM_BOT_TOKEN=//p' /etc/inside/watchdog/watchdog.env \
  | awk '{ printf "url = \"https://api.telegram.org/bot%s/getMe\"\n", $0 }' \
  | curl --config - --fail --silent --resolve api.telegram.org:443:172.30.244.2 \
  | jq .ok
```

Ответ `true` значит, что relay пропускает запросы сторожа. Внешняя проверка запускается вручную:
GitHub Actions → `Production monitor` → `Run workflow`.

## Шаги владельца

Эти шаги может сделать только владелец; без них мониторинг уже работает и пишет в журнал.

1. Создать бота сигналов в BotFather, написать ему `/start` и узнать свой chat id.
2. Создать на сервере `/etc/inside/watchdog/watchdog.env` с `WATCHDOG_TELEGRAM_BOT_TOKEN` и
   `WATCHDOG_TELEGRAM_CHAT_ID` (`root:root`, `0600`) и выполнить проверку `getMe` выше.
3. Для почты запасным путём добавить туда же `WATCHDOG_SMTP_*` и `WATCHDOG_EMAIL_*`.
4. Завести repository secrets `MONITOR_TELEGRAM_BOT_TOKEN` и `MONITOR_TELEGRAM_CHAT_ID` с теми же
   значениями.
5. Включить в настройках GitHub уведомления о неудачных workflow, если их нет: это запасной канал
   внешней проверки.

## Ограничения

- Графиков и истории нет; сводные метрики посетителей — #707.
- `docker logs --since` читает файлы журнала контейнера каждый запуск; при журнале около 100 MiB это
  заметный CPU. Замерить расход после первого выпуска: `systemctl show inside-watchdog.service
  --property=CPUUsageNSec`.
- После перезагрузки сервера systemd не помнит прошлых бэкапов; возраст и итог бэкапа неизвестны до
  следующего запуска таймера, и сигналы о них сохраняют прежнее состояние до этого запуска.
- Расписание GitHub Actions может опаздывать на минуты.
- Сигнал внешней проверки не знает версии выпуска: публичного маршрута с ней нет.
- Путь сторожа к Bot API через relay не проверен на сервере до первого выпуска со сторожем: relay
  стоит во внутренней сети Docker. Если проверка `getMe` не прошла, основным каналом становится почта.
- Если сторож сам перестал работать (например, диск заполнен до создания рабочего каталога), сигнала
  об этом нет: `systemctl list-timers` и журнал службы показывают это только при ручной проверке.
