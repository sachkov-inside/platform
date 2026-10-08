# Операторский отчёт об участниках группы

Команда #979 читает данные бота и проверяет участие известных Telegram ID в
`TELEGRAM_CANONICAL_CHAT_ID`. Она ничего не меняет в группе и не отправляет сообщений.
Это частичный отчёт: он не перечисляет всех нынешних участников группы.
[Исследование](../research/issue-979-group-members-report.md) объясняет границы источников.

## Источники и категории

Кандидаты берутся из `bot_contacts`, текущих `platform_links` и `community_bindings`
одного `TELEGRAM_BOT_IDENTITY`. Снимок базы согласован внутри одной транзакции.
Старые связи сообщества добавляют ID кандидата, но не заменяют текущую PlatformLink.
Каждый уникальный ID проверяется через `getChatMember`. Бот должен быть administrator.

| Категория | Значение |
| --- | --- |
| `without_link` | Telegram подтвердил участие; в снимке нет текущей PlatformLink |
| `without_right` | Telegram подтвердил участие; текущие Account и TelegramIdentity совпали с ответом Platform «без права» |
| `right_unknown` | Telegram подтвердил участие и есть PlatformLink, но ответ Platform не подтверждает отсутствие права |
| `membership_unknown` | Проверка Telegram завершилась ошибкой или вернула неизвестный статус; участие не установлено |

`right_unknown` не означает наличие права. Platform рассматривает Accounts с
наблюдением сообщества и ограничивает выборку. Ошибка Platform прерывает команду,
а не превращается в пустой список.

В JSON есть `coverage: "known_ids_only"`, `candidatesChecked`, `notMembers`,
`platformTruncated`, `platformCheckedAt`, `startedAt` и `completedAt`.
`notMembers` считает кандидатов, для которых Telegram подтвердил отсутствие участия.
Они не входят в `items`. `platformTruncated` сохраняет ограничение ответа Platform.

`platformCheckedAt` относится к проверке прав. `startedAt` и `completedAt` ограничивают
последовательные проверки Telegram. Это не атомарный снимок двух приложений и Telegram.
Если Account получил право после `platformCheckedAt`, перед действием оператор проверяет право заново.
При ошибках Telegram, включая ограничение частоты запросов, соответствующие ID остаются неизвестными.
Команда не повторяет запросы и не использует сохранённый статус вместо текущей проверки.

## Запуск в runtime-образе

Нужен выпущенный Telegram image с `dist/operations/group-members-report-cli.js`.
Команда запускается только оператором с доступом к runtime и базе Telegram.
`PLATFORM_OPERATOR_TOKEN` должен быть токеном входа Account с `platform:admin`.
Integration bearer бота для этого API не подходит.

Задайте `PLATFORM_GROUP_REPORT_URL` как полный URL существующего
`GET /community-entitlements/members-without-right` на Platform.
Удалённый URL должен использовать HTTPS; HTTP допускается только для loopback.
Команда не следует перенаправлениям. Токен передайте через окружение процесса;
не добавляйте его в аргументы, Git или общий `application.env`.

Используйте production Compose и его файл окружения из
[production runbook](production.md). Подготовьте закрытый каталог `/srv/inside-telegram/private-reports`,
доступный на запись пользователю `node` runtime-образа (UID 1000).
После настройки окружения один запуск создаёт отчёт:

```bash
docker compose --env-file "$COMPOSE_ENV" -f apps/telegram/infra/production/compose.yaml \
  run --rm -T \
  -e PLATFORM_GROUP_REPORT_URL -e PLATFORM_OPERATOR_TOKEN \
  -v /srv/inside-telegram/private-reports:/reports \
  group-members-report /reports/group-members.json
```

Файл содержит Telegram ID и Account references. Он создаётся с правами `0600`.
Существующий файл и символическая ссылка отклоняются. Для следующего запуска задайте новое имя.
stdout содержит только сообщение об успешной записи; ошибки не печатают ID или credentials.
Если запись завершилась ошибкой, неполный файл может остаться; такой файл не является отчётом.

В development доступна та же команда:

```bash
pnpm --filter @inside/telegram owner:group-members-report /private/path/group-members.json
```

Кроме двух операторских переменных нужны `DATABASE_URL`, `TELEGRAM_BOT_IDENTITY`,
`TELEGRAM_BOT_TOKEN` и `TELEGRAM_CANONICAL_CHAT_ID` из окружения приложения.
Код возврата `0` означает сохранённый отчёт, включая возможные неизвестные данные.
Код `1` означает отказ или сбой; stdout не выдаёт персональные данные.

## Полнота и следующий шаг

Молчащие участники без личного `/start` и привязки могут отсутствовать даже без ошибок.
Аудит старых событий `unlinked_subject` не содержит их Telegram ID.
Число кандидатов не доказывает полноту группы; команду нельзя использовать как полный реестр удаления.
Для исходного полного отчёта нужен отдельно подтверждённый список стабильных Telegram ID.
Импорт такого списка и новый реестр будущих событий в #979 не поставляются.
