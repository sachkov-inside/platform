# Т-Бизнес и подписка Inside: проверенные возможности и границы переноса

Дата исследования: 2026-09-06. Задача: [Platform #341](https://github.com/sachkov-inside/platform/issues/341).
Контекст: [Workspace #127](https://github.com/sachkov-inside/workspace/issues/127),
правила продукта обсуждаются в [#128](https://github.com/sachkov-inside/workspace/issues/128),
аналитический контракт принадлежит [Platform #337](https://github.com/sachkov-inside/platform/issues/337).

Статус: исследование, рекомендации и план проверки. Это не утверждённая спецификация подписки
и не подтверждение готовности банка или приложения к реальным списаниям.

## Что можно использовать

Техническое направление подходит для собственной подписки Inside: сервер создаёт платёж,
банк принимает данные карты, а приложение подтверждает покупку по серверным сведениям банка.
Для автоматического продления нужны отдельно подключённая возможность банка, согласие покупателя,
сохранённая платёжная привязка и собственное расписание приложения. Обоснование возможностей банка
и ссылки приведены в разделе «Банк» ниже.

В Education уже есть полезные механизмы: сохранение заказа до обращения к банку, проверка подписи
и соответствия платежа заказу, сериализация конкурирующих обработчиков, восстановление потерянного
результата, повторяемая выдача доступа и сохранение событий вместе с изменением состояния.
Но перенос целого модуля не подходит: у Education свои Product/Offer/Plan/Program/Grant,
политика продления и совместимость со старой моделью. Возврат через административный endpoint
ещё заглушка; полноценная смена карты и контроль фискального результата в исследованном контуре
не найдены. Наличие этих файлов не доказывает работу production.

Рекомендация для следующего решения: сначала проверить hosted checkout с переходом на форму банка
и карточное продление на DEMO. Для нового оплаченного доступа рассмотреть Platform как владельца
расчётов и оплаченного периода, а Telegram — как потребителя решения о доступе. Выбор automatic/manual,
redirect/iframe и владельца доступа остаётся за #128; этот отчёт не меняет действующий контракт.

## Источники и границы проверки

- Education: `miracle-generation/education-platform`, revision
  `8ce97fcd1c75bdbbde661ec162b7a9da82930012`; checkout был чистым при чтении и повторной проверке.
  Это точный исследованный код, не утверждение о deployed revision.
- Inside Platform: база `43275923c6dde086b5fcf6a4cad1a39efcff0530`, текущий `origin/main`
  при создании ветки исследования. [Текущий контракт](../specifications/platform-v1.md),
  [термины](../../CONTEXT.md),
  [валидатор MembershipEvidence](../../apps/backend/src/modules/membership-entitlements/features/accept-evidence/validate-membership-evidence.ts).
- Официальные документы Т-Банка просмотрены в дату исследования. Схемы API и требования могут меняться;
  перед реализацией повторно проверить выбранные методы и параметры.
- Два скриншота владельца в сессии: список терминалов и настройка тестового терминала магазина SachkovLearn.
  Изображения, пароли, идентификаторы терминалов, email и полный адрес уведомлений не включены в Git.
- Доступный UI проверен: в Firefox открыта страница GitHub; открытого кабинета Т-Бизнес не обнаружено.
  Новая авторизация не выполнялась. Факты о кабинете ниже основаны только на скриншотах.
- Education читался без изменений. Payment API, production data, терминалы, платежи, возвраты,
  миграции и отправка сообщений не запускались. Тесты Education только прочитаны, не выполнены.

## Что доказывают скриншоты терминала

| Наблюдение | Что подтверждено | Чего оно не доказывает |
|---|---|---|
| Магазин SachkovLearn, тестовый и рабочий терминалы, подключение «Универсальное» | Интернет-эквайринг уже заведён; рабочий терминал отображается включённым | Пригодность того же магазина для Inside, отдельное подключение COF, СБП-привязок и нужных способов оплаты |
| Тестовый терминал предлагает протестировать платежи | Есть DEMO-терминал для дальнейшего proof | Пройденные испытания, успешный recurring и его включение на рабочем терминале |
| HTTP-уведомления включены; виден адрес `trycloudflare.com` | В тестовом кабинете указан адрес уведомлений | Работоспособность туннеля сейчас, полная строка пути и её совпадение с актуальным endpoint, доступность из банка |
| Email-уведомления включены | Настроен дополнительный канал уведомлений магазина | Подтверждение оплаты приложением или доставка фискального чека покупателю |
| Страницы успеха и ошибки — стандартные банковские | Текущие настройки возврата тестового терминала | Фактические URLs отдельного платежа: Init может передать свои значения |
| Вкладка онлайн-кассы видна, содержимое не показано | Можно перейти к отдельной настройке | Провайдер кассы, регистрация, ФФД, налоговые параметры, чеки продажи/продления/возврата |

Чтобы снять неизвестность перед proof, нужен просмотр настроек/подтверждение банка по COF отдельно
для DEMO и рабочего терминала; список включённых способов; конфигурация кассы; полный действующий
callback и режим одностадийной оплаты. Research не требует присылать ключи в чат. Если Inside
понадобится отдельный магазин/терминал, сначала определить его границы, включая namespace CustomerKey:
привязки Education нельзя автоматически считать согласиями на списания за Inside.

## Банк

### API и первичная оплата

Для собственного приложения подходит EACQ API и банковская форма с подключением «Универсальное».
[Модули CMS](https://developer.tbank.ru/eacq/modules) предназначены для перечисленных CMS и не
заменяют модуль подписок Inside. При hosted checkout backend делает Init, frontend получает
PaymentURL и переводит покупателя на форму банка. Реквизиты вводятся на стороне банка.
[Сценарий банковской формы](https://developer.tbank.ru/eacq/scenarios/payments/nonPCI/).

Init принимает Amount в копейках, OrderId, TerminalKey и Token. PayType=O задаёт одностадийную
операцию, T — двухстадийную. NotificationURL/SuccessURL/FailURL могут переопределять настройки
терминала для платежа. Начальный recurring требует Recurrent=Y, CustomerKey и
DATA.OperationInitiatorType=1; при другом явно переданном OperationInitiatorType значение Recurrent
может быть проигнорировано. Это объясняет, почему одного флага Recurrent недостаточно.
[Init API](https://developer.tbank.ru/eacq/api/init).

Init.Success сообщает о запросе, а NEW — о создании операции. AUTHORIZED означает авторизацию/холд,
CONFIRMED — списание. При двух стадиях SuccessURL может открыться ещё на AUTHORIZED.
Следовательно, browser return не является доказательством оплаты.
[Оплата картой](https://developer.tbank.ru/eacq/scenarios/payments/nonPCI/card/).

Банк [отдаёт приоритет OpenAPI](https://developer.tbank.ru/eacq/intro/developer/openapi)
при расхождении с текстом. Прочитана [официальная схема](https://developer.tbank.ru/schemas/eacq/openapi.yaml)
`info.version=1.32`, SHA-256 `e7686a38723144e739d9268bffb8a6df40d53d98caac18722f92f7043a749ecd`.
В ней CheckOrder возвращает Payments[], а GetState допускает необязательный RebillId.
У Charge описаны CONFIRMED/REJECTED, тогда как общий сценарий COF допускает две стадии:
при выборе двухстадийного recurring нужно снять это расхождение отдельным proof/уточнением банка.

### Способы оплаты и автосписания

COF — платёж по сохранённым реквизитам. По умолчанию он выключен; банк описывает отдельное
подключение DEMO через поддержку и рабочего терминала через менеджера. Родительская операция
сохраняет согласие/привязку; RebillId приходит в уведомлении об авторизации. Для каждого следующего
платежа нужен новый Init, затем Charge с RebillId. DATA.OperationInitiatorType различает инициативу
покупателя (2), merchant recurring (R) и installment (I).
[Карточный COF](https://developer.tbank.ru/eacq/scenarios/payments/nonPCI/autopay/).
Метод [Charge](https://developer.tbank.ru/eacq/api/charge) принимает PaymentId нового платежа и
RebillId; CustomerKey и CardId не заменяют этот token.

| Способ | Первая оплата | Следующая оплата | Ограничение доказательств |
|---|---|---|---|
| Карта | Hosted form, при recurring — родительская CC-покупка | Init → Charge(RebillId) | COF конкретного терминала неизвестен; нужны сохранённое согласие и проверка parent/child |
| T-Pay | Банковская форма / выбранный сценарий T-Pay | Та же схема COF, что у карты | Наличие обычного T-Pay не доказывает recurring enablement |
| Mir Pay | Выбранный сценарий Mir Pay | Общая инструкция COF прямо допускает MIR Pay | Отдельные mobile/terminal условия и parent→child proof для магазина не проверены |
| СБП | Разовая оплата либо отдельный сценарий привязки счёта | Init → ChargeQr(AccountToken) | Только API, одна стадия; это другая привязка, не RebillId |
| Остальные способы | Зависит от включённых способов и формы | В этом исследовании не доказано | Не обещать автопродление через SberPay, Alfa Pay или Долями по общему списку способов |

T-Pay прямо описывает COF по карточной схеме, одно-/двухстадийность и полный/частичный возврат.
Покупатель возвращается на сайт по кнопке; отсутствие возврата не означает отсутствие оплаты.
[T-Pay](https://developer.tbank.ru/eacq/scenarios/payments/nonPCI/t-pay/).

СБП позволяет привязать счёт до или вместе с оплатой. AccountToken приходит отдельным уведомлением
на URL из настроек терминала, а не на переопределённый Init.NotificationURL. Поддержка разового QR
не доказывает работоспособность привязки. В описаниях DATA.QR встречаются разные представления типа;
перед реализацией сверить схему выбранного метода и контрактный тест.
[СБП COF](https://developer.tbank.ru/eacq/scenarios/payments/PCI_DSS/autopay/),
[ChargeQr](https://developer.tbank.ru/eacq/api/charge-qr).

**Инженерный вывод:** API предоставляет операции списания. Собственное расписание, paid period,
согласие, отмена подписки, правила повторных попыток и grace остаются задачами приложения.
Выбор R/I определяется согласованным коммерческим сценарием, а не одним словом «ежемесячно».

### Уведомления и восстановление результата

Token рассчитывается как SHA-256 UTF-8 от значений корневых полей, отсортированных по ключам,
с добавленным Password. Token, вложенные объекты и массивы исключаются; DATA и Receipt не входят
в подпись. Password не отправляется отдельным полем запроса.
[Алгоритм Token](https://developer.tbank.ru/eacq/intro/developer/token).
Для входящего webhook учитывать фактические корневые поля JSON, включая незнакомые DTO поля;
вложенные данные не считать защищёнными этой подписью.

После обработки банк ожидает HTTP 200 с телом `OK`; без подтверждения повторяет доставку каждый
час первые 24 часа, затем ежедневно в течение месяца. Одностадийный платёж может прислать
AUTHORIZED и CONFIRMED одновременно. Ожидание синхронного ответа — до 10 секунд. Уведомления
привязок и фискализации используют терминальный URL; фискальные уведомления подключаются отдельно.
[Уведомления](https://developer.tbank.ru/eacq/intro/developer/notification).
Рекомендация Inside: отвечать OK только после durable принятия; тяжёлые эффекты выполнять повторяемо
после этого, с отдельным контролем сбоя выдачи доступа.

Для известного PaymentId есть [GetState](https://developer.tbank.ru/eacq/api/get-state),
для OrderId — [CheckOrder](https://developer.tbank.ru/eacq/api/check-order).
В документации есть промежуточные PAY_CHECKING/CONFIRM_CHECKING, REFUNDING/ASYNC_REFUNDING/REVERSING
и отдельные REFUNDED/PARTIAL_REFUNDED/REVERSED/PARTIAL_REVERSED. Столбец «Конечный» также помечает
NEW и AUTHORIZED, поэтому его нельзя механически переводить в запрет всех дальнейших переходов.
[Статусы операций](https://developer.tbank.ru/eacq/intro/developer/operation-statuses).

В изученных Init/Charge не найден контракт безусловного безопасного retry после timeout.
Отсутствие результата сразу после сбоя также не доказывает, что запрос не исполнен.
Рекомендация: хранить неопределённость, сверять исходную попытку, а сроки/гарантии появления операции
в CheckOrder и возможного повторения Charge подтвердить до разрешения автоматического retry.

### Возвраты и фискализация

Cancel различает отмену NEW, снятие холда AUTHORIZED и возврат CONFIRMED; поддерживает полные
и частичные операции. Для NEW отмена всегда полная, Amount игнорируется.
При подключённой кассе для частичного возврата передают позиции Receipt;
для полного сценарий описывает автоматическое формирование возвратного чека без Receipt.
[Отмена и возврат](https://developer.tbank.ru/eacq/scenarios/cancel_confirm/).
Cancel.ExternalRequestId проверяет повтор уже существующего запроса отмены. Пустое/отсутствующее
значение выключает эту проверку; это не гарантия idempotency для Init/Charge.
[Cancel API](https://developer.tbank.ru/eacq/api/cancel).

Для банковской/собственной формы данные прихода передаются в Init. При двух стадиях Receipt из
Confirm имеет приоритет; для расчёта с предоплатой/авансом предусмотрен отдельный закрывающий чек.
ФФД зависит от подключения кассы. Payload Receipt и успешный платёж ещё не доказывают результат
фискализации. Налоговые параметры, контакт покупателя и применимость full_payment/предоплаты
нужно подтвердить по конкретному продукту и кассе.
[Работа с чеками](https://developer.tbank.ru/eacq/scenarios/fiscalization/).

### Redirect, iframe, mobile, 3DS и CSP

Iframe официально поддержан через Integration.js; Init остаётся на backend, для вложенных iframe
скрипт требуется на каждом уровне.
[Настройка iframe](https://developer.tbank.ru/eacq/intro/developer/setup_js/setup_iframe/).
Инструкция требует HTTPS, отсутствия Cross-Origin-Opener-Policy, разрешений CSP для банковских
доменов и `unsafe-inline` для стилей. Для iframe платёжной формы она запрещает frame-src, поскольку
он мешает 3DS; правила кнопок отличаются. Скрипт загружается с банковского CDN.
[Требования Integration.js](https://developer.tbank.ru/eacq/intro/developer/setup_js/).
Это основания для отдельного security/browser proof, а не команда ослабить текущие заголовки Inside:
нужно проверить также итоговую CSP с default-src и фактическую 3DS-цепочку.

Специализированная инструкция мобильной интеграции указывает Chrome Custom Tabs для Android и
SFSafariViewController для iOS, ограничивает альтернативные WebView и сообщает об отключении
старого SDK с 1 марта 2026. Это инструкция native integration, не доказательство работы Telegram
browser. [Мобильная интеграция](https://developer.tbank.ru/eacq/scenarios/payments/mobile/).
Рекомендация начинать с redirect уменьшает объём встраивания и изменений CSP; мобильные переходы
в банк, 3DS, возврат и восстановление сессии всё равно требуют испытаний.

### Тестовый контур

DEMO-терминал использует `https://securepay.tinkoff.ru/v2`; кабинетные группы испытаний включают
платежи, автоплатежи и чеки. [DEMO test cases](https://developer.tbank.ru/eacq/intro/errors/test-cases).
Отдельная среда `https://rest-api-test.tinkoff.ru/v2` использует ключ без DEMO и предварительно
разрешённые IP, включая IP открытия формы. Эти два режима нельзя смешивать.
[Тестовая среда](https://developer.tbank.ru/eacq/intro/errors/test).
Для скриншотного DEMO сначала применим кабинетный режим; ни один URL API в ходе research не вызывался.

## Сравнение с Education

В таблице «есть» означает наличие исследованной реализации, а не пройденный live proof.
Обозначения E1–E15 раскрыты в списке точных файлов ниже.

| Область | Уже есть в Education | Отсутствует / требует настройки / неизвестно для Inside |
|---|---|---|
| Checkout Init → PaymentURL | Сервер выбирает цену по OfferPriceId; фиксирует заказ, цену и покупателя; проверяет HTTPS и банковский host URL. E1, E2 | В Inside нет собственного billing checkout; нужны предложения, Account binding, возврат на свой экран статуса и настройки терминала |
| Начальный recurring | Recurrent=Y, CustomerKey=userId, DATA.OperationInitiatorType=1; разовая покупка использует 0. E1 | Включённость COF неизвестна; согласие на новый продукт и правила Inside отсутствуют |
| Signed notifications | Подпись фактических корневых JSON-полей, TerminalKey, OrderId, Amount, PaymentId, provider/channel/RUB snapshot; ACK после сохранения. E3 | Нужен собственный endpoint, secret storage, проверка схемы и durable inbox/аудит; код не переносит настройки кабинета |
| Dedupe и конкуренция | Заказ блокируется FOR UPDATE; advisory locks для checkout/renewal; unique ExternalProviderRef и xmin; единая транзакция с grant/audit/outbox. E3–E5 | В Inside определить ключи с учётом provider+terminal+PaymentId, блокировку периода подписки и replay; глобальный индекс Education не объявлять универсальным |
| Неизвестный исход Init | PENDING и reservation сохранены до вызова; network error не создаёт второй Init по тому же ключу. CheckOrder восстанавливает единственный совпавший платёж. E1, E6 | Нужен контракт UI «уточняем оплату» и безопасное завершение неопределённости; повторный клик не должен создавать второе списание |
| Неизвестный исход Charge | Сохраняет PaymentId и CHARGE_CALLED до отправки; после сбоя сначала GetState; даже NEW после CHARGE_CALLED не разрешает повтор. E7 | Аналогичная гарантия для нового scheduler, отдельно проверенная падениями процесса; автоматический retry всех POST недопустим |
| Выдача оплаченного доступа | PAID отделён от AUTHORIZED; billing/grant/outbox применяются согласованно. Есть generic и legacy пути. E3, E4, E9 | Inside MembershipEntitlement сейчас выводится из Telegram evidence; смена владельца требует shared contract, а не переименования PlanGrant |
| Период и расписание | BillingSubscription хранит PaidThrough, NextChargeAt, grace, отмену, reference и Revision; sweeper вызывает Init→Charge. E7–E9 | Правила Education: T−24ч, T, T+48ч, 72ч grace, 3 попытки. Это НЕ правила Inside |
| Cancel/resume | Authenticated owner endpoints, проверка владельца, shared renewal lock, синхронизация доступа; отмена сохраняет оплаченный период. E8 | Отмена будущего списания не возвращает деньги и не удаляет карту; race с уже отправленным Charge требует выбранного поведения |
| Смена карты | Есть GetCardList и прикрепление PaymentMethodRef; missing RebillId восстанавливается только при одной активной карте. E6, E8 | End-to-end AddCard/RemoveCard/change-card flow в исследованном AccessService не найден. Единственная карта CustomerKey не доказывает согласие именно этой подписки |
| СБП recurring | В исследованном AccessService не найдены ChargeQr/AccountToken | Отдельная реализация и подключение; RebillId нельзя подставить вместо AccountToken |
| Возвраты | Клиент Cancel есть; обработка REFUNDED и возврата renewal есть; часть пропущенных возвратов проверяет reconciliation. E4, E6, E10 | Admin RefundOrder — 501; partial refund — NOOP/аудит; нет полной суммы/ExternalRequestId/Receipt-модели возврата в CancelAsync. Нужен отдельный refund workflow |
| Чеки | Init и renewal получают Receipt; builder ориентирован на CloudKassir, full_payment/service, Tax=none; fallback email. E11 | Настройка кассы неизвестна. Не найдены SendClosingReceipt и обработчик результата фискализации. Tax, контакт и момент расчёта нельзя переносить как готовое решение |
| Наблюдаемость и аналитика | OrderEvent, метрики, outbox событий grants и изменений entitlement. E3, E4, E9 | Это не готовый subscription analytics stream для #337; нет подтверждённого платёжного источника внутри Inside |

### Точные указатели Education

Все E-ссылки ниже фиксируют одну revision. Корень файлов: `backend/AccessService/`.

- **E1 — checkout**: [CreateOrderAndInitiatePayment.cs, L519](https://gitlab-sachkov.ru/miracle-generation/education-platform/-/blob/8ce97fcd1c75bdbbde661ec162b7a9da82930012/backend/AccessService/src/AccessService.Core/Features/Billing/UseCases/CreateOrderAndInitiatePayment.cs#L519): Init и OperationInitiatorType; L566–593 reservation перед вызовом; L689 неизвестный исход. [CreateOrderRequest.cs](https://gitlab-sachkov.ru/miracle-generation/education-platform/-/blob/8ce97fcd1c75bdbbde661ec162b7a9da82930012/backend/AccessService/src/AccessService.Contracts/Billing/CreateOrderRequest.cs).
- **E2 — API client**: [TBankClient.cs, L90](https://gitlab-sachkov.ru/miracle-generation/education-platform/-/blob/8ce97fcd1c75bdbbde661ec162b7a9da82930012/backend/AccessService/src/AccessService.Core/Features/Billing/TBank/TBankClient.cs#L90): response/URL validation; L169 GetState; L192 CheckOrder; L266 GetCardList; L330 Charge; L410 Cancel.
- **E3 — webhook**: [TBankWebhook.cs, L151](https://gitlab-sachkov.ru/miracle-generation/education-platform/-/blob/8ce97fcd1c75bdbbde661ec162b7a9da82930012/backend/AccessService/src/AccessService.Core/Features/Billing/UseCases/TBankWebhook.cs#L151): подпись и matching; L407 commit; L434 hash по actual JSON. [TBankSignature.cs](https://gitlab-sachkov.ru/miracle-generation/education-platform/-/blob/8ce97fcd1c75bdbbde661ec162b7a9da82930012/backend/AccessService/src/AccessService.Core/Features/Billing/TBank/TBankSignature.cs): SHA-256 и FixedTimeEquals; это не HMAC, несмотря на отдельный комментарий в клиенте.
- **E4 — применение оплаты**: [PaymentWebhook.cs, L143](https://gitlab-sachkov.ru/miracle-generation/education-platform/-/blob/8ce97fcd1c75bdbbde661ec162b7a9da82930012/backend/AccessService/src/AccessService.Core/Features/Billing/UseCases/PaymentWebhook.cs#L143), [SerializedPaymentApplication.cs](https://gitlab-sachkov.ru/miracle-generation/education-platform/-/blob/8ce97fcd1c75bdbbde661ec162b7a9da82930012/backend/AccessService/src/AccessService.Core/Features/Billing/UseCases/SerializedPaymentApplication.cs).
- **E5 — ограничения БД**: [OrdersRepository.cs, L19](https://gitlab-sachkov.ru/miracle-generation/education-platform/-/blob/8ce97fcd1c75bdbbde661ec162b7a9da82930012/backend/AccessService/src/AccessService.Infrastructure.Postgres/OrdersRepository.cs#L19), [OrderConfiguration.cs](https://gitlab-sachkov.ru/miracle-generation/education-platform/-/blob/8ce97fcd1c75bdbbde661ec162b7a9da82930012/backend/AccessService/src/AccessService.Infrastructure.Postgres/Configurations/OrderConfiguration.cs).
- **E6 — recovery**: [PendingOrderReconciliationService.cs, L230](https://gitlab-sachkov.ru/miracle-generation/education-platform/-/blob/8ce97fcd1c75bdbbde661ec162b7a9da82930012/backend/AccessService/src/AccessService.Core/Features/Billing/Reconciliation/PendingOrderReconciliationService.cs#L230): CheckOrder/GetState; L442 восстановление RebillId. [TBankOrderRecovery.cs](https://gitlab-sachkov.ru/miracle-generation/education-platform/-/blob/8ce97fcd1c75bdbbde661ec162b7a9da82930012/backend/AccessService/src/AccessService.Core/Features/Billing/TBank/TBankOrderRecovery.cs), [TBankProviderSnapshotValidator.cs](https://gitlab-sachkov.ru/miracle-generation/education-platform/-/blob/8ce97fcd1c75bdbbde661ec162b7a9da82930012/backend/AccessService/src/AccessService.Core/Features/Billing/TBank/TBankProviderSnapshotValidator.cs).
- **E7 — списания**: [RecurringChargesSweeper.cs, L674](https://gitlab-sachkov.ru/miracle-generation/education-platform/-/blob/8ce97fcd1c75bdbbde661ec162b7a9da82930012/backend/AccessService/src/AccessService.Web/Jobs/RecurringChargesSweeper.cs#L674): durable renewal, recovery и запрет второго Charge. [SubscriptionRenewalPolicy.cs](https://gitlab-sachkov.ru/miracle-generation/education-platform/-/blob/8ce97fcd1c75bdbbde661ec162b7a9da82930012/backend/AccessService/src/AccessService.Domain/SubscriptionRenewalPolicy.cs).
- **E8 — подписка и управление**: [BillingSubscription.cs, L49](https://gitlab-sachkov.ru/miracle-generation/education-platform/-/blob/8ce97fcd1c75bdbbde661ec162b7a9da82930012/backend/AccessService/src/AccessService.Domain/Billing/BillingSubscription.cs#L49), [ManageMySubscription.cs](https://gitlab-sachkov.ru/miracle-generation/education-platform/-/blob/8ce97fcd1c75bdbbde661ec162b7a9da82930012/backend/AccessService/src/AccessService.Core/Features/Billing/Subscriptions/ManageMySubscription.cs).
- **E9 — доступ**: [BillingSubscriptionEntitlementSynchronizer.cs](https://gitlab-sachkov.ru/miracle-generation/education-platform/-/blob/8ce97fcd1c75bdbbde661ec162b7a9da82930012/backend/AccessService/src/AccessService.Core/Features/Billing/Subscriptions/BillingSubscriptionEntitlementSynchronizer.cs), [SyncContentAccessOnBillingSubscriptionChangedHandler.cs](https://gitlab-sachkov.ru/miracle-generation/education-platform/-/blob/8ce97fcd1c75bdbbde661ec162b7a9da82930012/backend/AccessService/src/AccessService.Core/Features/Billing/Subscriptions/SyncContentAccessOnBillingSubscriptionChangedHandler.cs).
- **E10 — операционные ограничения**: [RefundOrder.cs](https://gitlab-sachkov.ru/miracle-generation/education-platform/-/blob/8ce97fcd1c75bdbbde661ec162b7a9da82930012/backend/AccessService/src/AccessService.Core/Features/Billing/UseCases/Admin/RefundOrder.cs), [ResyncOrder.cs](https://gitlab-sachkov.ru/miracle-generation/education-platform/-/blob/8ce97fcd1c75bdbbde661ec162b7a9da82930012/backend/AccessService/src/AccessService.Core/Features/Billing/UseCases/Admin/ResyncOrder.cs), [TBankStatusMapper.cs](https://gitlab-sachkov.ru/miracle-generation/education-platform/-/blob/8ce97fcd1c75bdbbde661ec162b7a9da82930012/backend/AccessService/src/AccessService.Core/Features/Billing/TBank/TBankStatusMapper.cs).
- **E11 — чеки и конфигурация**: [TBankReceiptBuilder.cs](https://gitlab-sachkov.ru/miracle-generation/education-platform/-/blob/8ce97fcd1c75bdbbde661ec162b7a9da82930012/backend/AccessService/src/AccessService.Core/Features/Billing/TBank/TBankReceiptBuilder.cs), [TBankOptions.cs](https://gitlab-sachkov.ru/miracle-generation/education-platform/-/blob/8ce97fcd1c75bdbbde661ec162b7a9da82930012/backend/AccessService/src/AccessService.Core/Features/Billing/Configuration/TBankOptions.cs).
- **E12 — webhook tests**: [TBankWebhookTests.cs, L99](https://gitlab-sachkov.ru/miracle-generation/education-platform/-/blob/8ce97fcd1c75bdbbde661ec162b7a9da82930012/backend/AccessService/tests/AccessService.IntegrationTests/Features/Billing/TBankWebhookTests.cs#L99): перестановка AUTHORIZED/CONFIRMED, concurrent delivery, поздний token после cancel; L244 сумма, L266 duplicate, L292 поздняя оплата, L462 partial refund.
- **E13 — recovery tests**: [PendingOrderReconciliationTests.cs, L308](https://gitlab-sachkov.ru/miracle-generation/education-platform/-/blob/8ce97fcd1c75bdbbde661ec162b7a9da82930012/backend/AccessService/tests/AccessService.IntegrationTests/Features/Billing/PendingOrderReconciliationTests.cs#L308): missing webhook, 0/1/multiple cards и matching CheckOrder.
- **E14 — renewal tests**: [RecurringChargesSweeperTests.cs, L1060](https://gitlab-sachkov.ru/miracle-generation/education-platform/-/blob/8ce97fcd1c75bdbbde661ec162b7a9da82930012/backend/AccessService/tests/AccessService.IntegrationTests/Features/Billing/RecurringChargesSweeperTests.cs#L1060): два worker, crash, late renewal, expiry race, unknown Charge/Init; L558 refund rollback, L968 отмена, L1475 grace.
- **E15 — GetState DTO**: [TBankGetStateResponse.cs](https://gitlab-sachkov.ru/miracle-generation/education-platform/-/blob/8ce97fcd1c75bdbbde661ec162b7a9da82930012/backend/AccessService/src/AccessService.Core/Features/Billing/TBank/Contracts/TBankGetStateResponse.cs): RebillId не моделируется. Перед переносом сверить актуальную банковскую схему; не выбирать карту наугад через GetCardList.

### Сценарии, которые нельзя потерять при переносе

Это выводы из E1–E15 и предлагаемые требования к будущей реализации, не новые принятые правила.

1. **Повторное или конкурентное уведомление.** После блокировки заново читать состояние;
   один PaymentId может пройти PAID→REFUNDED, поэтому dedupe только по PaymentId потеряет возврат.
   Повтор одного состояния не должен второй раз продлевать период или публиковать финансовое событие.
2. **Позднее уведомление.** CONFIRMED после локального истечения ожидания может быть настоящей оплатой.
   AUTHORIZED с RebillId после CONFIRMED может дополнять привязку, но не включать отменённое продление.
   Запоздалый FAILED не должен откатывать подтверждённую оплату; конфликт состояния уходит на сверку.
3. **Чужая сумма, заказ или платёж.** Подписи недостаточно: сопоставлять terminal, order, payment,
   сумму и неизменяемый коммерческий снимок. Education помечает PENDING как FAILED при mismatch суммы
   и отвечает OK после аудита; для Inside предпочтительнее отдельно хранить конфликт проверки и факт банка.
   Amount при возвратах надо трактовать по соответствующему контракту, не общей проверкой первой оплаты.
4. **Потерян ответ Init/Charge.** Durable attempt существует до сети. При отсутствии PaymentId читать
   CheckOrder, при наличии — GetState; пустая/неоднозначная история не разрешает повторное списание.
   После CHARGE_CALLED состояние NEW само по себе тоже не разрешает retry. Падение между записью
   намерения и отправкой запроса может потребовать оператора: сохранность денег важнее автоматической догадки.
5. **Оплата есть, доступ не выдан.** Хранить банковское подтверждение независимо от fulfillment;
   повторять выдачу по тому же order/period, а не ещё раз брать оплату. Legacy GRANT_FAILED в Education
   может сделать Order FAILED при оплаченных деньгах: это ограничение его модели, которое не следует копировать.
6. **Recovery без raw SQL.** Общий обработчик банковского snapshot для webhook, фоновой сверки и
   административного resync, с аудитом инициатора. Текущий Education Resync требует ExternalProviderRef
   и допускает лишь PENDING/reconciliation_expired; не покрывает любой ручной ремонт, смену карты и возврат.
   Новый план должен предусмотреть разбор зависшей попытки и переисполнение fulfillment без подмены paid state.

## Владелец оплаты, доступа и событий

Сегодня [MembershipEvidence](../../CONTEXT.md#access-and-activity) говорит о членстве в Telegram;
валидатор принимает именно chat_member/chat_not_member и ограничивает срок evidence. Это не банковский
чек и не договор подписки. Текущий [ContentAccess contract](../specifications/content-access-authorization-v1.md)
нельзя молча заменить платёжным webhook.

| Вариант для #128 | Кто владеет фактами | Последствие |
|---|---|---|
| Platform владеет оплатой и оплаченной подпиской — рекомендация | Банк — результат операции; Platform billing — заказы, согласия и paid period; Platform entitlement — доступ; Telegram — применение доступа к чату | После оплаты Platform может выдать доступ независимо от задержки Telegram. Нужен новый cross-repo контракт и переход старых участников |
| Platform ведёт billing, Telegram временно остаётся источником Membership | Platform хранит финансы, Telegram подтверждает членство, Platform применяет текущий evidence | Возможен промежуток «оплатил, но ещё нет доступа». Нужны repair и предел ожидания; Telegram join по-прежнему не доказывает покупку |
| Ручное продление вместо автосписания | Platform хранит отдельные подтверждённые заказы и оплаченный период; способ доступа выбирается отдельно | Не нужен scheduler Charge, но нужны confirmation/reconciliation, отмена неопределённого checkout, чеки и правила прибавления периода |

Education остаётся reference для механики. Его API, база, credentials и Program/Plan/Grant не становятся
зависимостями Inside. Отмена в Telegram или выход из чата не должны автоматически означать возврат
или отмену банковского согласия без отдельного выбранного правила.

### Вход для #337

Предлагаемый источник — сохранённые переходы будущего billing, прошедшие проверку банковского
результата, и собственные переходы подписки. Это вход для проектирования #337, не реализованный API.

| Аналитический факт | Откуда брать | Чего недостаточно |
|---|---|---|
| purchase / renewal | Подтверждённая операция + order kind + применённый paid period, одно событие на переход | Init, PaymentURL, success redirect, AUTHORIZED, выдача бесплатного доступа |
| cancellation | Команда владельца и сохранённый переход подписки; отдельно effective end | Отказ карты или закрытие формы |
| expiration | Переход оплаченного периода/выбранного grace по часам владельца подписки | Выход из Telegram, истёкший cache evidence |
| refund | Подтверждённый возврат с суммой, reference исходного платежа и отдельным refund identity | Локальная кнопка возврата, отзыв grant |

Минимальные данные для обсуждения: стабильные AccountId, subscriptionId, orderId, provider,
terminal scope, PaymentId, тип/ID события, версия агрегата, amountMinor/currency, paid period,
occurredAt и recordedAt в UTC, причина/источник перехода. Часовой пояс отображения и границы месяца
для отчётов выбираются отдельно; late arrival не должен менять время самой операции.
Webhook не обязательно содержит отдельный event ID: dedupe нужно определить по операции и переходу,
а возвраты учитывать отдельно. Публикация через outbox повторяемая; потребитель также удаляет дубли.
При reconciliation помечать, какие даты подтвердил банк, а какие известны только локально.
Backfill из Telegram evidence не восстановит выручку, даты подписок или MRR; нужны платёжные записи
с доказуемой связью с Account. #337 не следует объявлять разблокированным до решения #128.

## Следующая проверка: последовательность и критерии

План ниже предложен для будущей implementation specification. Ничего из платёжных испытаний здесь
не выполнялось. Сначала завершить #128, затем утвердить shared ownership в #127 и оформить задачи
в owning repositories. Внутри Inside использовать местный стек и его тестовые правила.

1. **Изолированный стенд без банка.** Adapter с записанными контрактными fixtures, отдельный PostgreSQL,
   управляемые часы и остановка процесса на границах записи/сети. Тесты должны наблюдать число попыток,
   изменения денег/периода/доступа и события, а не повторять функции реализации.
2. **DEMO proof после разрешённой настройки.** Подтвердить capabilities и кассу, выделить стабильный HTTPS
   callback с прямым ответом без 301/302, использовать только test credentials через секретное хранилище.
   Проверить выбранные способы оплаты и ошибки. Зафиксировать результаты без PAN, токенов и PaymentURL.
3. **Проверка полного пути.** Оплата → серверный результат → оплаченный период → доступ → Telegram/аналитика,
   включая восстановление после остановки каждого потребителя. Для Telegram любые реальные изменения
   доступа вынести из mock proof в отдельно разрешённый тестовый контур.
4. **Отдельный production GO.** Проверить рабочую конфигурацию, fiscal mapping, согласия, мониторинг,
   ручной recovery, план остановки новых списаний и миграцию старой аудитории. DEMO не подтверждает
   готовность рабочего терминала; существующее согласие Education/Tribute нельзя переносить автоматически.

| Испытание | Где | Проверяемый результат |
|---|---|---|
| Повторный клик и два параллельных checkout | Fake + PostgreSQL, затем DEMO | Один durable order/attempt на idempotency scope; цена берётся с сервера |
| Успех/отказ/закрытие формы, возврат раньше webhook | DEMO + browser | Redirect не выдаёт доступ; экран получает серверный статус, закрытая вкладка не теряет покупку |
| AUTHORIZED→CONFIRMED и обратный порядок | Fake, затем DEMO где воспроизводимо | До CONFIRMED нет paid grant; один период, привязка сохранена |
| Duplicate/concurrent/late callbacks и webhook одновременно с reconciliation | Fake + реальная БД | Один финансовый переход, одно продление; повторы outbox не дублируют эффект |
| Неверная подпись/terminal/order/payment/amount; чужой Account | Fake | Ни списание, ни доступ не приписаны другому заказу; безопасный аудит; нет утечки наличия чужой покупки |
| Потеря ответа Init и crash до сохранения PaymentId | Failure injection + DEMO recovery | CheckOrder восстанавливает совпадение; 0/multiple candidates сохраняют неопределённость; второго Init нет |
| Потеря ответа Charge, NEW после CHARGE_CALLED, два worker | Failure injection | Нет второго Charge; GetState/webhook восстанавливает результат; неопределённая попытка видна оператору |
| Commit failure при webhook; crash после commit до OK | Fake + БД | При неуспешном commit нет OK; повтор после успешного commit не удваивает период/событие |
| Банк подтвердил, fulfillment или Telegram недоступен | Fake + интеграционный стенд | Paid fact сохранён; восстановление выдаёт доступ без повторной оплаты; лаг виден отдельно |
| Отмена во время renewal, поздний token/отказ/успех | Fake + управляемые часы | Отмена не возобновляется поздним событием; уже начатая операция доводится по выбранным правилам |
| Retry/grace/expiry, пропущенный worker, смена цены | Fake + часы | Соблюдён выбранный paid period и price snapshot; границы времени и поздняя оплата определены |
| Смена карты, 0/1/несколько привязок, невалидный token | DEMO + Fake | Нет угадывания карты; новая привязка имеет подтверждение; старый scheduler не списывает параллельно |
| Full/partial refund, потеря ответа Cancel, повтор ExternalRequestId | DEMO + Fake | Один возврат; корректные сумма, остаток, чек и отдельное решение о доступе; повтор не возвращает деньги второй раз |
| Receipt rejected/delayed, renewal receipt, refund receipt | DEMO + выбранная касса | Оплата и фискализация различимы; ошибка видна оператору, не запускает второе списание |
| iOS Safari / Android Chrome / Telegram browser; 3DS/deep links/back | Реальные устройства или контролируемый browser proof | Карта и выбранные pay methods завершаются; возврат сохраняет заказ/Account; iframe дополнительно проходит CSP/COOP proof |
| Restart/replay/backfill analytics | Fake + outbox consumer | Один purchase/renewal/refund; отмена и expiry не подменены Telegram; UTC и позднее поступление проверены |

## Что осталось неизвестным и кто снимает вопрос

| Факт / решение | Как снять |
|---|---|
| COF и способы на конкретных DEMO/рабочем терминалах | Владелец банковского кабинета: read-only настройки/подтверждение поддержки, затем отдельный DEMO proof |
| Отдельный магазин Inside или существующий SachkovLearn | Владелец + условия банка; до решения не переносить CustomerKey и платёжные привязки |
| Касса, ФФД, налоговые поля, чеки и контакт покупателя | Владелец расчётов/кассы подтверждает фактическую конфигурацию; implementation проверяет payload/result |
| Доступность callback и mobile/3DS поведения | Исполнитель тестового стенда; скриншот старого туннеля не является проверкой |
| Automatic/manual, периоды, consent, cancel, retries/grace, refund/access, миграция | #128; затем shared contract #127 и отдельные repo-owned specifications |
| Финальный analytics source/schema и backfill | #337 после lifecycle decision; этот отчёт предоставляет факты и ограничения |

## Проверка самого исследования

Сверены точные revisions, перечисленные файлы и соответствующие тестовые сценарии Education;
прочитаны первичные банковские источники. Проверки артефакта: `pnpm docs:check`, локальные Markdown
ссылки, наличие Education pointers в зафиксированном commit, `git diff --check` и ограниченное
ревью diff против acceptance #341. Итоги выполнения проверок записаны в PR.

Не проверено: live payment/test-terminal/production API, работоспособность credentials и туннеля,
банковский кабинет за пределами изображений, actual recurring enablement, касса, устройства,
тесты Education и runtime Inside billing. Application code и исполняемые контракты этим исследованием
не меняются; root `pnpm check` для них не запускался.
