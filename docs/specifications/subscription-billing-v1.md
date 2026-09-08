# Platform billing v1: локальный контракт реализации

Статус: **принятая спецификация #403** ([PR #417](https://github.com/sachkov-inside/platform/pull/417)).
Access foundation реализуется #404; остальные billing slices остаются отдельными поставками. Основание — одобренный
[Workspace PR #151](https://github.com/sachkov-inside/workspace/pull/151), merged commit
`e161320d74176f8154b20f5c469846fbdc1773e6`. Дословные источники сохранены в
[локальном snapshot](../contracts/billing-v1/README.md). Они содержат прежнюю надпись «предложение»;
manifest фиксирует последующее одобрение владельцем. Коммерческие правила не выбираются заново.

Принятие #403 открывает реализацию Platform и подготовку Telegram #54. Последняя vendor-ит тот же
bundle и проверяет provider assumptions; до неё новые интеграционные consumers не Ready. Наличие
этого документа не меняет действующий Telegram evidence v1 и Tribute checkout текущего приложения.

## Возможности и модули

Сохраняются Nest modular monolith, capability interfaces и PostgreSQL/Prisma из действующих
[backend standards](../../apps/backend/CODING_STANDARDS.md). Не добавляем микросервисы или общий
абстрактный payment-provider framework. В первой версии — только конкретный TBank adapter.

| Capability | Собственные факты / публичные операции | Delivery |
|---|---|---|
| `accounts` | Account, подтверждённый billing contact и его revision; start/confirm contact change | #406 |
| `telegram-membership` | Verified Account ↔ Telegram link; stable linkRef и монотонная linkRevision, tombstone после unlink; read current/historical binding | #404, #415 |
| `billing` (новый модуль) | Offers, price/consent snapshots, subscription, attempts, bank/fiscal results, lifecycle events и outbox; purchase/change/renew/cancel/reconcile/refund | #405, #407–#409 |
| `membership-entitlements` | Независимые paid/manual/legacy grants; applyPaidPeriod, grant/revoke/preview/batch, resolveForAccess; legacy classification | #404 |
| `content-access` | Финальный доступ к материалам/файлам/video token из публичного entitlement facet, без provider I/O | #404 |
| `telegram-membership` | Community desired state, entitlement revision, outbox и delivery observation; project/dispatch/reconcile/authorizeDispatch | #415 |
| `billing` | Transactional notice intent, verified recipient snapshot, email sender и Telegram adapter, authorizeNoticeDispatch | #410 |

Каждая строка описывает реальный потребительский seam; это не требование создать отдельный класс
или DI token для каждой операции. State-owning Prisma delegates остаются внутри capability.
Общий `communications` API сохраняет маркетинговую семантику; billing не запускает campaign для
служебного сообщения. Новые worker entrypoints вводятся с первым durable job, используя принятую
инфраструктуру pg-boss; бизнес-idempotency сохраняется в собственных таблицах независимо от queue.

### Доступ и согласованность без общей транзакции модулей

Billing transaction атомарно фиксирует подтверждённый платёж, период, lifecycle event и outbox.
Она не пишет в schema `membership_entitlements`. Отдельный projector вызывает `applyPaidPeriod`
через публичный facet с immutable eventRef, periodRef, Account и revision. Entitlement transaction
сохраняет receipt и grant вместе; повтор eventRef даёт исходный результат, другая нагрузка — конфликт.
Падение между транзакциями восстанавливается outbox replay, не новой оплатой. Пока выдача не
завершена, кабинет различает «оплата получена, готовим доступ» и «результат оплаты уточняется».

Community projector также читает только публичные facets. Изменение grants/link и наступление
expiry инвалидируют его desired snapshot; durable event plus фоновый sweep восстанавливают пропуск.
Expiry обрабатывается без пользовательского запроса. Перед отправкой заново проверяется актуальное
право. Материалы не ждут успеха внешнего community действия.

Paid grant отражает один periodRef. Manual grant и legacy grant имеют свои независимые sourceRef.
Объединяются возможности всех действующих оснований; revoke/expired paid/negative legacy evidence
не перекрывает manual lifetime. У результата разрешения `validUntil: string | null`, где null —
доказанное бессрочное основание; отсутствие/ошибка — отдельный deny/unavailable, не null.
Обновить всех текущих consumers этого facet и их cache bounds в #404, включая Member Profile;
Workshop остаётся отложенным и не получает новый продуктовый scope.

## Хранилище, денежные значения и календарь

Это обязательные constraints будущих migrations, не созданные этим PR таблицы.

| Данные | Уникальность / граница |
|---|---|
| Offer/вариант | Стабильный ID и revision; архивирование сохраняет старые snapshots |
| Subscription | Не более одного незавершённого/действующего subscription lifecycle на Account для текущего предложения Inside; lifetime — независимый grant |
| Purchase command | Account + operationId; та же нагрузка повторяется, другая конфликтует; одна открытая попытка покупки даже при другом ID из второй вкладки |
| Period/attempt | Subscription + logical period; только одна potentially sent attempt на период; новая попытка после unknown не создаётся |
| Provider reference | Environment + provider + terminalRef + PaymentId; чужой terminal/Account/order не сопоставляется |
| Webhook/event receipt | Stable event/application key и fingerprint; подпись проверяется до dedupe acceptance |
| Promo reservation | Цена и лимит резервируются до отправки; confirmed расходует один раз; unknown удерживает резерв до сверки |
| Paid grant receipt | EventRef + periodRef + Account + revision; повтор не добавляет длительность |
| Manual/batch operation | Actor + operationId + rowKey, targetAccount и immutable payload; preview не выдаёт права |
| Refund attempt | Payment + operationId; лимит оставшейся суммы сериализуется вместе с reservation |
| Notice/dispatch | NoticeRef + revision + channel + verified recipient version; external-send-started сохраняется до I/O |

Integer kopecks, RUB, без float. Время сохраняется как instant; расчёт календарных месяцев —
`Europe/Moscow`, локальное исходное число и время сохраняются как anchor. Jan 31 → Feb last day →
Mar 31. UTC используется для сохранения/обмена, wire date-time может иметь offset и нормализуется
на границе. Интервалы `[start,end)`; сравнение с now использует переданные часы, не системное время
в domain logic. Первая покупка/после перерыва — от подтверждённого банком payment instant;
своевременное продление — от прежнего конца. Late подтверждение сохраняет исходный факт оплаты.

Upgrade: рациональный расчёт стоимости старшего варианта на оставшиеся миллисекунды периода
минус остаток фактически оплаченной младшей суммы, округление половины копейки вверх только
один раз на конечной доплате. Пример 1000 ₽ со скидкой → 3500 ₽ на середине даёт 1250 ₽.
Повышение сохраняет срок/длительность; понижение и другая длительность — следующий период.
Нулевая/отрицательная доплата не отправляется в банк: операция возвращает `unsupported_amount`
и предлагает операторский разбор без автоматической бесплатной смены. Минимум/максимум банка
проверяются по подтверждённой terminal capability #402, не выдумываются в коде.

Принятые условия неизменяемы: offer/payment option revision, duration, timezone/anchor, первая
сумма и скидка, regular renewal price, состав доступа, версии оферты и явного recurring consent,
момент и Account. Изменение публичной цены не меняет старую subscription; после смены варианта
принимаются его новые условия. Бесплатные права выдаются вручную.

## State transitions и банковский boundary

Order не равен попытке списания, Payment не равен paid grant, отмена recurring не равна refund.

| Вход | Переход / результат |
|---|---|
| Checkout after verified contact/consent/classification | Persist order/attempt/snapshot/reservations → Init; browser не передаёт сумму, terminal или получателя |
| Init result received | Проверенные bank host/HTTPS PaymentURL и PaymentId сохранены; выдаётся redirect |
| Init timeout/crash | `unknown`; CheckOrder ищет точное совпадение; 0/multiple остаются unknown, без второго Init |
| AUTHORIZED | Привязка сохраняется после проверки; paid period ещё не создан |
| CONFIRMED | Единственный paid transition + period/event/outbox; webhook и reconciliation вызывают один use case |
| Однозначный decline | Definitive failure, без automatic retry/grace; уже оплаченный срок не сокращается |
| Renewal due | Сериализованный gate: active consent + valid binding + uncancelled schedule + нет in-flight; persist attempt до Init/Charge |
| Charge timeout | Сохраняется sent/unknown; GetState до любой новой mutation, даже NEW не разрешает слепой повтор Charge |
| Cancel before send | Cancel revision блокирует отправку worker; оплаченный остаток сохраняется |
| Cancel after send | Сверка прежней попытки; late success даёт период, новые списания запрещены |
| Refund approved | Снимок решения amount/access/recurring; independent refund attempt, Cancel/result/reconciliation; unknown не считается исполнением |
| Receipt rejected/delayed | Отдельное fiscal state с alert/recovery; не повторная оплата и не скрытый success чека |

Проверяются token/signature по actual payload и соответствие terminal/payment/order/amount,
валюта — по валюте заказа и подтверждённому terminal contract, не по выдуманному webhook полю.
Дубликат позднего success не переигрывает более новое cancel/refund; внешние raw payload и
RebillId не попадают в публичные API, логи, fixtures или Telegram. RebillId/AccountToken хранится
защищённо только в billing; существующие привязки Education/Tribute не переносятся.

Смена карты — отдельный подтверждённый provider workflow, старый способ не удаляется по одному
redirect. Уже отправленная attempt сохраняет выбранный способ; новая binding применяется только
к следующим разрешённым attempts. Отзыв её использования закрывает новые отправки и проверяется
под той же блокировкой, что worker dispatch. Конкретные способы/касса закрываются #402/#413.

## Account, API и агентские операции

Пути ниже — target contract задач, а не endpoints, уже присутствующие в OpenAPI. Реализация
каждого controller владеет Zod schemas, stable operationId и generated OpenAPI; Web types
генерируются от них, а не из этой таблицы. Префикс reverse proxy не входит в controller path.

Все команды принимают `operationId` UUID; команды изменения существующего объекта дополнительно
`expectedRevision` positive safe integer. Trusted actor приходит из Logto/Nest adapter, а не body.
Target Account в owner batch — цель разрешённой операции, не способ передать actor.

| HTTP / operationId | Request сверх общего envelope | Result |
|---|---|---|
| GET `billing/offers` / `billingOffers` | — | Активные варианты, обычная/применимая первая цена и revision; без закрытых данных |
| GET `accounts/current/billing` / `currentBilling` | — | Own subscription, grants summary, next charge, pending change, notices/delivery и operation status |
| POST `accounts/current/billing/contact/start` / `startBillingContact` | email | challengeRef, expiry; старый адрес продолжает действовать до подтверждения |
| POST `accounts/current/billing/contact/confirm` / `confirmBillingContact` | challengeRef, code | verified contact revision; не merge другого Account |
| POST `accounts/current/billing/quote` / `quoteBillingPurchase` | paymentOptionId, optionRevision, optional promoCode | immutable quoteRef, exact first/renewal sums, validity, legal versions, next date, existing-right warning |
| POST `accounts/current/billing/purchase` / `purchaseBillingSubscription` | quoteRef, explicit recurring consent + presented legal versions | durable orderRef и status; redirect только при verified PaymentURL |
| GET `accounts/current/billing/orders/:orderRef` / `billingOrderStatus` | own orderRef | bank state отдельно от access fulfillment/fiscal state |
| POST `accounts/current/billing/subscription/cancel` / `cancelBillingRenewal` | expectedRevision | новая subscription revision, paidUntil, in-flight flag |
| POST `accounts/current/billing/subscription/resume` / `resumeBillingRenewal` | expectedRevision, explicit consent | только активный оплаченный срок и исходные условия; завершённая — новая покупка |
| POST `accounts/current/billing/subscription/change` / `changeBillingOption` | expectedRevision, accepted changeQuoteRef | upgrade payment либо scheduled next option; не одновременно новая формула периода |
| POST `accounts/current/billing/subscription/change/quote` / `quoteBillingChange` | expectedRevision, paymentOptionId | расчёт/следующие условия до согласия |
| POST `accounts/current/billing/subscription/change/cancel` / `cancelBillingChange` | expectedRevision | pending change снят до соответствующей отправленной attempt |
| POST `accounts/current/billing/payment-method/change` / `changeBillingMethod` | expectedRevision | provider flowRef/status; redirect не заменяет binding |
| POST `accounts/current/billing/payment-method/revoke` / `revokeBillingMethod` | expectedRevision, paymentMethodRef | запрет будущего использования; in-flight отдельно виден |
| GET `accounts/current/billing/operations` / `ownBillingOperations` | opaque cursor, bounded limit | Только собственная история и support reference |
| POST `billing/admin` / `manageBilling` | discriminated operation + payload ниже | bounded owner results, audit, без raw provider token |
| POST `billing/tbank/notification` / `acceptTbankNotification` | raw provider payload, отдельная bank signature boundary | Bank protocol acknowledgement после durable acceptance, не generic service auth |

Owner API и MCP используют один facet. Все изменяющие команды проверяют действующего владельца
через Accounts; существующий owner определяется полномочиями, а не email/username. В #409
вводится scoped `billing:manage` только текущему bootstrap owner, без назначения новых людей/ролей.
MCP не имеет большей власти, чем admin endpoint.

`billing/admin` операции: `offers.save|archive`, `paymentOptions.save|archive`, `promotions.save|archive`,
`payments.list|read|reconcile`, `subscriptions.cancel`, `refunds.decide|execute|read`,
`grants.previewBatch|applyBatch|extend|revoke`, `deliveries.read|resolve`.
Для каждой — конкретная closed schema. Lists используют limit 1..100 и opaque cursor; неизвестные
поля/operations отвергаются. `refunds.decide` содержит отдельные решения о сумме, доступе и
recurring с причиной; `execute` принимает decisionRef/revision, не новую сумму. `applyBatch` —
previewRef/revision и подтверждённые строки; при изменении сопоставления preview устаревает.
`deliveries.resolve` требует явного выбора skip либо разрешённой повторной отправки с audit;
неизвестный внешний эффект сам не становится retryable.

Общий command result: success с operationRef/outcome/revision или error из фактического use case.
Ожидаемые ошибки: `forbidden`, `invalid_input`, `not_found`, `revision_conflict`, `operation_conflict`,
`contact_required`, `consent_required`, `quote_expired`, `price_changed`, `legacy_review_required`,
`payment_in_progress`, `unsupported_amount`, `method_unavailable`, `provider_unavailable`.
404 скрывает чужой resource; HTTP 409 — revision/operation/state conflict; provider timeout после
отправки возвращает сохранённый pending/unknown operation, а не совет начать новую покупку.
HTTP схемы и исчерпывающий mapping реализуются вместе с endpoints, без fake OpenAPI в #403.

## Переход и юридические страницы

Legacy classification: `confirmed_legacy`, `confirmed_new`, `unknown`, с sourceRef/verifiedAt и
операторским основанием. До первой new recurring покупки unknown возвращает
`legacy_review_required`. Временный доступ старой группы ограничен заранее установленным cohort;
новые join от Inside не добавляют туда Account. Частичная выгрузка не доказывает полноту; старые
подтверждённые сроки импортируются отдельно от текущего chat evidence. Без подтверждённой остановки
Tribute recurring/in-flight/retry новая подписка старого участника не активируется.

Платформенный readonly path сначала проверяет paid/manual/imported legacy grants, затем для
cohort-участника действующий bounded evidence v1. Отрицательное/expired evidence относится только
к последнему основанию. Bootstrap cohort, реальный import и взаимодействие двух ботов имеют
runbook/preview/owner gate Workspace #150. Отключение bridge — отдельная задача после отсутствия
зависящих от него действующих прав, не по календарной дате.

Workspace #149 поставляет тексты для фактического продавца и действующего/будущего этапа.
Platform #412 публикует страницы и футер без ожидания billing. #406/#411 сохраняют версии принятых
условий, отдельно recurring consent и иные применимые согласия. Публикация новой редакции не
меняет прошлое согласие. Документы не обещают неподключённую кассу или ещё неработающий billing.

## Verification и readiness

[Wire bundle](../contracts/billing-v1/README.md) содержит schema, valid/invalid examples и
normative sequences. #403 проверяет shape и integrity, но не исполняет lifecycle, PostgreSQL,
Telegram или банк. Consumer/provider реализации запускают corpus через свои настоящие facets.
State transitions требуют real PostgreSQL concurrency/rollback/crash tests, не fake repositories.
Новые imports/seams получают positive/negative guardrails вместе с реализацией; code/schema не
создаёт в #403 пустые runtime модули. Standard repo checks обязательны для executable artifacts.

| После принятия | Готовность |
|---|---|
| #403 | #404 access, #405 offers и #406 contact могут реализовываться независимо; Telegram #54 может принять bundle |
| #54 | Telegram #55/#56 и Platform #415 используют один проверенный provider contract |
| #404/#405/#406 | Checkout #407; далее renewal #408, operations #409 и UI #411 |
| #408/#406/#54 | Notices #410, Telegram runtime сойдётся на DEMO |
| #149 | Legal UI #412 может поставляться независимо от нового billing |
| #402 + все локальные slices | #413 DEMO с разрешёнными bank/test-channel операциями |
| #413 | #414 отдельная production приёмка и owner GO; полного переноса Tribute не подменяет |

Обновление текстов downstream issues после #403 не закрывает их dependencies. #337 получает
immutable paid/renewal/cancel/expiry/refund eventRef, source revision, occurredAt/recordedAt и
Account reference через локальную спецификацию аналитики; manual grant не считается выручкой.
Точный публичный analytics schema остаётся за #337 и не блокирует оплату.

## Реализованный access foundation #404

`assembleAccessGrants` — публичный внутренний facet модуля `membership-entitlements`:
`applyPaidPeriod`, `previewBatch`, `applyBatch`, `changeGrant`, `classifyLegacy`,
`readLegacyClassification`, `resolveCapabilities`. HTTP/MCP owner adapters остаются в #409,
paid outbox projector — в #407, community worker — в #415. Facet не принимает платёжное
доказательство из браузера и не обращается к банку или Telegram. Mutable Prisma delegates
остаются внутри владельца; negative TypeScript fixtures проверяют этот seam.

Paid command принимает eventRef UUID, periodRef, Account, revision, revoked и абсолютный
полуоткрытый период. Receipt с неизменяемой командой, grant и audit фиксируются в одной entitlement-транзакции; повтор eventRef
возвращает сохранённый результат, другая нагрузка конфликтует. Более старая revision не
перезаписывает новый период/отзыв. Billing использует тот же seam для подтверждённого решения
о доступе после refund, не общую Prisma transaction с модулем прав.

Ручная выдача/legacy import используют `previewBatch` с operationId и 1..100 строками:
rowKey, точный target Account, source/sourceRef, capabilities, startsAt, validUntil и reason.
Preview фиксирует fingerprint подтверждённой identity из Accounts, результат сопоставления и
действует 30 минут. Применение требует его revision и явных confirmedRows. Оно повторно
проверяет Accounts, сохраняет результат каждой выбранной строки и атомарно потребляет preview.
Одинаковый actor/operationId возвращает прежний результат; изменённая команда конфликтует.
Один source/sourceRef не создаёт два права даже при конкуренции разных previews. Extend и revoke
требуют revision конкретного manual/legacy grant; paid revisions принадлежат billing.

До scoped `billing:manage` в #409 owner-команды проверяют текущий `platform:admin` через Accounts.
Facet не выдаёт это полномочие. Actor передаёт доверенный вызывающий adapter отдельно от payload;
в тестах используется отдельный synthetic owner. Реальный bootstrap cohort/import не запускается
миграцией, startup или join. До owner-approved preview/apply из Workspace #150 bridge не имеет
участников, поэтому деплой #404 требует согласованного перехода старой аудитории.

Classification хранит sourceRef, reason, verifiedAt и revision. Только явный `confirmed_legacy`
может включить bridge; `unknown` и `confirmed_new` его не получают. `recurringAllowed` — только
legacy gate, не согласие на покупку: unknown запрещён, confirmed_legacy требует отдельного
подтверждения `tributeStopped`. Billing дополнительно проверяет остальные purchase gates.

`resolveCapabilities` объединяет materials/community/reviews отдельно и возвращает границу
каждой возможности, последнюю audit revision и ближайшее начало/окончание периода для sweep.
Изменения grants, classification и cohort evidence сериализуются на уровне Account;
capabilities и revision читаются из одного RepeatableRead snapshot. `resolveForAccess` выбирает materials; отрицательное старое evidence не перекрывает независимое
право. ContentAccess, file delivery, video playback, ReadingActivity и Member Profile учитывают
nullable validUntil. Даже бессрочное право оставляет конечный срок signed URL/token.

`TelegramAccountLinks.readBinding` возвращает stable linkRef и linkRevision, текущий либо
исторический binding. Миграция Telegram владеет trigger над собственными link transactions:
изменение подтверждённой пары пишет snapshot атомарно с исходной связью, потеря/неоднозначность —
tombstone с null identity, повтор той же пары revision не увеличивает. Это покрывает оба
существующих пути подтверждения связи без пропуска одного writer. Runtime unlink/relink UI и
проверка dispatch по revision остаются #415; история уже сохраняется при изменении состояния.

Проверка: `account-access.test.ts` исполняет публичные facets на real PostgreSQL; старый
normalised evidence corpus использует явно заданный synthetic legacy cohort. Реальные права,
платежи, Telegram sends, массовый импорт и деплой этим доказательством не объявляются выполненными.
