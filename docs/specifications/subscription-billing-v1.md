# Platform billing v1: локальный контракт реализации

Статус: **принятая спецификация #403** ([PR #417](https://github.com/sachkov-inside/platform/pull/417)).
Access foundation поставлен в #404, pricing — в #405; остальные billing slices остаются
отдельными поставками. Основание — одобренный
[Workspace PR #151](https://github.com/sachkov-inside/workspace/pull/151), merged commit
`e161320d74176f8154b20f5c469846fbdc1773e6`. Дословные источники сохранены в
[локальном snapshot](../contracts/billing-v1/README.md). Они содержат прежнюю надпись «предложение»;
manifest фиксирует последующее одобрение владельцем. Коммерческие правила не выбираются заново.

Принятие #403 открывает реализацию Platform и подготовку Telegram #54. Последняя vendor-ит тот же
bundle и проверяет provider assumptions; до неё новые интеграционные consumers не Ready. Наличие
этого документа не меняет действующий Telegram evidence v1 и Tribute checkout текущего приложения.

## Обновление уведомлений 2026-09-08

[Notifications v1](notifications-v1.md) заменяет billing-only notification transport и sender ownership
из #403. Immutable billing-v1 bundle сохранён как история и действующий target community; его
notification.send/status и notice.send заменены новыми notification versions. Новая модель
обслуживает также материалы; коммерческие правила и community право не меняются.

## Текущая поставка #407

Уточнение владельца [Workspace #156](https://github.com/sachkov-inside/workspace/issues/156)
и [редакция продуктовых документов](https://github.com/sachkov-inside/workspace/pull/162)
заменяют прежние требования разовой продажи в текущем этапе. Два тарифа — «Материалы» и
«Материалы + сопровождение» — открывают опубликованный каталог; старший явно включает
сопровождение и один общий чат. Публичный one-off checkout и новые цены не утверждены.
Независимое право на руководство проверяется через контролируемую ручную/API-выдачу.

#407 расширяет закрытые #404/#405: предложение и его версия, вариант оплаты, Order/Payment и
AccessGrant остаются разными фактами. Состав допускает библиотеку, выбранное руководство по
stable ID, сопровождение и общий чат; сроки прав могут отличаться от периода списания.
Название, цена, номер тарифа, любой платёж и Telegram membership не являются правилом доступа.
Старые snapshots, paid/manual/lifetime/legacy права и согласия сохраняются. Изменение и архивирование
предложения не переписывают историю и действующие подписки.

ContentAccess применяет допустимое основание к body, файлам, video tokens и ресурсам руководства.
Общий Material разрешён через руководство A без открытия других закрытых материалов B.
Решение опирается на серверный состав опубликованного руководства, а не переданный браузером
контекст; прямой URL и публичные metadata не обходят draft/editor ограничения.

Подтверждение фиксирует оплату, период, immutable event и outbox в billing одной транзакцией.
Отдельная выдача прав повторяется идемпотентно и не вызывает банк заново. Unknown остаётся
неопределённым до сверки, AUTHORIZED не открывает оплаченный срок. Реальная конфигурация терминала,
legal, DEMO и продажи принимаются отдельно в #402/#412/#413/#414; #407 сначала использует
адаптерные fixtures и реальные PostgreSQL-транзакции без credentials.

### Контракты реализации #407

`Offer.benefits` содержит независимые capabilities: `materials`, `guide:<stable UUID>`, `support`,
`community` и прежний `reviews`. Неуказанный срок в `benefitPeriods` наследует число календарных
месяцев варианта оплаты; явный `months: null` означает бессрочное право. Для новой продажи сейчас
допустим только `mode: subscription`. Старые snapshots без новых полей продолжают читаться.

`POST accounts/current/billing/purchase` принимает quote, revision подтверждённого контакта,
ссылки на согласия с актуальными terms/recurring и acknowledgement пересекающихся прав.
`GET accounts/current/billing/purchases/:purchaseRef` показывает собственную покупку Account:
банковское состояние, сохранённый snapshot, готовность доступа и отдельный результат чека.
Повтор operationId возвращает ту же покупку; другая вкладка присоединяется к уже начатой попытке.
Присоединившийся вызов в банк не ходит: запрос уходит один. Он дожидается ответа банка и возвращает
то же итоговое состояние, а не промежуточную строку без ссылки на оплату. Ожидание ограничено чуть
большим, чем таймаут банка. Если отправитель пропал и бюджет исчерпан, присоединившийся вызов всё же
получает промежуточное состояние без ссылки на оплату — это честный предел, а не обещание; строку
затем добирает восстановление.
`billing-worker` восстанавливает банковское состояние и entitlement outbox; подробности запуска
собраны в [local development](../runbooks/local-development.md#subscription-payment-recovery).

**Решение владельца 09.09.2026:** начало первого периода и покупки после перерыва — время,
когда Inside впервые проверил и сохранил CONFIRMED через подписанный webhook либо серверную
сверку. При задержке подтверждения покупатель получает полный срок от этой проверки.
Повторное подтверждение, сверка и outbox replay не меняют сохранённые начало и конец.
Это серверное время проверки Inside; точный банковский payment instant не заявляется известным.

## Текущая поставка #408

#408 добавляет к оплаченной покупке #407 собственную жизнь подписки: расписание списаний, отмену
и возобновление, смену варианта и способа оплаты. Уведомления (#410), операторские возвраты и
admin/MCP (#409), кабинет (#411), реальный терминал и DEMO (#402/#413) остаются отдельными
поставками. Проверка идёт на реальном PostgreSQL и синтетическом банковском адаптере.

Подписка становится отдельным фактом: состояние `active | canceled | ended`, календарный anchor,
накопленные месяцы от anchor, действующий оплаченный срок, принятые условия, снимок обычной цены,
сохранённый способ оплаты, запланированное изменение и монотонная revision. Попытка списания —
строка того же журнала попыток, что и первая покупка, поэтому банковский исход проходит один общий
путь подтверждения. На подписку допускается одна незавершённая попытка и одно продление на
логический период; оба ограничения выражены частичными unique index.

Продление считается от исходного anchor и накопленных месяцев, а не от прежней даты конца:
31 января даёт 28 февраля и снова 31 марта. Своевременное продление начинается от прежнего конца,
поэтому позднее подтверждение не теряет оплаченный факт. Покупка после перерыва — это новая
подписка с новым anchor от подтверждённого платежа.

### Контракты реализации #408

`GET accounts/current/billing` возвращает конверт `{ subscription }` собственной подписки:
состояние, revision, оплаченный срок, сумму текущего периода, способ оплаты, запланированное
изменение и незавершённую попытку. Сводку прав, уведомления и историю операций добавляют к тому же
конверту #409/#410/#411, не меняя путь. Команды `subscription/cancel`, `subscription/resume`,
`subscription/change/quote`, `subscription/change`, `subscription/change/cancel`,
`payment-method/change` и `payment-method/revoke` принимают `operationId` и `expectedRevision`;
повтор operationId с прежней нагрузкой возвращает исходный результат, изменённая конфликтует.

Gate продления сериализуется на подписке: действующее recurring consent тех же редакций,
пригодная непросроченная привязка, неотменённое расписание и отсутствие незавершённой попытки.
Durable attempt сохраняется до Init; `CHARGE_CALLED` сохраняется до сети, и даже NEW после него не
разрешает повторный Charge — потерянный ответ сверяется той же попыткой через GetState. Отзыв
привязки и отмена проверяются под тем же замком, что и отправка worker.

Однозначный отказ завершает расписание без automatic retry и без неоплаченного grace; оплаченный
срок при этом не сокращается. Отмена сохраняет оплаченный срок и запрещает новую отправку; уже
отправленная попытка сверяется, а её поздний успех даёт период без дальнейших списаний.
Возобновление возможно только внутри действующего оплаченного срока, на прежних условиях и с новым
явным recurring consent; оно снова включает списания, поэтому проходит ту же проверку legacy, что и
покупка. Завершённая подписка требует новой покупки. Расписание без пригодной
привязки закрывается и освобождает Account, тогда как неизвестная legacy-классификация, отозванное
согласие, отсутствующий контакт или сумма вне подтверждённых границ терминала только блокируют
продление и остаются операторским разбором.

Повышение сохраняет срок и длительность: доплата равна цене старшего варианта за оставшуюся часть
периода минус остаток фактически оплаченной суммы, с округлением половины копейки вверх один раз
на итоге. Оплаченные 1 000 ₽ и переход на 3 500 ₽ ровно в середине месяца дают 1 250 ₽. После
повышения остаток срока держится по цене нового варианта, и она же становится базой следующего
расчёта: переход 3 500 ₽ → 5 000 ₽ за четверть периода до конца стоит 375 ₽. Повышение доступно и
внутри отменённого оплаченного срока, потому что отмена останавливает только продление. Понижение и
другая длительность вступают в силу следующим периодом и поэтому требуют действующего расписания;
запланированное изменение согласуется и снимается только до отправленной попытки продления.
Нулевая или отрицательная доплата не отправляется в банк.
Смена варианта не получает новую публичную скидку, а цена продления берётся из принятых условий
подписки, а не из текущего каталога.

Смена карты идёт отдельным банковским процессом AddCard с серверной сверкой GetAddCardState:
новый способ применяется только по доказанному token, не воскрешает отменённое продление и не
удаляет карту покупателя у банка. Уже созданная попытка удерживает выбранный способ, поэтому более
поздняя замена относится только к следующим разрешённым отправкам. Проверка привязки требует
подтверждённой terminal capability `cardBinding`; без неё операция возвращает `method_unavailable`.
СБП, T-Pay и другие способы этой поставкой не доказаны.

`billing-worker` получает очередь `billing.subscription-renewal`: она запускает due-продления,
сверяет сессии привязки и закрывает истёкшие расписания. Очередь `billing.payment-recovery`
продолжает сверять незавершённые попытки и применять entitlement outbox.

## Текущая поставка #409

#409 даёт владельцу проверенные действия вместо правки базы: состав и версии предложений,
чтение и сверка платежей, отмена продления, решение и исполнение возврата, ручная одиночная и
массовая выдача, продление и отзыв конкретного основания. Кабинет покупателя (#411), уведомления
(#410), реальный терминал и DEMO (#402/#413) остаются отдельными поставками. Проверка идёт на
реальном PostgreSQL и синтетическом банковском адаптере; реальных возвратов и выдач здесь нет.

Одна поверхность обслуживает оба транспорта: `POST billing/admin` c `operationId` `manageBilling`
и MCP-инструменты `billing_<operation>`. Оба вызывают один facet, поэтому полномочия,
идемпотентность, проверка revision и аудит совпадают; MCP не имеет большей власти, чем admin
endpoint. Actor приходит из доверенного adapter, а не из нагрузки команды.

Полномочие — отдельное `billing:manage` действующего владельца, записанное в
[identity specification](identity-principals-session-v1.md). Новых администраторов и роли эта
задача не назначает; `platform:admin` включает это право, поэтому прежний доступ сохраняется.
Каталог и ручные права перешли на то же право; классификация старой подписки остаётся за
`platform:admin`, потому что она не входит в billing-операции.

Фискальная ошибка представлена отдельным состоянием платежа, видимым владельцу. Спор по
банковскому платежу остаётся операционным состоянием без своей операции: в завершённом
исследовании #341 у провайдера не найдено отдельного disputes API или webhook, поэтому фиксация
спора появляется вместе с подтверждённой конфигурацией терминала в #402/#413, а правила Education
не переносятся автоматически.

### Контракты реализации #409

Реализованы `offers.save|archive`, `paymentOptions.save|archive`, `promotions.save|archive`,
`payments.list|read|reconcile`, `subscriptions.cancel`, `refunds.decide|execute|read`,
`grants.read|previewBatch|applyBatch|extend|revoke`. `deliveries.read|resolve` остаются за
[Notifications v1](notifications-v1.md) и своей поставкой #410: billing не заводит вторую
поверхность доставки. `grants.read` добавлен к перечисленному в #403 набору, потому что решение о
возврате и об отзыве требует видеть действующие основания и их историю.

Каждая применённая изменяющая команда пишет audit-строку с исполнителем, операцией, основанием и
результатом; она же служит receipt повтора: та же нагрузка возвращает исходный результат,
изменённая — `operation_conflict`. Исполнение возврата наследует основание своего решения, поэтому
запись объясняет деньги, а не повторяет имя операции. Отпечаток канонический, поэтому порядок
ключей и отсутствующие необязательные поля не создают ложный конфликт. Отклонённая команда не
занимает receipt и повторяется тем же `operationId`; неудачный возврат при этом сохраняет свою
запись решения и попытки с наблюдённым статусом. Чтение не пишет receipt и повторяется свободно;
предпросмотр партии сохраняет только свою строку предпросмотра, поэтому он audit-записан, но
ничего не выдаёт. Записи audit и владельческие представления платежа не содержат RebillId,
шифротекст привязки и контакт чека.

Решение о возврате принадлежит своей команде: `actor + operationId` уникальны, поэтому повтор
возвращает исходное решение, а не создаёт второе, и запись решения фиксируется одной транзакцией с
проверкой остатка. У `refunds.execute` receipt появляется после ответа банка, поэтому повтор читает состояние
решения: до ответа это `refund_in_progress`, после смены revision — `revision_conflict`, у
завершённого решения — `state_conflict`. Второй отправки не бывает ни в одном из этих случаев.
Незавершённая попытка другого решения того же платежа тоже возвращает `refund_in_progress`.

`refunds.decide` фиксирует сумму, судьбу доступа (`keep|revoke`) и судьбу автопродления
(`keep|cancel`) с причиной, ничего не отправляя в банк. Сумма ограничена остатком: подтверждённые
и незавершённые возвраты удерживают свою часть, поэтому сумма сверх остатка возвращает
`unsupported_amount`, а нулевая и отрицательная отклоняются схемой. Возврат существует только по
подтверждённому платежу с известной банковской операцией того же терминала и окружения.

`refunds.execute` принимает `decisionRef` и `expectedRevision`, но не новую сумму. Попытка
сохраняется до обращения к банку, её идентификатор служит `ExternalRequestId`, и частичный unique
index допускает одну незавершённую попытку на платёж. Потерянный ответ оставляет попытку
`unknown` и виден владельцу; падение процесса до записи ответа оставляет её `sent`, и сверка
восстанавливает оба состояния. Сверка повторяет тот же `ExternalRequestId`, который банк считает
тем же запросом, поэтому второй возврат не создаётся. Терминальный `REFUNDED|PARTIAL_REFUNDED|
REVERSED|PARTIAL_REVERSED` даёт `confirmed`; неуспех — `failed`; всё остальное остаётся
неопределённым до следующей сверки. Сумма, платёж и терминал попытки неизменяемы триггером, а
терминальный результат не переписывается.

Доступ и автопродление меняются только после подтверждённого возврата. Отзыв доступа повторяет
ровно те условия, которые выдал платёж, новой revision через тот же entitlement outbox, поэтому
независимые manual, lifetime и legacy основания остаются в силе, а сбой выдачи восстанавливается
без повторного обращения в банк. Полный возврат сам не отзывает доступ: это отдельное решение.
Отмена продления как следствие возврата сохраняет оплаченный срок.

`payments.list` использует limit 1..100 и cursor — идентификатор последнего показанного платежа,
позиция которого читается на сервере. `payments.read` показывает условия оплаты, готовность
доступа, историю событий, решения о возврате и audit этого платежа.
`subscriptions.cancel` выполняет тот же use case, что и команда покупателя, поэтому правила срока
и revision общие. Очередь `billing.payment-recovery` дополнительно сверяет незавершённые возвраты.
## Текущая поставка #415

Platform становится producer общего права участия. Проектор собирает желаемое состояние из
совокупности действующих оснований (`resolveCapabilities`) и подтверждённой связи
(`TelegramAccountLinks.readBinding`), читает только публичные facets и сам прав не выдаёт.
Монотонная `entitlementRevision` растёт и при смене связи, а не только при смене доступа.
Устаревшее чтение не двигает проекцию назад. Unlink и relink дают две команды разным получателям:
`cleanup` по исторической связи и `apply` по новой. Отказ уходит только тому получателю, которому
раньше сообщили о допуске.

Durable outbox `telegram_membership.community_operations` хранит точную команду, её канонический
fingerprint, состояние доставки и последний результат провайдера. Потерянный ответ повторяется тем
же operationId и той же нагрузкой, поэтому повтор не становится второй командой. Решённый отказ
переходит в `rejected` и является работой оператора, а не новым идентификатором операции.
Callback контрактом не предусмотрен: опрос `entitlement.status` превращает принятое намерение в
наблюдаемое применение и замечает вышедшего участника без новой revision. Ack очереди не выдаётся
за членство: желаемое, принятое и применённое остаются разными полями.

Фоновая сверка в `billing-worker` раз в минуту покрывает три источника без запроса пользователя:
упорядоченный курсор изменений доступа, наступившую границу срока и изменившуюся связь. Курсор
двигается только по полностью спроецированному окну. Незавершённая работа старше пяти минут
сообщается как `operator_attention`.

Каждый ответ провайдера сверяется с самой отправленной командой: операция, получатель, revision и
access. Ответ с чужой связью или другой revision — неизвестный исход, а не факт об Account.

`/internal/billing-dispatch/authorize` пересчитывает актуальные право и связь заново, а не доверяет
поставленной в очередь команде. Получатель проверяется раньше revision, поэтому команда с уехавшей
связью называется binding_conflict независимо от того, выпущена ли уже более новая. Ответ
unavailable — временный сбой, а не решение, и не сохраняется: тот же authorization operationId
позже может получить настоящий ответ. Истёкшее основание не разрешает вход и не разрешает удалить
участника, у которого уже есть другое действующее или бессрочное. Удаление исторической identity
после unlink допускается только по собственной записи того же Account и при отсутствии переноса;
спорная identity уходит оператору. Permit живёт не дольше 5 секунд и не дольше самого права; повтор
того же authorization operationId возвращает исходный ответ вместе с исходным сроком. Ledger
эффекта принадлежит Telegram. Сбой community не меняет подтверждённую оплату и доступ к материалам.

Поверхность, конфигурация и границы описаны в
[Community entitlements](../integrations/community-entitlements-v1.md).

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
| `telegram-membership` | Community desired state, entitlement revision, outbox и delivery observation; project/sweep/authorizeDispatch/readDelivery | #415 |
| `billing` | Notice-ready event, due reminder и актуальность billing source | #410 |
| `notifications` | Общие Notification/Delivery, verified recipient snapshot, email/Telegram adapters и authorizeDispatch по [Notifications v1](notifications-v1.md) | #434/#436/#410 |

Каждая строка описывает реальный потребительский seam; это не требование создать отдельный класс
или DI token для каждой операции. State-owning Prisma delegates остаются внутри capability.
Общий `communications` API сохраняет маркетинговую семантику; billing не запускает campaign для
служебного сообщения. Для Notifications межсервисный transport — RabbitMQ по [новому контракту](notifications-v1.md).
Новые worker entrypoints вводятся с первым durable job, используя принятую
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
в domain logic. Первая покупка/после перерыва — от первого проверенного и сохранённого Inside
CONFIRMED; своевременное продление — от прежнего конца. Late повторное подтверждение сохраняет
исходные записанные начало и конец.

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

## Реализованный pricing boundary (#405)

`billing` владеет каталогом и неизменяемыми ценовыми снимками в schema `billing`.
`POST billing/admin` принимает закрытые команды `offers.save|archive`,
`paymentOptions.save|archive`, `promotions.save|archive`; действующее `platform:admin`
проверяется через Accounts перед каждой командой, включая replay. Выделение `billing:manage`
и остальные admin/MCP операции остаются #409. Создание не принимает `expectedRevision`,
изменение требует текущую revision. Успешный результат и actor/operationId/fingerprint
сохраняются атомарно; повтор возвращает исходный результат, другая нагрузка конфликтует.
Архивирование обратимо через Save с актуальной revision; снимки не изменяются.

`GET billing/offers` публично возвращает активные варианты с лучшей доступной публичной
скидкой. Закрытые промокоды не раскрываются. Пагинация — opaque UUID cursor и limit 1..100.
`POST accounts/current/billing/quote` сохраняет ценовой quote на 15 минут для Account из
trusted adapter. Он содержит offer/option revisions, названия, состав, календарные месяцы,
RUB/Europe/Moscow, первую и обычную следующую сумму, выбранную скидку. Это ценовой этап:
подтверждённый contact, legal versions, recurring consent, календарный anchor/next date и
предупреждение о действующих правах присоединяет purchase orchestration #407; quote сам по
себе не разрешает оплату и не является согласием. Повтор operationId возвращает тот же quote,
даже после истечения; для нового согласия нужен новый operationId.

Акция задаёт целый процент 1..100, интервал `[startsAt, endsAt)`, optional case-sensitive
промокод, области offerIds/paymentOptionIds и optional usageLimit. Пустая область означает
все объекты; две непустые области пересекаются. Код обрезается по краям. Среди подходящих
акций выбирается максимальный процент; равенство разрешается стабильным ID. Итоговая первая
сумма округляется до копейки один раз, половина вверх. Нулевая сумма (включая 100% или
округление малой цены) возвращает `unsupported_amount` и не заменяется другой скидкой.

Внутренние `BillingPricing.reserve` и `settle` — операции pricing, без публичного HTTP и без
provider I/O. #407 вызывает reserve **только для первой оплаты новой подписки**, после своей
проверки единственного subscription lifecycle и явного согласия. Продление, возобновление
ещё действующего срока и upgrade не вызывают reserve и не получают новую скидку; новая
подписка после завершения может получить её снова. Quote не гарантирует наличие последнего
места акции. При reserve сериализуются изменения каталога и подсчёт всех reserved/sent/unknown/
confirmed применений. Изменившиеся условия, недоступная акция или исчерпанный лимит дают
`quote_changed`: #407 должен показать новый quote и запросить согласие. Истёкший quote даёт
`quote_expired`. Клиент не передаёт сумму или банковские границы.

Reserve требует подтверждённые min/max суммы от terminal capability #402, проверяя первую и
обычную следующую сумму. Отсутствие capability или выход за границы даёт `unsupported_amount`.
Успешный reserve фиксирует условия даже при последующей архивации/редактировании каталога.
Повтор purchaseRef с той же парой Account/quoteRef возвращает исходный снимок; другая пара
конфликтует. Один quote не резервируется для двух покупок. Одна открытая pricing reservation
на Account ограничивает две вкладки, но не заменяет constraint действующей подписки в #407.

Перед отправкой #407 сохраняет свой durable attempt и переводит reservation `reserved → sent`;
этот переход или его replay **не является самостоятельным разрешением повторить provider I/O**.
`sent → unknown` сохраняет лимит без таймера освобождения. Только проверенный definitive failure
или доказанная отмена до отправки дают `failed`; verified confirmation даёт `confirmed` один раз.
Поздний повтор не меняет терминальный результат. Эти use cases должны вызываться из общего
bank outcome path #407/#408, включая recovery после падения между записями; HTTP webhook,
проверка подписи, payment receipt/outbox и сам subscription lifecycle сюда не входят.
Снимок из reserve используется для сохранённых условий подписки; публичный каталог не является
источником цены её последующего продления.

Fitness: `test/integration/billing-pricing.test.ts` проверяет ограничения, rollback, изменения
полномочий, два PostgreSQL клиента, лимит, replay и неизменяемость. Domain/HTTP mapping проверяет
`test/billing-pricing.test.ts`; общие backend guardrails проверяют capability imports и
запрещают отрицательные fixtures. Реального банка и полноценного checkout эта проверка не доказывает.

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
| | Поставленный набор операций и его отличия описаны в [текущей поставке #409](#текущая-поставка-409): `deliveries.*` остались за Notifications | |
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

## Подтверждённый контакт и согласия — #406

Accounts владеет отдельным billing contact, который не является способом входа и не меняет
Logto identity или login fingerprint. GET `accounts/current/billing/contact` возвращает собственный
подтверждённый адрес, revision и применимые документы. Start принимает `operationId`, email и
`expectedRevision` (0 для первого адреса). Confirm принимает `operationId`, `challengeRef`, code.
При смене старый контакт действует до подтверждения нового. Совпадение адресов разных Account
не объединяет их и не передаёт права. Неподтверждённый адрес не возвращается как получатель чека.

Код живёт 10 минут; новый challenge отменяет предыдущий. У challenge не более 5 проверок кода.
Отправки сериализуются: минимум минута между запросами Account, до 5 в час на Account и до 10
за сутки на адрес между Account. Повтор `operationId` с прежним payload возвращает прежний
результат, изменённый payload конфликтует; повтор не отправляет письмо и не расходует попытку кода.
Резервация отправки фиксируется до SMTP. `sent` означает принятие SMTP, не доставку в ящик;
`unknown` допускает ввод полученного кода, но не автоматическую повторную отправку.

POST `accounts/current/billing/consents` принимает `operationId`, `contextRef` будущего checkout
и список явно принятых документов (`accepted: true` для каждой записи). Виды `terms`, `recurring`,
`personal_data`, `marketing` независимы. Принимается только точное совпадение с серверным каталогом
по виду, ID, версии и SHA-256 текста. Evidence сохраняет текст, URL, digest, версию, Account,
контекст и время; PostgreSQL запрещает update/delete. GET
`accounts/current/billing/consents/:evidenceRef` восстанавливает собственную запись; чужая скрыта
за 404. Новая публикация не изменяет старое согласие или ответ на прежнюю команду.
Само evidence не разрешает списание: #407 связывает его с точным quote/условиями, #408 проверяет
действующее разрешение на recurring и отмену.

До legal #412 production-каталог пуст: синтетические документы существуют только в тестах.
Форма `/account/email` подтверждает контакт; итоговые checkbox/checkout и визуальная интеграция
принадлежат #411. Она использует production BFF/API; Storybook подставляет только presentation.
SMTP и ключ хранения подключаются явно; без конфигурации start/confirm возвращают unavailable.
[Runbook контактов](../runbooks/billing-contact.md) описывает эксплуатационную границу и proof.

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
Account reference через [контракт измерений подписочной аналитики v1](subscription-analytics-measurement-v1.md);
manual grant не считается выручкой.
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
