# Восстановление очередей billing и community dispatch

Runbook для оператора, когда фоновая работа оплаты или доставки права на сообщество встала или
отстаёт. Он закрывает эксплуатационный пункт [Platform #527](https://github.com/sachkov-inside/platform/issues/527).
Сигналов нет: отказ видно по логам и по запросам ниже, а мониторинг появится в
[#245](https://github.com/sachkov-inside/platform/issues/245). Очереди уведомлений в RabbitMQ
восстанавливаются по [notification transport](notification-transport.md#observation-and-recovery).

Главное правило: вся работа уже лежит в PostgreSQL и повторяется с теми же идентификаторами. Никогда
не удаляйте задания, receipts, строки outbox и не создавайте операцию с новым идентификатором взамен
старой: это и есть путь к двойному списанию или двойному сообщению.

## Что где работает

Всё ниже выполняет `billing-worker` раз в минуту через `pg-boss` (схема `pgboss`). Задание не
повторяется само (`retryLimit 0`), живёт не дольше 300 секунд, а следующее ставится расписанием
через минуту, поэтому сбой одного прохода не копит очередь.

| Очередь | Что делает | Чем владеет |
|---|---|---|
| `billing.payment-recovery` | сверяет неподтверждённые покупки через банк и незавершённые возвраты тем же `ExternalRequestId` | покупки и возвраты |
| `billing.subscription-renewal` | продлевает подписки и сверяет смену карты | подписки |
| `billing.subscription-notices` | ставит напоминания о подписке | календарь уведомлений |
| `tribute.source-reconciliation` | сопоставляет подтверждённые источники Tribute пачками по 50 | [Tribute](tribute-access-convergence.md) |
| `community.entitlement-delivery` | проецирует право на сообщество и отправляет команды Telegram | outbox `telegram_membership.community_operations` |

`community.entitlement-delivery` регистрируется только при настроенном community v2.

## Как заметить

Логи (контейнеры проекта `inside-platform-production`):

```bash
docker logs --since 30m inside-platform-production-billing-worker-1 2>&1 \
  | grep -E 'operator_attention|failed|unavailable'
```

- `{"event":"queue_attention",...,"queue":"tribute.source-reconciliation","status":"operator_attention","pending":N}`
  — источники Tribute не сопоставлены;
- `{"event":"queue_attention",...,"queue":"community.entitlement-delivery","status":"operator_attention",...}` — есть просроченная
  (дольше пяти минут), отклонённая или упавшая работа сообщества;
- `{"event":"queue_unavailable","process":"billing-worker",...}` — `pg-boss` потерял базу; причина
  в поле `error`;
- `{"event":"dependency_failure",...}` и `{"event":"job_failed",...}` — задание упало на сбое
  зависимости; все строки одного запуска задания связаны общим `requestId` (см.
  [журнал backend](backend-logs.md));
- `Another billing-worker generation is still active` — стартует второе поколение воркера.

Запросы только на чтение выполняются в контейнере PostgreSQL foundation:

```bash
postgres_container="$(docker ps --filter label=com.docker.compose.service=postgres --quiet)"
psql_read() { docker exec -i "$postgres_container" psql --username postgres --dbname inside --set ON_ERROR_STOP=1 "$@"; }
```

Состояние заданий billing за последний час:

```bash
psql_read --command "select name, state, count(*), max(created_on) as last_created
  from pgboss.job
  where name in ('billing.payment-recovery', 'billing.subscription-renewal', 'billing.subscription-notices',
                 'tribute.source-reconciliation', 'community.entitlement-delivery')
    and created_on > now() - interval '1 hour'
  group by name, state order by name, state;"
```

Здоровая картина — `completed` каждую минуту по каждой очереди. Нет новых строк — воркер не работает.
Строки `failed` подряд — проход падает; причина в логе этого прохода.

Покупки, которые ждут подтверждения банка:

```bash
psql_read --command "select state, count(*), min(created_at) as oldest
  from billing.purchases where state in ('prepared', 'sent', 'unknown', 'pending', 'authorized')
  group by state;"
```

Доставка сообщества:

```bash
psql_read --command "select delivery, result_status, count(*), min(issued_at) as oldest
  from telegram_membership.community_operations
  group by delivery, result_status order by delivery, result_status;"
```

Состояние одного Account (desired, accepted и applied раздельно) — владельческий
`GET /community-entitlements/:accountId`.

## Billing: восстановление

1. **Воркер не работает или перезапускается.** Посмотрите `docker ps` и лог. Если причина —
   `Another billing-worker generation is still active`, остановите старый контейнер; новый поколение
   стартует сам. Если лог показывает отказ конфигурации продажи, исправьте `/etc/inside/runtime` по
   [production release](production-release.md#payment-contour).
2. **Недоступна зависимость** (PostgreSQL, банк, SMTP). Восстановите её. Задания сами продолжатся со
   следующей минуты; перезапускайте только `billing-worker`, если он завершился.
3. **Покупка застряла** в `sent`, `unknown` или `pending`. Сверка идёт автоматически. Для одной
   покупки владелец может запросить её явно: владельческая операция `payments.reconcile` с
   `purchaseRef` в `/authoring/billing` или MCP. Повтор `Init` приложение не делает никогда.
4. **Возврат с потерянным ответом** остаётся `unknown` и сверяется тем же запросом. Не отправляйте
   новый возврат: повторите `refunds.read` и дождитесь сверки.
5. **Tribute** — по [Tribute access convergence](tribute-access-convergence.md): `tribute.status`,
   `tribute.retryEvent`, сверка реестра.

## Community dispatch: восстановление

Команды сообщества лежат в outbox. У строки есть `delivery`:

- `pending` — ещё не принята Telegram. Потерянный ответ повторяется автоматически с тем же
  `operationId` и тем же телом (1, 5 и 30 секунд). Растущее число `pending` при недоступном Telegram —
  ожидаемо; после восстановления Telegram проход отправит их сам;
- `accepted` — Telegram принял намерение; факт применения приходит опросом `entitlement.status`;
- `rejected` — Telegram отказал решением. Это работа оператора, повтор её не исправит;
- `superseded` — заменена более новой командой для того же получателя.

Порядок действий:

1. **Telegram недоступен.** Восстановите Telegram и сеть до него. Ничего не удаляйте: `pending`
   уйдут сами, `operator_attention` про просроченную работу пропадёт после прохода.
2. **Отказ разрешения.** Telegram спрашивает `POST /internal/billing-dispatch/authorize` перед каждым
   эффектом. `401` — секреты `TELEGRAM_COMMUNITY_DISPATCH_SECRET` и Telegram не совпадают; исправьте
   конфигурацию и перезапустите процессы. `binding_conflict` — привязка Telegram изменилась или
   спорна: разберите привязку Account; после её исправления новая revision создаст новую команду сама.
3. **`rejected`.** Прочитайте `error_code` и `result_status` строки и состояние Account через владельческий
   endpoint. Исправьте причину (привязка, модерация, права бота в группе). Исключение модератором
   остаётся запретом: автоматического возврата нет.
4. **Воркер упал.** Перезапустите только `billing-worker`. Курсор изменений доступа продвигается лишь
   по полностью обработанному окну, поэтому пропусков не будет.

## Чего не делать

- Не удалять и не править строки `pgboss.job`, `billing.purchases`, возвратов и
  `telegram_membership.community_operations`.
- Не менять `operationId`, `ExternalRequestId` и дедупликационные ключи.
- Не очищать очереди RabbitMQ и не удалять тома брокера.
- Не запускать второй `billing-worker` рядом с работающим.
