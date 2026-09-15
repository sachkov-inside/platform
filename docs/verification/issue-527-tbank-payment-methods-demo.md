# DEMO на тестовом терминале Т-Банка: все способы формы

Задача: [Platform #527](https://github.com/sachkov-inside/platform/issues/527), п. 2. Заменяет прежнюю
DEMO-задачу [#413](https://github.com/sachkov-inside/platform/issues/413). Это сценарий и шаблон отчёта:
результаты вписываются после прогона. Рабочий терминал, реальные деньги и production здесь не
участвуют.

## Что уже известно

- Факт владельца 15.09.2026: на тестовом терминале включены HTTP-уведомления, запасной адрес в кабинете —
  `https://inside.sachkov.dev/billing/tbank/notification`. Он ведёт в production, а не на стенд, поэтому
  доказательством уведомления служит только адрес, который приложение передаёт в `Init`.
- Приложение передаёт `NotificationURL`, `SuccessURL` и `FailURL` в каждом `Init`; страницы банка по
  умолчанию не мешают.
- Форма тестового терминала: карта, T-Pay, Mir Pay (только Android), SberPay, Долями (4–200 000 ₽).
  СБП выключена ([issue-402](issue-402-tbank-terminal-capability.md)).
- Терминал DEMO: `recurringCardConfirmed=false`, `cardOnlyHostedConfirmed=false`. Проверяется разовая
  покупка; отказ включить продажу подписки на этом терминале — отдельная проверка.

## Учётные данные: только локальный файл вне Git

Файл `~/.config/inside/platform-tbank-demo.env`, права `0600`, вне репозитория и worktree. Его создаёт и
заполняет владелец. Агент файл не читает и не выводит; значения не попадают в чат, issue, журналы и
репозиторий.

```bash
install -d -m 0700 ~/.config/inside
install -m 0600 /dev/null ~/.config/inside/platform-tbank-demo.env
${EDITOR:-nano} ~/.config/inside/platform-tbank-demo.env
```

Содержимое: значения терминала — из кабинета тестового терминала, `<tunnel-host>` — HTTPS-адрес туннеля
стенда.

```dotenv
TBANK_PROVIDER_MODE=real
TBANK_CONFIG_JSON={"environment":"demo","terminalKey":"<ключ тестового терминала>","password":"<пароль тестового терминала>","bindingEncryptionKey":"<32 случайных байта base64>","recurringCardConfirmed":false,"cardOnlyHostedConfirmed":false,"minimumKopecks":400,"maximumKopecks":20000000,"returnUrl":"https://<tunnel-host>/subscription/return","notificationUrl":"https://<tunnel-host>/billing/tbank/notification","receipt":{"taxation":"usn_income","tax":"none"}}
```

Границы суммы на время DEMO сужены до пределов Долями, чтобы один товар проверял все пять способов.
`bindingEncryptionKey` создаётся командой `openssl rand -base64 32`.

## Стенд

Стенд `inside-platform` — общий singleton ([local development](../runbooks/local-development.md#parallel-worktrees-and-singleton-ownership)):
DEMO проводит сессия, которая им владеет. Двойника банка заменяет override Compose вне репозитория; он
только добавляет файл выше к `api` и `billing-worker`. Переменные `TBANK_TEST_*` в режиме `real` не
читаются.

```yaml
# ~/.config/inside/compose.tbank-demo.yaml — вне репозитория
services:
  api:
    env_file:
      - ${HOME}/.config/inside/platform-tbank-demo.env
  billing-worker:
    env_file:
      - ${HOME}/.config/inside/platform-tbank-demo.env
```

1. `pnpm local:stand` и вход владельца, как в [локальной покупке](../runbooks/local-development.md#one-stand-sign-in-and-purchase).
2. Пересоздать только два процесса с override:

   ```bash
   docker compose -f compose.yaml -f ~/.config/inside/compose.tbank-demo.yaml \
     up -d --no-deps --force-recreate api billing-worker
   ```

3. HTTPS-туннель до стенда нужен для `notificationUrl` и `returnUrl` реального контура. Он публикует на
   `<tunnel-host>` только `POST /billing/tbank/notification` → API `127.0.0.1:3001` и
   `GET /subscription/return` → web `127.0.0.1:3000`. Туннель поднимается только после подтверждения
   координатора; его адрес живёт только в файле окружения.
4. Готовность без платежа: `api` и `billing-worker` здоровы и не сообщают отказ конфигурации продажи;
   неподписанный `POST https://<tunnel-host>/billing/tbank/notification` отвечает `400`.

После DEMO: удалить override и туннель, пересоздать `api` и `billing-worker` без override, удалить файл
окружения или оставить его с правами `0600` по решению владельца.

## Сценарий на каждый способ

Товар — разовое руководство стенда с ценой в пределах 4–200 000 ₽. Покупатель — Account стенда с
подтверждённым адресом для чека. Порядок для карты, T-Pay, Mir Pay, SberPay и Долями:

1. **Покупка.** Купить руководство, на форме банка выбрать способ, оплатить тестовым средством банка.
   Записать `purchaseRef` и время.
2. **Уведомление.** Покупка стала `confirmed` из уведомления, а не из возврата покупателя: в журнале API
   есть принятый `POST /billing/tbank/notification`, повтор уведомления не выдаёт второе право. Если
   уведомление не пришло, записать это и подтвердить сверкой `payments.reconcile`.
3. **Право.** Руководство открылось, в «Покупках» видно бессрочное право.
4. **Возврат.** В `/authoring/billing`: `refunds.decide` (полная сумма, доступ `revoke`), затем
   `refunds.execute`. Возврат `REFUNDED`, право снято, повтор не шлёт второй `Cancel`.
5. **Чеки.** В кабинете кассы есть чек продажи и чек возврата: `usn_income`, «без НДС», признаки `service`
   и `full_payment`, адрес покупателя. Отметить место расчётов в чеке.

Отдельно: предложение с вариантом подписки на этом терминале не включается в продажу (`method_unavailable`).

## Отчёт

| Способ | Покупка | Уведомление | Право | Возврат | Чек продажи | Чек возврата | Примечание |
|---|---|---|---|---|---|---|---|
| Карта | | | | | | | |
| T-Pay | | | | | | | |
| Mir Pay | | | | | | | |
| SberPay | | | | | | | |
| Долями | | | | | | | |

Граница доказательств: тестовый контур не доказывает рабочий терминал, реальную кассу и доставку
уведомлений на production-адрес. Способ, который тестовый контур не проводит до конца, отмечается «не
поддерживается тестовым контуром», а не «пройден».
