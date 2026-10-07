# Активация тарифа прежних участников курса

Telegram реализует сценарий [#64](https://github.com/sachkov-inside/inside-telegram/issues/64)
из [Workspace #180](https://github.com/sachkov-inside/workspace/issues/180).
Platform определяет Account, тариф, Enrollment, состав и срок каждого права. Telegram
проверяет участника разрешённой группы курса по verified identity и продолжает обращение после входа.

По [ADR 0033](../../../../docs/adr/0033-product-tariff-payment-model.md) активация прежних участников курса назначает тариф курса бессрочно,
путь Tribute становится приглашением оплатить подписку, а подарочного режима приглашения нет.
Этот порядок реализован в Platform #1064.

## Версии и границы

Схема и примеры принадлежат корневому `docs/contracts/subscription-activation-v1`.
Platform #1064 обновляет их вместе с копиями Telegram и runtime-схемой.
Исторический [provenance #66](subscription-activation-v1-provenance.json) описывает прежний контракт,
который включал активацию Tribute; он не описывает текущую версию.

Shared Enrollment.state добавляет `pending_verification` и `suspended_source` и в
`ownAccessResponse.value.enrollments[]`, и в non-null `activationResponse.value.enrollment`.
Activation outcome.state и binding не меняются; additive rule mode и evidence decision описаны ниже. `pending_verification` означает,
что временное основание пока не подтверждено и само доступа не даёт; бот предлагает повторить
проверку позже или обратиться за помощью. `suspended_source` означает зафиксированное окончание
источника: повтор/member не восстанавливают его. Бот направляет к владельцу для подтверждения
нового периода и продолжает показывать независимые действующие Guide/course основания.
Решения о выдаче и восстановлении принадлежат Platform. Telegram не хранит own-access проекцию
в отдельной таблице; миграция для расширения transport enum не нужна.

`docs/contracts/community-v2` остаётся из принятого Platform PR #626, commit
`7ac1a7200489c822569435afeac88a6f16b76ef5`. Corpus читается локально; checkout и база Platform
не входят в imports. [Прежнее evidence #64](../evidence/course-activation/README.md) относится
к baseline до расширения #625 и не подтверждает runtime Tribute.

Все операции идут через authenticated HTTP. `binding` принимает только `contractVersion`
и opaque `identityRef`; возвращает linked с точным binding либо unlinked. Используется существующий
activation credential, отличный от linking/sign-in/community credentials. `unavailable` не означает
отсутствие Account. `identity_conflict` прекращает автоматическую проверку. Никакого внутреннего
Account UUID, угадывания `linkRef` или увеличения `linkRevision` на стороне Telegram нет.

## Прежние подписчики Tribute

Активации по реестру нет. `verificationMode` допускает только `course_membership`, если указан;
`registry_lookup` отвергается схемой. Владелец выдаёт подписчику Tribute личное приглашение
на оплату «Подписки Inside». Погашение не выдаёт прав: человек оплачивает подписку сам.
Продажа подписки остаётся выключенной до подтверждения банка.

## Обращение и доказательство

Private `/start a_<code>` занимает длину 3–42. Длинные legacy linking, `signin_` и `m_`
сохраняют прежнюю маршрутизацию. Проверенный Telegram update задаёт отправителя, чат и metadata;
переданные извне служебные поля удаляются. Активация не означает согласия на маркетинг.

До входа сохраняются opaque identity и отдельная попытка для пары пользователь/код.
Кнопки ведут на обычный Account URL Platform. Login token выпускает только browser-owned
Logto/sign-in. Существующий Account связывается в кабинете; конфликт требует восстановления
владельцем. Identity остаётся прежней после связывания и очистки старого незавершённого обращения.

Worker арендует попытку в PostgreSQL, получает актуальное правило и binding, проверяет отдельный
source registry. Canonical chat запрещён в source registry. `whole_group` означает утверждённый
источник целиком; `confirmed_list` дополнительно требует opaque identity в подтверждённом списке.
Гости вне политики и неучастники не получают право. Потеря полномочий бота, 429 и timeout дают
`unavailable`, с задержкой повторения. Course proof не записывается в canonical MembershipEvidence.

Evidence сохраняется перед отправкой, живёт не более пяти минут и содержит точные версии binding
и rule. При потерянном ответе сначала повторяется **тот же** payload и evidenceRef, даже после TTL:
это позволяет получить прежний receipt принятой выдачи. После определённого отказа просроченной
непринятой proof выполняется новая проверка с новым evidenceRef в пределах срока обращения. Изменение payload никогда не
использует прежний evidenceRef. Определённый временный результат получает новую Platform attempt,
поскольку `begin` прежней attempt возвращает сохранённый результат. Неопределённая запись не
удаляется по 30-дневной очистке. По истечении срока очищаются незавершённые обращения без
отправленного evidence либо с определённым отказом/`unavailable`, включая уже связанные Account.
Worker не начинает новую проверку по истёкшему обращению; новый явный `/start` создаёт свежее.
Если неопределённый исход прояснился только после срока и выдачи не было, запись очищается без
новой proof. Подтверждённые receipts и права Platform сохраняются. Повтор отклонённой заявки
доступен и после этого срока. Одинаковые фоновые сообщения дедуплицируются.

`Мои доступы` и вступление читают текущее own-access Platform. Отдельные основания объединяются
на Platform. Выход из группы после принятия курса не сокращает назначенный срок. Бот показывает
источник, срок назначения, отдельные benefit terms и отсутствие списаний для nonpaid назначения.
Команды и callback не несут доверенных прав: состояние перечитывается на каждом обращении.

## Обычный `/start`

Обычный `/start` попыток активации не создаёт и Platform по протоколу активации не вызывает
([#115](https://github.com/sachkov-inside/inside-telegram/issues/115)). Проверку начинает только
`/start a_<code>`, в том числе кнопка владельца в группе курса. Очередь разбора существует только
внутри Telegram, см.
[runbook](../operations/course-activation.md#подтверждение-статуса-прежних-участников).

## Приглашения `i_<code>`

Владелец выдаёт в кабинете Platform личное одноразовое приглашение на Offer
([platform#907](https://github.com/sachkov-inside/platform/issues/907), контракт
[platform#908](https://github.com/sachkov-inside/platform/issues/908)). Ссылка
`t.me/<бот>?start=i_<code>` занимает ту же длину 3–42, что `a_` и `m_`; код — 1–40 символов
`[A-Za-z0-9_-]`. Более длинный payload остаётся legacy linking. Код до обработки update лежит в
служебном поле, а не в тексте; после обработки inbox стирает payload целиком.

Бот вызывает `POST /integrations/telegram/v1/invitations/redeem` с тем же activation credential.
Адрес — сосед `PLATFORM_ACTIVATION_URL`: `…/subscription-activation` → `…/invitations/redeem`.
Запрос несёт только `code` и opaque `identityRef`; Account Platform читает сама. Таблица
`invitation_redemptions` хранит одну строку на человека и код, пока Platform не ответит окончательно;
окончательный ответ удаляет строку вместе с кодом.

| Ответ Platform | Что делает бот |
| --- | --- |
| `needs_account` | прежнее приглашение войти с кнопками кабинета; повторяет тот же запрос раз в минуту и сразу после «Я связал Telegram — проверить» |
| `purchase_ready`, `already_redeemed` с `mode: purchase` | кнопка «Оплатить» на `checkoutUrl` |
| `claimed_by_other`, `expired`, `revoked`, `unavailable` | понятный текст «напишите автору», без повторов |
| ошибка `identity_conflict` или `invalid_input` | текст «напишите автору», без повторов |
| ошибка `unavailable` или нет ответа | одно сообщение «повторит сам», затем повтор того же запроса: пауза 1, 2, 4… минуты, не больше часа |

Повтор безопасен: Platform погашает приглашение один раз по паре `(code, identityRef)`, а бот после
потерянного ответа отправляет тот же запрос. На каждое открытие ссылки и каждый исход бот отвечает
не больше одного раза. Повторное открытие той же ссылки начинает обращение заново и получает
`already_redeemed`. Строка без окончательного ответа удаляется через 30 дней после последнего
открытия: столько Platform ждёт Account для закреплённого приглашения.

Ученик курса, которого нет в группе курса, получает отказ активации с просьбой написать автору:
владелец назначает ему тариф курса бессрочно ([ADR 0033](../../../../docs/adr/0033-product-tariff-payment-model.md)).

## Community v2

`TELEGRAM_COMMUNITY_CONTRACT_VERSION=inside.community-entitlement.v2` явно включает v2.
Новые команды несовместимой версии отвергаются; старые v1 status receipts читаются.
Dispatch сохраняет `inside.billing-dispatch.v1`, но target и SHA-256 digest соответствуют точному
v2 wire payload, включая исходное написание UUID. Нет fallback на v1 при отказе.

Admission использует личную короткую join-request ссылку с сохранёнными identity/revision,
digest и expiry. Чужая или истёкшая ссылка не открывает approve effect. Перед каждым внешним
эффектом проверяется свежий permit. Неопределённый invite ожидает сохранённого срока; ban/approve
сверяются наблюдением. Участнику повторная ссылка не нужна.

`admissionRestriction` отделён от права на контент. Собственный подтверждённый expiry ban допускает
последующее восстановление. Модераторский ban и неизвестное происхождение запрещают автоматический
unban даже после покупки или `/start`. Исключение ботом из `TELEGRAM_COMMUNITY_TRIBUTE_BOT_ID` —
известное окончание подписки Tribute: запрета не создаёт, а при действующем праве бот снимает бан и
отправляет ссылку для возвращения ([схема двух ботов](../operations/course-activation.md#два-бота-в-общей-группе)). События одной секунды упорядочиваются по updateId.
Собственное событие сопоставляется сохранённой попытке; поздний ответ старой операции не перезаписывает
новое операторское решение. Прямая operator-команда доступна только через локальный CLI,
с preview, точной revision, actor/reason и идемпотентным operationId.

Эксплуатация и локальная проверка: [runbook](../operations/course-activation.md).
