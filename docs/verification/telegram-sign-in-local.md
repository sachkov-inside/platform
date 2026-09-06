# Локальная проверка Telegram-входа

Стенд #299 использует настоящий закреплённый Logto `1.41.0-inside.3`, Platform и
`inside-telegram` из [PR #25](https://github.com/sachkov-inside/inside-telegram/pull/25).
Подтверждения Telegram синтетические: тест отправляет `/start` и callback update в локальный
webhook, затем обычный provider inbox worker обрабатывает их. Доставка сообщений, проверка
реального чата и передача Membership evidence выключены. Это не проверка реального Telegram Bot API.

## Настройка

Используйте отдельные task worktrees и свободные порты. Общий `inside-platform` не останавливайте.
Node и pnpm берутся из repository version files. Установите зависимости через `pnpm install
--frozen-lockfile`. В Platform создайте закрытый ignored `.identity-proof/299.env` (mode `0600`):

```dotenv
COMPOSE_PROJECT_NAME=inside-identity-proof-299
IDENTITY_PROOF_API_PORT=3601
IDENTITY_PROOF_WEB_PORT=3600
IDENTITY_PROOF_LOGTO_PORT=3631
IDENTITY_PROOF_LOGTO_ADMIN_PORT=3632
IDENTITY_PROOF_MAILPIT_PORT=3625
IDENTITY_PROOF_SMTP_PORT=3626
IDENTITY_PROOF_POSTGRES_PORT=55439
IDENTITY_PROOF_ACCESS_TOKEN_TTL_SECONDS=60
TELEGRAM_SIGN_IN_ENABLED=true
TELEGRAM_SIGN_IN_PROVIDER_URL=http://host.docker.internal:3606
TELEGRAM_SIGN_IN_PLATFORM_URL=http://host.docker.internal:3601
TELEGRAM_SIGN_IN_BOT_USERNAME=inside_local_bot
# Generate a random credential of at least 32 characters; use the same value in the provider.
TELEGRAM_SIGN_IN_INTEGRATION_SECRET=
```

Запустите инфраструктуру из Platform; `--env-file` не экспортирует переменные для следующих команд:

```bash
pnpm identity:proof:certs
docker compose --env-file .identity-proof/299.env -f infra/identity/logto/compose.yaml up -d --build --wait
COMPOSE_PROJECT_NAME=inside-platform-proof-299 POSTGRES_HOST_PORT=55439 OBJECT_STORAGE_HOST_PORT=3900 OBJECT_STORAGE_CONSOLE_HOST_PORT=3901 docker compose up -d --wait postgres object-storage
NODE_EXTRA_CA_CERTS=.identity-proof/tls/certificate.pem node --env-file=.identity-proof/299.env scripts/identity-proof-bootstrap.mjs
```

Для HTTPS bootstrap задайте `NODE_EXTRA_CA_CERTS=.identity-proof/tls/certificate.pem` в окружении.
Bootstrap создаёт отдельную конфигурацию приложения `.identity-proof/platform.env` с mode `0600`
и применяет уникальность Telegram identity в принадлежащей стенду БД Logto. Platform runtime
никогда не читает БД Logto напрямую.

В repository Telegram создайте собственную isolated БД и ignored `.env.sign-in-local` по
`.env.example`: порт `3606`, `HOST=0.0.0.0` для доступа Logto из Docker, отдельный `DATABASE_URL`,
`TELEGRAM_SIGN_IN_ENABLED=true`, общий sign-in secret, отдельные webhook и linking secrets.
Оставьте `TELEGRAM_DELIVERY_MODE`, `TELEGRAM_MEMBERSHIP_MODE` и `PLATFORM_EVIDENCE_DELIVERY_MODE`
равными `disabled`, `WORKERS_ENABLED=true`. Из Telegram repository:

```bash
node --env-file=.env.sign-in-local --import tsx src/database/migrate.ts
node --env-file=.env.sign-in-local --import tsx src/main.ts
```

В сгенерированном Platform environment дополните `TELEGRAM_SIGN_IN_INTEGRATION_SECRET` и установите
`TELEGRAM_SIGN_IN_PROVIDER_URL=http://127.0.0.1:3606`,
`TELEGRAM_LINKING_ENDPOINT=http://127.0.0.1:3606/integrations/platform/v1/identity-links` и
`TELEGRAM_LINKING_SECRET`, совпадающий с `PLATFORM_INTEGRATION_SECRET` Telegram.
Установите `OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:3900`. Из Platform:

```bash
pnpm api:generate
node --env-file=.identity-proof/platform.env scripts/telegram-sign-in-local.mjs
```

`telegram:local:dev` применяет миграции, создаёт локальные демонстрационные материалы, запускает
Web, API, MCP и фоновые workers. Порты берутся из `WEB_BASE_URL` и `BACKEND_BASE_URL`, MCP — `3602`.
Секреты не сохраняются в репозитории и не выводятся командами запуска.

## Проверка

Откройте [Platform](http://127.0.0.1:3600). Письма с кодами доступны только в локальном
[Mailpit](http://127.0.0.1:3625). Telegram-кнопка ведёт на компактный экран «Открыть бота». Бот предлагает
«Это я» / «Это не я»; после подтверждения исходная вкладка автоматически завершает вход. В синтетическом режиме ссылка на бота не завершит вход через настоящий Telegram.
Для сквозного теста выполните в Platform:

```bash
LOGTO_ENDPOINT=https://identity.inside.localhost:3631 WEB_BASE_URL=http://127.0.0.1:3600 TELEGRAM_PROOF_WEBHOOK_URL=http://127.0.0.1:3606/webhooks/telegram TELEGRAM_PROOF_WEBHOOK_SECRET=your_local_webhook_secret pnpm --filter @inside/web exec playwright test --config playwright.identity.config.ts telegram-sign-in.spec.ts
```

Тест проверяет обычный callback, обновление страницы, выход, новый вход, отказ и чужой браузер.
PostgreSQL tests проверяют неизменность Account, отсутствие фиктивной почты и прав, конкуренцию и
повтор после потерянного ответа. Provider integration tests используют отдельную disposable БД,
никогда БД ручного стенда. Скриншоты не должны сохранять start token, секреты или callback URL.

Проверьте вручную: email-регистрация; выход и повторный вход; Telegram-регистрация; приватный
Account без Membership; подключение Telegram после email-входа и возвращение в тот же Account;
отказ в боте; истечение пяти минут; выключение во время ожидания. Для выключения установите
`TELEGRAM_SIGN_IN_ENABLED=false` в Platform и provider, примените bootstrap с этим значением
(он также выключает уже созданный connector). Ранее выданная сессия и email продолжают работать.

Реальные bot credentials, webhook и сообщения требуют отдельного owner GO. Production activation
не входит в #299. Не подменяйте синтетическую проверку заявлением о готовности реального бота.

## Остановка

Остановите только процессы своих терминалов (`Ctrl-C`), затем свои Compose projects:

```bash
docker compose --env-file .identity-proof/299.env -f infra/identity/logto/compose.yaml down
COMPOSE_PROJECT_NAME=inside-platform-proof-299 docker compose down
```

Команды сохраняют volumes. Удаление данных не требуется для повторного запуска.

Экран ожидания — временная семантическая реализация. Визуальная интеграция и owner acceptance
ведутся отдельно в [Platform #303](https://github.com/sachkov-inside/platform/issues/303).
