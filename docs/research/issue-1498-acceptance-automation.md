# Повторяемая приёмка банка, Telegram и email

Исследование для [#1498](https://github.com/sachkov-inside/platform/issues/1498), 15 октября 2026 года.
Проверенный исходный код: `d0ff7fde53ee70770abdedafabd29cf6e36caf99`.
Это предложение для решения владельца. Оно не вводит обязательный этап запуска и не разрешает внешние действия.

## Рекомендация

Расширить существующие проверки тремя полными маршрутами. Сначала связать локальные проверки единым запуском и отчётом.
Затем добавить отдельный HTTPS-стенд для проверок настоящих тестовых провайдеров.
Обычные проверки изменений сохраняют двойники провайдеров и не получают реальные credentials.

Первая версия должна проверять покупку с восстановлением, первую привязку ученика и возвращение в чат.
Браузером управляет Playwright; окончательный результат определяют проверяемые состояния приложения и провайдеров.
Агент помогает исследовать сбой и подготовить отчёт. Его оценка экрана не подтверждает оплату или принадлежность аккаунта.

Такой стенд позволит повторять первую привязку в изолированной базе с выделенной Telegram identity.
Он не докажет первую привязку этой identity в production и не закроет [#1493](https://github.com/sachkov-inside/platform/issues/1493).
Для production всё ещё нужен подходящий непривязанный участник SachkovLearn.

## Основания и границы исследования

| Тип основания | Что прочитано | Что это подтверждает |
| --- | --- | --- |
| Исходный код | Команды, конфигурации, fixtures и assertions, перечисленные ниже | Наличие проверок и их фактические границы; не успешный запуск в этой сессии |
| Исторические проверки терминала | [#402](../verification/issue-402-tbank-terminal-capability.md), 11 сентября; [#527](../verification/issue-527-tbank-payment-methods-demo.md), 23 сентября | Карточная тестовая оплата, сверка и возврат; не текущие настройки терминала |
| Сообщение владельца | [#1498](https://github.com/sachkov-inside/platform/issues/1498) | Владелец считает тестовый терминал удобным; это не полный перечень его возможностей |
| Production-приёмка | [Аудит #854 от 14 октября](https://github.com/sachkov-inside/platform/issues/854#issuecomment-6174265919), актуальное тело #854, [#1447](https://github.com/sachkov-inside/platform/issues/1447) | Уже подтверждены 100 ₽, доступ, полученные чек продажи и письмо; фискализация приложения остаётся pending |
| Официальная документация | Ссылки разделов о провайдерах, прочитанные 15 октября | Документированные возможности; доступность для нашего терминала и аккаунтов отдельно не проверена |
| Предложения | Маршруты, бюджеты, топология и задачи ниже | Проектируемая работа; время, стоимость и надёжность ещё не измерены |

Во время исследования не выполнялись платежи, возвраты, вход в реальные Telegram identities или изменение настроек провайдеров.
Текущие secrets и кабинет терминала не проверялись. Новая инфраструктура не создана.
Личная база знаний проверена в режиме поиска; профильных свидетельств о наших провайдерах там не найдено.

[#1494](https://github.com/sachkov-inside/platform/pull/1494) уже объединён с `main` и входит в исследованный код.
По последней записи [#854](https://github.com/sachkov-inside/platform/issues/854) он ещё не развёрнут.
Указанные там Platform v37 и Telegram v18 являются записанным состоянием, а не свежим чтением сервера.

## Что уже проверяет репозиторий

Все команды ниже существуют на указанном исходном коде. Инфраструктурные условия каждой команды сохраняются.
Инвентаризация не означает, что все команды запускались при исследовании.

| ID | Команда из корня | Главные файлы и assertions | Предел |
| --- | --- | --- | --- |
| C1 | `pnpm smoke:buyer-journey` | [launcher](../../scripts/buyer-journey-smoke.mjs), [fixture](../../apps/backend/scripts/buyer-journey-fixture.ts), [browser spec](../../apps/web/test/fullstack/buyer-journey.spec.ts). Настоящие Next/Nest/PostgreSQL; desktop/mobile; вход, закрытый Material, email заказа, оплата, права, покупки и программа Product | Банк и Telegram sign-in синтетические. Проверяется право `community`, а не реальное вступление в Telegram |
| C2 | `pnpm smoke:fullstack` | [script](../../scripts/full-stack-smoke.mjs). Home/Reader, API, делегированный MCP, authoring и проверка доступа через настоящие сервисы | Это техническая связность; не полный путь реального покупателя |
| C3 | `pnpm smoke:enrollments` | [launcher](../../scripts/enrollment-browser-smoke.mjs), [spec](../../apps/web/test/fullstack/enrollment.spec.ts). Назначение и отзыв, обновление открытого кабинета, ограничения состава через BFF/PostgreSQL | Identity синтетическая; не доставка банковских или Telegram событий |
| C4 | `pnpm test:integration` | [billing-payments](../../apps/backend/test/integration/billing-payments.test.ts), [one-time-purchase](../../apps/backend/test/integration/billing-one-time-purchase.test.ts), [local-bank-double](../../apps/backend/test/integration/billing-local-bank-double.test.ts). Конкурентные вкладки, подписи, pending/unknown, CheckOrder, SIGKILL, повтор, receipt отдельно от payment, восстановление покупки на другом устройстве | Настоящая БД; банк и каналы сообщений синтетические. Crash-файлы исполняются отдельным serial project |
| C5 | `pnpm test:integration` | [billing-operations](../../apps/backend/test/integration/billing-operations.test.ts), [payment-access-matrix](../../apps/backend/test/integration/payment-access-matrix.test.ts). Полный/частичный возврат, поздний CONFIRMED, отзыв только основания покупки, сохранение других оснований, Material/file/video/artifact | Не доказательство реального возврата или фактического исключения Telegram-участника |
| C6 | `pnpm test:integration` | [telegram-account-sign-in](../../apps/backend/test/integration/telegram-account-sign-in.test.ts), [community-entitlements](../../apps/backend/test/integration/community-entitlements.test.ts), [billing-notices](../../apps/backend/test/integration/billing-notices.test.ts), [billing-contact](../../apps/backend/test/integration/billing-contact.test.ts). Единственная identity, terms-before-link, потерянный ответ, права, уведомления и email-контакт | Внешние sign-in, доставка и Telegram membership заменены |
| C7 | `pnpm --filter @inside/telegram test:integration` | [activation](../../apps/telegram/test/integration/subscription-activation.integration.test.ts), [bot-sign-in](../../apps/telegram/test/integration/bot-sign-in.integration.test.ts), [community-v2](../../apps/telegram/test/integration/community-v2.integration.test.ts), [entitlements](../../apps/telegram/test/integration/community-entitlements.integration.test.ts). Eligibility, linking, replay, lease, собственное bot-expiry removal, moderator ban, invite ownership, уже вступивший участник | Настоящая persistence и тестовые provider ports; не реальные Telegram клиент, группы и доставка |
| C8 | `pnpm --filter @inside/telegram proof:course:provider` и `pnpm --filter @inside/telegram proof:course:browser` | [provider](../../apps/telegram/test/local/course-activation-provider.ts), [browser](../../apps/telegram/test/local/course-activation-browser.ts), также `proof:course:existing`. Browser linking, eligibility, один Enrollment, Material, synthetic join request и membership | Отдельная локальная подготовка, фиксированные порты и свежий `COURSE_PROOF_USER=64xxxxx`; output вне Git. Это не самостоятельный готовый запуск и не реальный Bot API |
| C9 | `pnpm identity:proof:hardening`; подготовка обычного стенда через `pnpm identity:proof:start`; `pnpm --filter @inside/web test:identity` | [identity corpus](../../apps/web/test/identity/identity-proof.spec.ts), [Telegram browser sign-in](../../apps/web/test/identity/telegram-sign-in.spec.ts), [bootstrap](../../scripts/identity-proof-bootstrap.mjs), [identity config](../../apps/web/playwright.identity.config.ts). Закреплённый Logto, Mailpit, лимиты OTP, отказ SMTP, callback и повтор входа | Требуют подготовленного окружения; hardening владеет уничтожаемыми volumes. Полный корпус нельзя вслепую запускать на общем стенде |
| C10 | `pnpm production:verify -- ...` | [production verifier](../../scripts/production-verify/verify.py), [release runbook](../runbooks/production-release.md). Версии и серверные проверки по выбранному профилю | Серверная доступность не доказывает доставку чека, первый learner login или полную покупку |

Назначение C8 уже близко к нужному маршруту первой привязки. Его необходимо упаковать, а не переписать другим framework.
Текущий browser proof повторяет `/community` до результата. Это не доказательство синхронного действия из #1467.
Старое [описание Telegram sign-in](../verification/telegram-sign-in-local.md) ссылается на исторический отдельный репозиторий.
Для новых задач исходные файлы под `apps/telegram` являются фактическим основанием.

CI уже содержит выбор проверок по изменённым файлам, full-stack в очереди и отдельные Telegram checks.
Источники: [ci.yml](../../.github/workflows/ci.yml), [coverage planner](../../scripts/ci-coverage-plan.mjs), [runbook](../runbooks/continuous-integration.md).
[#1430](https://github.com/sachkov-inside/platform/issues/1430) описывает принятый дизайн; текущие файлы уже реализуют его существенные части.
Несмотря на имя, [nightly-fullstack.yml](../../.github/workflows/nightly-fullstack.yml) теперь имеет только `workflow_dispatch`.
Новое исследование не должно возвращать удалённое ночное расписание общих проверок.

Дополнительно [product-access.test.ts](../../apps/backend/test/integration/product-access.test.ts) в C5 проверяет ручной отзыв всего Product через `revokeProductAccess`.
Тест охватывает несколько оснований, включая `wholePlatform`, сохраняет другой Product и проверяет повтор и отказ без полномочий.

## Матрица сценариев и пробелов

Manifest здесь означает файл, который связывает запуск, Account, Product и тестовые identities.

«Есть» здесь означает найденные assertions. Непрерывный реальный путь отмечен отдельно.

| Сценарий | Найдено | Что требуется дополнить |
| --- | --- | --- |
| Email sign-in и одноразовый код OTP | C9, C6 для billing contact | Единый чистый запуск; отдельная проверка доставки в выделенный реальный ящик |
| Первая Telegram-привязка с сохранением Product | C6–C9; C8 проходит локальный полный путь | Закрепить Product intent assertion на текущем flow; real client и свежая staging-база; production остаётся #1493 |
| Telegram Account с email и без email | C1, C4, C6 | Оба подготовленных состояния в общем manifest; запрет превращать email заказа в identity proof |
| Членство в исходной группе и отказ постороннему | C7–C8 | Настоящее `getChatMember` в выделенной source group; пересланная ссылка не даёт права |
| Grant и защищённый Material | C1, C5–C8 | Связать grant с ожидаемыми Account/Product и реальным provider run |
| Уже вступивший участник, no-chat, несколько Products | Отдельные membership assertions C7; полное меню не доказано | Проверки актуального flow из #1496: правильный Product, прямой chat action, отсутствие выдуманного приглашения |
| Приглашение и вступление | C7–C8; C1 доказывает только право | Настоящий learner client открывает приглашение; bot и приложение независимо видят member/applied |
| Возвращение после bot-expiry removal | C7; production-наблюдение #854 | Повторяемая staging-подготовка provenance; moderator ban должен остаться запретом |
| Успех, отказ, pending оплаты | C1, C4–C5 | Настоящая тестовая карта и банковский статус; зависание моделировать отдельно от подтверждённого отказа |
| Возврат без browser storage, refresh/retry | C4 восстанавливает ту же покупку на другом устройстве; C1 включает возврат после формы | Новый browser context без storage должен пройти текущую страницу возврата и продолжить ту же покупку |
| Защита от второго списания | C4–C5, включая параллельные вкладки и неизвестный Init | Считать bank Init/OrderId и PaymentId; внешнюю неопределённость не лечить новой покупкой |
| Чек и письмо | C4 receipt отделён от payment; C6 проверяет notice/dedupe | Отдельно доказать provider receipt callback, состояние приложения и доставку письма; #1447 остаётся открыт |
| Запоздалые, повторные, переставленные callbacks | C4–C5, C7 | Сохранить детерминированную инъекцию; реальный транспорт проверить отдельно, не приписывать sandbox произвольное управление порядком |
| Возврат и ручной отзыв одного Product | C3, C5, C7; отдельный `revokeProductAccess` тест выше | Различать отзыв основания и отзыв Product по всем основаниям; сохранять другой Product и соответствующий membership; возврат только через кабинет |
| Повтор запуска и остановка worker | C4 crash/unknown/replay; C7 lease/restart | Общий журнал незавершённых external effects, эксклюзивный runner и проверка cleanup после прерывания |
| Синхронный обычный путь | Текущие eventual-state проверки не доказывают требование | Измерять от действия до пригодной кнопки/приглашения; бюджет выбирается в #1467, реализация принадлежит #1496 |

## Три уровня доказательств

| Уровень | Что запускаем | Что доказывает | Чего не доказывает |
| --- | --- | --- | --- |
| Детерминированные проверки | Существующие suites и три локальных маршрута, управляемые doubles и clocks | Инварианты identity, money, access; сбои, replay, конкуренцию и восстановление | Реальные настройки, сеть, SMTP reputation, Telegram UI, рабочую кассу |
| Изолированная внешняя приёмка | Тот же код на HTTPS staging, тестовый терминал, отдельные Telegram ресурсы, Mailpit и выделенный inbox | Совместимость с выбранными настоящими провайдерами и реальную доставку на тестовых ресурсах | Production acquiring, production first-link и весь ассортимент способов оплаты |
| Контролируемая production-приёмка | Существующий release verifier и минимальные разрешённые сценарии #854/#1358 | Работу выбранных выпущенных версий и конкретных production-настроек | Все перестановки и будущие изменения провайдеров |

Сохранённый результат оплаты 100 ₽ повторно использовать с датой и выпущенными версиями.
Он не доказывает новый код checkout и не требует повторного списания ради нового отчёта.
После изменения проверять затронутый переход. Неизменённые факты сохранять со ссылкой на прежнее доказательство.

## Провайдеры

Банковские и Telegram/email основания приведены ниже. Возможности отделены от предложенных экспериментов.

### Банк

T-Bank описывает два разных тестовых режима. Нельзя автоматически переносить карты и настройки между ними.

| Контур | Документированный способ | Что известно о нашем приложении |
| --- | --- | --- |
| Двойник проекта | `TBANK_PROVIDER_MODE=test`, локальные endpoints | Исходы, подписанные уведомления и ledger принадлежат коду проекта, а не банку |
| DEMO-терминал | Терминал с суффиксом `DEMO`, `https://securepay.tinkoff.ru/v2`, сценарии кабинета | Поддержан текущей конфигурацией. Исторически проверены карточная оплата, GetState и возврат |
| Отдельная тестовая среда | Терминал без `DEMO`, `https://rest-api-test.tinkoff.ru/v2`, разрешённые IP клиента API и браузера | Текущая real-конфигурация закрепляет securepay. Для другого endpoint нужна отдельная ограниченная доработка |
| Production | Рабочий терминал и реальные операции | Сохранить ранее полученные доказательства. Тестовый терминал не подтверждает этот контур |

Источники: [DEMO test cases](https://developer.tbank.ru/eacq/intro/errors/test-cases),
[отдельная тестовая среда](https://developer.tbank.ru/eacq/intro/errors/test),
[конфигурация приложения](../../apps/backend/src/config/tbank-config.ts).
Часть прямых загрузок страниц банка завершалась timeout; использованы также индексированные фрагменты официальных страниц.
Это ограничивает полноту проверки документации и не заменяет проверку конкретного терминала.

| Возможность | Основание | Ограничение и место проверки |
| --- | --- | --- |
| Успешная оплата | DEMO cases; исторические #402/#527 | Минимальная внешняя проверка после проверки изоляции |
| Отказ | DEMO cases предусматривают REJECTED; отдельная среда имеет карты с отказами | Применимость конкретной карты к нашему DEMO не проверена; пока детерминированный double |
| Pending/прерванная форма | Init создаёт сессию; документация описывает срок redirect | Произвольное управление CONFIRMING не подтверждено. Unknown/паузы проверять двойником |
| Задержка, повтор и перестановка | Банк описывает retry доставки; AUTHORIZED и CONFIRMED могут приходить одновременно | Управление произвольным порядком не найдено. Детерминированные fixtures; при необходимости отдельный gateway задерживает передачу |
| Возврат браузера | SuccessURL/FailURL и GetState | Redirect не доказывает оплату. Проверять purchaseRef, банковский статус и владельца покупки |
| Отмена и возврат | Cancel API существует; #402/#527 исторически прошли карточный возврат | После #1420 продавец запускает возврат через кабинет банка. Platform не должен возвращать удалённый refunds.execute |
| Чек | Receipt и отдельное фискальное уведомление; тесты кабинета | Принятый формат не доказывает доставку callback или состояние приложения |

Источники: [Init](https://developer.tbank.ru/eacq/api/init),
[уведомления](https://developer.tbank.ru/eacq/intro/developer/notification/),
[фискализация](https://developer.tbank.ru/eacq/scenarios/fiscalization),
[исторический DEMO](../verification/issue-527-tbank-payment-methods-demo.md),
[текущие операции возврата](../runbooks/local-development.md#owner-billing-operations).
Документированные [тесты СБП](https://developer.tbank.ru/eacq/intro/errors/test-sbp) не делают СБП доступным нашему магазину.
Историческая проверка отмечает СБП выключенным; в первую версию его не включаем.

Изоляция должна охватывать адрес терминала, а не только `NotificationURL` отдельного Init.
По документации фискальные уведомления и уведомления привязки используют адрес терминала.
#527 фиксировал production-адрес как запасной адрес тестового терминала. Его текущее значение неизвестно.
Перед внешним запуском оператор должен подтвердить отдельную привязку только к acceptance ingress.
Если безопасно переиспользовать терминал нельзя, нужно согласовать отдельный тестовый терминал.

Банк ожидает HTTP 200 с телом `OK`. Документация описывает длительные повторы доставки после ошибки.
Поэтому окончание runner не означает окончание callbacks. Ingress должен сохранить возможность принять поздние события в изолированный архив.
В #527 банк не доставил callback на два туннеля за 25 минут.
Предположение о зарубежных адресах осталось гипотезой; подтверждённой причины нет.
Подписанный POST нашего инструмента доказывает обработчик, но не доставку из банка.
Основания: [правила уведомлений](https://developer.tbank.ru/eacq/intro/developer/notification/), исторический отчёт #527.

### Telegram

Bot API действует от имени бота. Он не подтверждает вход ученика и не может заменить его пользовательскую сессию.
Для проверки чужого membership Telegram гарантирует `getChatMember` при административных правах бота.
Приглашения и действия с участниками требуют соответствующих прав.
`unbanChatMember` сам не возвращает человека в группу; человек должен вступить заново.
Источники: [авторизация бота](https://core.telegram.org/bots/api#authorizing-your-bot),
[getChatMember](https://core.telegram.org/bots/api#getchatmember),
[приглашения](https://core.telegram.org/bots/api#createchatinvitelink),
[unban](https://core.telegram.org/bots/api#unbanchatmember).

Telegram документирует отдельную тестовую сеть для пользователей и ботов.
Bot API использует путь `/bot<token>/test/METHOD_NAME`; ресурсы этой сети отделены от основной.
Сначала стоит проверить её совместимость с нашим полным auth/deep-link/browser маршрутом.
Пока такая совместимость не доказана. Существующий код нельзя считать автоматически готовым к Test DC.
Резервные test identities имеют предсказуемые коды; Telegram предупреждает об их доступности другим людям и периодическом удалении данных.
Они подходят только для несекретных fixtures и не заменяют production identity.
Источники: [testing bots](https://core.telegram.org/bots/features#testing-your-bot),
[test accounts](https://core.telegram.org/api/auth#test-accounts).

Если тестовая сеть не поддерживает весь путь, запасной вариант требует отдельного решения владельца.
Это выделенный bot, две закрытые source/destination supergroups и два собственных learner accounts основной сети.
Владелец создаёт или предоставляет аккаунты, проходит login code, 2FA и подтверждение устройства.
Далее защищённая пользовательская сессия может обслуживать повторные тесты до истечения или отзыва.
Для узкого пользовательского драйвера подходит официальный TDLib; Telegram Web остаётся запасным UI-вариантом.
Источники: [TDLib authorization](https://core.telegram.org/tdlib/getting-started#user-authorization),
[получение api_id](https://core.telegram.org/api/obtaining_api_id), [2FA](https://core.telegram.org/api/auth#2fa).
Стоимость и доступность телефонных номеров не проверялись; создание аккаунтов в исследование не входит.

Одна identity обслуживает eligible/link/join/rejoin. Вторая проверяет постороннего участника и несовпадение identity.
Операции изменения membership выполняются последовательно с эксклюзивной арендой identity и чатов.
Нужно учитывать `retry_after`, ограничения входа и явные auth errors. Число допустимых действий нельзя считать постоянным.
Webhook и polling одновременно не используются; Telegram хранит неполученные updates не более 24 часов.
Источник: [получение updates](https://core.telegram.org/bots/api#getting-updates).

Условия Telegram отдельно ограничивают использование данных для AI и требуют согласования действий от имени пользователя.
Условия контента описывают исключения с явным согласием всех затронутых пользователей для конкретного контекста.
Владение ботом не даёт общего разрешения передавать агенту чужие сообщения или скриншоты.
Применимость исключения к выбранным synthetic chats пока не проверена.
Предлагается оставить Telegram-содержимое внутри детерминированного драйвера; агенту передавать обезличенные результаты assertions приложения.
Источники: [API terms §§1.4–1.5](https://core.telegram.org/api/terms),
[content licensing](https://telegram.org/tos/content-licensing). Это граница проектирования, а не юридическое заключение.

### Email

Mailpit уже участвует в локальном Logto proof. Первая версия должна отправлять письма обычным SMTP transport приложения.
Тест читает полученное письмо через API Mailpit. Прямая запись ожидаемого письма через HTTP обошла бы проверяемую доставку.
Mailpit доказывает получателя, содержание и приём SMTP, но не доставку через публичный MX или попадание во входящие.
Источники: [отправка](https://mailpit.axllent.org/docs/usage/sending-messages/),
[API](https://mailpit.axllent.org/docs/api-v1/), [SMTP](https://mailpit.axllent.org/docs/configuration/smtp/).

Реальный выделенный ящик проверяет доставку только выбранному почтовому провайдеру.
Нужны отдельные credentials и документированный read API либо IMAP; клиентскую почту читать не требуется.
Провайдер ящика ещё не выбран. Поддержка OAuth, aliases и plus-addressing нашим будущим ящиком не проверена.
До выбора нельзя обещать стоимость или полностью автоматический доступ.

Для каждого письма проверять адрес fixture, тип события, временную границу запуска и идентификатор покупки либо OTP-запроса.
Если шаблон не содержит purchaseRef, связать письмо через notice event и provider message ID; не угадывать по теме.
OTP должен относиться к текущему запросу, потребляться один раз и не появляться в отчёте.
Payment, fiscalization и grant подтверждать отдельными assertions приложения. Доставленное письмо не меняет их результат.
Удалять только письма своего run; общее удаление допустимо лишь в полностью одноразовом Mailpit.

## Выбор среды и способа управления

| Вариант | Надёжность и сопровождение | Расходы и ограничение | Решение |
| --- | --- | --- | --- |
| Одноразовые локальные сервисы и doubles | Уже существуют; легко воспроизводить faults, очереди и clocks | Время CPU и диска; внешний callback недоступен без отдельного ingress | Основа первой версии |
| Локальный стенд с временным туннелем | Мало инфраструктуры, но адрес и доступность меняются; #527 не подтвердил bank delivery | Нужна ручная координация; общий singleton нельзя занимать чужой сессией | Только ограниченный эксперимент на своём окружении |
| Отдельный HTTPS staging | Постоянный callback origin, закрытые данные, отдельные БД и очереди | Оплата compute/domain/storage возможна; фактические тарифы не выбраны | Рекомендуемый следующий шаг после локальной упаковки |
| Computer-use агент как основной runner | Меняющиеся решения и UI дают дополнительную вариативность | Tokens, latency, цена подписки/API и сопровождение; измерений нет | Не выбирать для финансовых и identity assertions |
| Playwright и узкие API-драйверы | Версионируемые шаги, selectors, assertions и bounded polling | Нужны обновления selectors и provider adapters | Основной runner; агент помогает с подготовкой и диагностикой |

Сравнение является инженерной оценкой, а не результатом benchmark.
[Playwright auth](https://playwright.dev/docs/auth) описывает отдельные contexts и защищённое хранение auth state.
[Trace viewer](https://playwright.dev/docs/trace-viewer-intro) помогает разбирать сбои, но trace может содержать tokens и персональные данные.
Материалы диагностики требуют закрытого хранилища и очистки перед публичным отчётом.

В staging нужны отдельные Platform и Telegram БД, Logto tenant/app, RabbitMQ namespace/vhost и object storage prefix/bucket.
Все API, workers и callback receivers должны работать на зафиксированных версиях своего приложения.
Проверка контура сверяет реальные endpoints, database identity и fingerprints терминала, bot и групп с разрешённым manifest.
Она должна отклонить production endpoints и несовпадение окружения до действия провайдера.
Секреты передаются через защищённые файлы или secret storage, без command arguments и публичных artifacts.
Публично доступен только необходимый ingress; owner/control endpoints и Mailpit остаются закрытыми.

## Жизненный цикл fixtures

Fixture задаёт заранее известное начальное состояние тестового ученика. Manifest фиксирует его связь с запуском и провайдерами.
Локальные базы можно создавать заново. Staging-привязку можно повторять в новой одноразовой базе с той же выделенной Telegram identity.
Это повторная первая привязка приложения в staging; production identity и финансовая история сохраняются.

| Fixture | Подготовка | Проверяемый результат |
| --- | --- | --- |
| Непривязанный eligible learner | Пустая app namespace; Telegram identity состоит только в test source group | После личного подтверждения ровно одна binding, нужный Product intent и grant |
| Email-authenticated learner | Logto создаёт fixture Account; OTP проходит через Mailpit | Linking сохраняет исходный Account и не присваивает чужую identity |
| Telegram learner без email / с email | Обычный sign-in; отдельный подтверждённый email только для второго случая | Email заказа не подтверждает identity и не меняет владельца покупки |
| Ineligible learner | Вторая identity отсутствует в source group | Чужая ссылка не выдаёт grant и приглашение |
| Existing Product holder/member | Назначение через действующие application operations; вступление через test client | Повтор сохраняет право и возвращает прямое открытие чата |
| No-chat / multiple Products | Каталог и правила через существующие application interfaces | Выбор ограничен Product; отсутствие чата не создаёт случайного приглашения |
| Отзыв и другие права | Несколько оснований Product A и отдельный Product B; `revokeProductAccess` через owner operation | Все основания A перестают открывать A; B остаётся доступным; отдельно отзыв одного основания сохраняет другое |
| Bot-expiry return | Тестовый clock запускает реальное правило истечения; сохраняется provenance удаления | Возврат снимает только собственное ограничение; moderator ban сохраняется |

Seed использует существующие каталожные и application interfaces; тестовые doubles управляют только принадлежащей им внешней стороной.
Если для состояния нет поддержанного способа подготовки, задача реализации добавляет ограниченный test-only fixture adapter.
Он работает только с одноразовой базой и запрещён в production.
Прямое удаление production identity/grant ради нового ученика не является reset.

Runner хранит журнал приобретённых ресурсов сразу после создания.
`finally` и supervisor освобождают процессы и аренды, отменяют run-specific invites и удаляют только свои Mailpit messages.
После падения следующий запуск сначала сверяет незавершённые provider effects, а затем продолжает cleanup.
Telegram membership возвращается в зафиксированное начальное состояние; общий модераторский запрет не снимается.
Финансовые записи и минимальные события аудита сохраняются по политике среды; cleanup не инициирует возврат автоматически.
Поздние callbacks сохраняют run mapping; база обработки не удаляется до согласованного закрытия окна доставки.

## Три маршрута первой версии

1. **Покупка и восстановление.** Telegram learner без trusted email открывает checkout, задаёт email заказа и оплачивает через double.
   Проверки связывают единственные OrderId/PaymentId, purchase, grant, Material и одно purchase-email событие.
   Новый browser context открывает возврат без storage; refresh и повтор не создают новую оплату.
   Один отказ и один unknown исход проверяются теми же детерминированными границами.
2. **Первая привязка и обучение.** Eligible identity начинает с Product-ссылки без app binding.
   Личный sign-in/link сохраняет Product; проверяются canonical Account, eligibility, один grant, защищённый Material и вступление.
   Ineligible identity получает отказ без доступа. Локально переиспользуется C8; внешне проверяются настоящие provider seams.
3. **Возвращение и отдельный отзыв.** Existing member получает прямое открытие своего Product chat.
   После собственного bot-expiry removal learner получает пригодное приглашение и вступает снова.
   Ручной отзыв Product A закрывает A по всем основаниям и сохраняет Product B.
   Отдельно отзыв только одного основания сохраняет доступ по другому. Повтор и остановка worker сохраняют итог.

Обычное действие «Чат курса» проверяется как один запрос пользователя до пригодного результата, без ручного повторного запроса.
[#1467](https://github.com/sachkov-inside/platform/issues/1467) должен задать бюджет времени; #1496 реализует и проверяет этот flow.
До согласования бюджета отчёт сохраняет измеренное время, но не выдаёт произвольный timeout за принятую UX-норму.

## Политика запуска и доказательств

Обычные PR и очередь сохраняют существующий planner и проверки без secrets.
Первая внешняя версия запускается вручную на защищённом environment после проверки конкретного состава ресурсов.
Ночное расписание пока не нужно. Его можно отдельно предложить после измерения стабильности, стоимости и остатка ручных действий.
Это не возвращает удалённый nightly full-stack и не меняет #1430.

Начальные экспериментальные пределы: один external worker, 30 секунд ожидания app/mail и 60 секунд membership.
Это ограничения эксперимента, а не обещания провайдеров или принятый бюджет нормального действия.
Истечение бюджета завершает проверку с причиной. Browser tests имеют `retries=0`, как требуют стандарты проекта.
Provider `retry_after` соблюдается; неоднозначный финансовый исход требует сверки прежней операции, а не её нового запуска.

Отчёт различает application failure, подтверждённый provider outage, неподготовленную fixture, истёкшую сессию и неподтверждённый timeout.
Timeout сам по себе не доказывает сбой провайдера. После исправления новая попытка получает новый run ID и сохраняет предыдущую неудачу.
Для deterministic CI действует существующая процедура диагностики и повторов из WORKFLOW.

Отчёт запуска должен содержать:

- commit/tree, image digests и разные версии Platform/Telegram/Logto;
- ревизии Product/Offer/Material, seed и scenario runner;
- run ID, время начала/окончания, contour, origins и fingerprints provider resources без secrets;
- ожидаемые и фактические Account/Product/purchase/event связи в закрытых artifacts;
- каждый assertion, источник наблюдения, latency и самостоятельный статус payment/receipt/email/grant/membership;
- код ошибки, redacted network metadata, trace/log references и результат cleanup;
- отдельно выполненные, не выполненные и повторно используемые исторические проверки с их областью применимости.

Для сопоставления результатов нужны одинаковые существенные inputs. Зелёный отчёт с другим терминалом или контентом не заменяет проверку выбранного выпуска.
Реальные provider события и environment identity сохраняются в закрытом отчёте; публичная карточка содержит только безопасные ссылки и статусы.

## Implementation proposals

These scopes are proposals for later assignment, not new tickets or current implementation authorization.

### A. Package the existing local acceptance journeys

Reuse C1, C3, C8 and C9. Add one owned launcher, fixture manifest and evidence schema.
Keep existing domain assertions; add only missing cross-boundary assertions from the matrix.
Make setup, seed, run and cleanup explicit subcommands behind one aggregate command.
The exact command name belongs to implementation, not this research.

Acceptance criteria:

- All three journeys run from fresh disposable data without provider credentials or owner interaction.
- Wrong Account/Product, duplicate payment/grant, stale OTP and missing-storage recovery failures produce nonzero exits.
- A normal chat action needs no repeated user command; its accepted response budget comes from #1467/#1496.
- Three independent runs preserve identity and financial invariants; one interrupted run resumes without duplicate effects.
- Success, failure and interruption release owned processes and resources; evidence records cleanup failures.
- Existing check commands, review and required CI remain green. Update the owning runbook after adding commands.

Failure evidence: assertion name, manifest/input versions, redacted trace, application event references and cleanup outcome.

### B. Prove isolated external providers on a small staging setup

Start only after the owner selects the concrete infrastructure, cost and resource permissions.
First probe Telegram Test DC compatibility; propose a separate main-network fixture only if that probe fails.
Use the existing DEMO terminal only after verifying terminal-level and per-payment callback isolation.
Reuse task A's runner and assertion schema; keep fault permutations local.

Acceptance criteria:

- Preflight rejects production origins, wrong provider fingerprints, shared databases and unapproved resource bindings.
- An authentic bank callback reaches the isolated receiver; one DEMO success and one supported rejection have independent bank/app evidence.
- Separate fiscal callback and inbox outcomes remain explicit; unsupported capabilities are reported as unverified.
- The learner client completes first staging link, real source eligibility and real destination join with the correct Account/Product.
- Three serial runs and one interrupted-worker recovery work after initial owner login, or identify the precise unsupported seam.
- Session expiration, rate limits, callback delay and fixture collision produce actionable failures without hidden retries.
- Cleanup preserves financial history and handles late callbacks; no production reset, real charge or refund occurs.

Failure evidence: provider error/status, callback provenance, protected session/setup status, run-specific effects and cleanup ledger.
One optional DEMO cabinet refund may be proposed later with its operator scope; it is not required to prove task B's first slice.

### C. Add opt-in operation and exact-version release evidence

Use the existing protected workflow/environment and release-evidence contracts.
Keep external-provider runs outside ordinary PR checks and preserve current deterministic queue coverage.

Acceptance criteria:

- A manual run pins code/content/provider identity and leases the fixture pool before mutation.
- The result separates product failure, provider failure, setup-required and unverified branches with preserved first-attempt evidence.
- Mail assertions correlate recipient, notice/purchase and bounded delivery; the real inbox contains no customer mail.
- Protected artifacts exclude credentials from public output and have an explicit retention/cleanup policy.
- Reused production evidence names its original versions; changed seams request fresh applicable checks without automatic payments.
- Document operating ownership, session renewal, provider changes and costs before proposing any recurring schedule.

## Что остаётся владельцу

Для локальной упаковки новые аккаунты и платные сервисы не нужны. Она требует разработки, а не согласования нового провайдера.
Для внешнего этапа нужно выбрать конкретный HTTPS hosting, терминал, inbox и допустимый Telegram контур.
Владелец подтверждает фактическую цену до создания инфраструктуры; коммерческое предложение в исследовании не получено.

| Ресурс | Предложенная модель затрат | Первое действие человека | Сопровождение |
| --- | --- | --- | --- |
| Локальные doubles/Mailpit | Без новой подписки; CPU, диск и разработка | Нет | Обновлять runner вместе с приложением |
| HTTPS staging | Compute, storage и при необходимости domain; сумма не проверена | Выбрать конкретный hosting и расходы | Ответственный за версии, ingress, secrets и поздние callbacks |
| DEMO-терминал | Доступность и условия отдельного терминала не подтверждены | Проверить кабинет, notification binding и назначенные test cases | Повторять preflight при изменении настроек |
| Telegram Test DC | Совместимость неизвестна; собственный experiment | Подготовить разрешённый test context | Учитывать очистку test accounts и изменения API |
| Telegram main-network fallback | Возможные расходы на собственные номера/SIM | Предоставить аккаунты, code/2FA, разрешения бота и операции в test groups | Восстанавливать истёкшие сессии; сохранять эксклюзивный доступ |
| Реальный inbox | Тариф выбранного провайдера неизвестен | Выбрать отдельный mailbox и доступ | Продлевать auth, проверять delivery; не добавлять клиентскую почту |
| Агент | Использование модели и время работы; измерений нет | Дополнительные разрешения только для выбранных внешних действий | Читать безопасные результаты; не заменять assertions |

Минимальная оставшаяся production-приёмка следует #854/#1358: версии, изменённый buyer flow, настоящая receipt synchronization и отложенные проверки.
Первая production-привязка остаётся #1493; новые реальные оплата/возврат требуют конкретного разрешения.
Публикация сообщения в source group, финансовые решения и открытие продаж сохраняют владельца действия.
Обычные повторные staging-прогоны можно передать runner после первоначального ограниченного разрешения и настройки.
Истёкшая сессия, CAPTCHA или 2FA возвращают задачу человеку; тест не обходит эти проверки.

Следующим этапом рекомендуется задача A. После неё задача B проверяет спорные provider seams до расширения инфраструктуры.
#1496 остаётся владельцем Telegram flow; #1447 остаётся владельцем fiscalization discrepancy.
#1358 и #854 используют новые доказательства только там, где совпадают версии и условия.
Исследование не повторяет реализацию #1494, не занимает production writer и сохраняет публичные продажи закрытыми.
