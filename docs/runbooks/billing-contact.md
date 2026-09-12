# Billing contact: хранение, отправка и проверка

[Спецификация](../specifications/subscription-billing-v1.md#подтверждённый-контакт-и-согласия--406)
владеет поведением и лимитами. Accounts хранит адрес в AES-256-GCM envelope `v1`, со случайным nonce
и привязкой ciphertext к Account через AAD; коды и адрес для recipient limit представлены keyed HMAC.
Открытый адрес возвращается только собственному authenticated Account. В логах нет email, кодов,
SMTP credentials или accepted document payload. Сохранённые evidence доступны по собственному ID.

## Конфигурация

Весь набор опционален: при его отсутствии подтверждение выключено. Частичная конфигурация ошибочна.
Значения принадлежат API env-файлу deployment; никогда не помещать реальные значения в Git.

| Переменная | Значение |
| --- | --- |
| `BILLING_CONTACT_ENCRYPTION_KEY` | 32 случайных байта в base64, отдельный от login fingerprint ключ |
| `BILLING_CONTACT_SMTP_HOST` | SMTP hostname |
| `BILLING_CONTACT_SMTP_PORT` | Порт, по умолчанию 587; 465 использует TLS сразу |
| `BILLING_CONTACT_SMTP_USER` / `BILLING_CONTACT_SMTP_PASSWORD` | Оба вместе, если провайдер требует authentication |
| `BILLING_CONTACT_SMTP_LOCAL_CAPTURE` | `true` только на стенде: открытый SMTP до перехватчика писем |
| `BILLING_CONTACT_FROM` | Адрес подтверждённого отправителя |

Production требует TLS/STARTTLS с проверкой сертификата. Plaintext SMTP разрешён только вне
production: для loopback hostname либо для объявленного перехватчика писем стенда
(`BILLING_CONTACT_SMTP_LOCAL_CAPTURE=true`), у которого нет ни домена, ни сертификата. В production
это объявление отклоняется при старте. Локальный Compose так направляет код подтверждения в Mailpit
на <http://127.0.0.1:8025>; наружу письмо не уходит, см.
[runbook локальной разработки](local-development.md#local-sale-bank-double-and-mail-capture). Nodemailer не читает файлы/URL и не включает debug logs.
SMTP acceptance не доказывает получение письма. Timeout оставляет `unknown`; повтор прежней команды
не отправляет снова. Пользователь может запросить новый код в рамках лимитов.

Ключ нужен для чтения сохранённых адресов после рестарта. Backup базы должен иметь отдельный
защищённый backup ключа. **Нельзя просто заменить ключ**: текущая версия envelope не реализует keyring
или автоматическую миграцию. Ротация требует отдельной контролируемой миграции ciphertext и
инвалидации pending challenges; изменение ключа HMAC также сбрасывает recipient-fingerprint
сопоставление. В #410 фоновые отправки читают подтверждённый контакт через интерфейс Accounts,
фиксируют revision получателя и заново проверяют её перед отправкой. SQL-доступ к чужому модулю запрещён.

## Локальное доказательство

`pnpm smoke:billing-contact` создаёт одноразовый Testcontainers PostgreSQL, локальный SMTP capture,
синтетическую Logto-compatible identity, настоящий API и Next BFF. Порты 6406/6407 должны быть свободны;
занятый порт приводит к отказу. Singleton Compose, существующие БД, credentials и реальные получатели
не используются. SMTP принимает только `@example.test`. Команда проверяет desktop/mobile ввод,
получение кода через реальный Nodemailer adapter, подтверждение, reload, no-store, WCAG и отсутствие
горизонтального overflow; сохраняет screenshots в `docs/evidence/issue-406`. После проверки останавливает
свои процессы, SMTP и контейнер. Не запускать одновременно с `pnpm check` в том же worktree: Next
использует одну build-директорию.

Это синтетическое доказательство. Подключение реального SMTP, sender/domain authentication,
доставляемость и реальное письмо требуют отдельного разрешения владельца. Реальные legal editions
приходят из #412; пустой production-каталог не разрешает принять выдуманный текст. Checkout и
окончательная визуальная приёмка входят в #407/#411; recurring, платежи, деплой не активируются этим PR.
