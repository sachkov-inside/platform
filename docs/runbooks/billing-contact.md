# Billing contact: хранение, отправка и проверка

[Историческая спецификация](../specifications/subscription-billing-v1.md#подтверждённый-контакт-и-согласия--406)
описывает подтверждение сохранённого контакта и его лимиты. В модели Product контакт остаётся
отдельным фактом Account для сохранённых адресов и служебных сообщений. Он не становится
Sign-in Email и не заменяет неизменяемый Order Email конкретной покупки. Форма подтверждения
сохранённого контакта в кабинете удалена; checkout принимает Order Email без такой формы. Accounts хранит адрес в AES-256-GCM envelope `v1`, со случайным nonce
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
[runbook локальной разработки](local-acceptance-sale.md#purchase-and-recovery). Nodemailer не читает файлы/URL и не включает debug logs.
SMTP acceptance не доказывает получение письма. Timeout оставляет `unknown`; повтор прежней команды
не отправляет снова. Пользователь может запросить новый код в рамках лимитов.

Ключ нужен для чтения сохранённых адресов после рестарта. Backup базы должен иметь отдельный
защищённый backup ключа. **Нельзя просто заменить ключ**: текущая версия envelope не реализует keyring
или автоматическую миграцию. Ротация требует отдельной контролируемой миграции ciphertext и
инвалидации pending challenges; изменение ключа HMAC также сбрасывает recipient-fingerprint
сопоставление. Service messages first resolve the confirmed contact through Accounts.
Without one, purchase messages resolve the encrypted order snapshot through BillingPayments (#1401).
The bank envelope key must remain available for reading these order addresses after restart.
Notifications records the recipient reference/version and checks it before provider I/O; it never reads another module's SQL schema.
The [purchase email policy](../product/subscription-billing-v1.md#purchase-email--1401) owns renewal fallback and later confirmation.

## Локальное доказательство

`pnpm smoke:billing-contact` создаёт одноразовый Testcontainers PostgreSQL, локальный SMTP capture,
синтетическую Logto-compatible identity, настоящий API и Next BFF. API и Next берут свободные порты
из диапазона `scripts/smoke-stand.mjs`; Next, запущенный без нужного маршрута, перезапускается.
Singleton Compose, существующие БД, credentials и реальные получатели не используются. SMTP
принимает только `@example.test`. На desktop и mobile команда проверяет отсутствие удалённой формы,
затем выполняет authenticated browser fetch через настоящий BFF: чтение собственного контакта,
запрос кода через реальный Nodemailer adapter, безопасный повтор операции, неверный код,
отказ другому Account подтвердить чужой challenge, подтверждение, reload и `private, no-store`.
Проверка сверяет точный синтетический адрес SMTP и сохранённый адрес собственного Account.
Это проверка оставшегося API, а не визуальное доказательство удалённой формы: она не заявляет
WCAG, overflow или новые screenshots контакта. Order Email и его интерфейс проверяются отдельно
в checkout. После проверки команда останавливает свои процессы, SMTP и контейнер. Не запускать одновременно с `pnpm check` в том же worktree: Next
использует одну build-директорию.

Это синтетическое доказательство. Подключение реального SMTP, sender/domain authentication,
доставляемость и реальное письмо требуют отдельного разрешения владельца. Реальные legal editions
приходят из #412; пустой production-каталог не разрешает принять выдуманный текст. Checkout и
окончательная визуальная приёмка входят в #407/#411; recurring, платежи, деплой не активируются этим PR.
