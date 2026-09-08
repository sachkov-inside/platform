# Billing integration v1: переносимый контракт

Статус: proposal Platform #403, исходная граница принята в Workspace PR #151.
[Локальная specification](../../specifications/subscription-billing-v1.md) задаёт use cases,
владельцев состояния, REST/MCP inventory и delivery gates. Этот bundle задаёт только новые
межсервисные сообщения; старые identity/evidence/communications версии не расширяются.

## Артефакты и принятие

- [schema.json](schema.json) — JSON Schema draft-07, closed objects и три explicit contractVersion.
- [fixtures.json](fixtures.json) — положительные/отрицательные wire examples.
- [scenarios.json](scenarios.json) — нормативные последовательности с ожидаемыми исходами и
  owning implementation tickets. Это вход в будущие runtime tests, не готовый симулятор.
- [manifest.json](manifest.json) — SHA-256 bundle и исходников, exact Workspace revision.
- [product source](sources/subscription-billing-v1.txt) и [shared boundary source](sources/subscription-access-v1.txt)
  — неизменённые bytes исходных Markdown в `.txt`, чтобы их оригинальные относительные ссылки
  не выдавались за локальные ссылки копии. Они разрешаются относительно sourcePath/sourceCommit
  manifest; для исполнения достаточно локальных текстов и specification, сетевого импорта нет.

Platform #403 владеет первой версией wire schema. Telegram #54 копирует bundle byte-for-byte
из merged Platform commit и записывает этот commit в собственном provenance metadata. Изменение
required field, semantics или enum требует новой contractVersion и согласованной поставки обеих
сторон; действующий v1 не расширяется неизвестными полями. Обновление digest не заменяет review.

Ajv draft-07 и ajv-formats уже используются репозиторием; [официальная документация](https://ajv.js.org/json-schema.html#draft-07-default)
подтверждает default dialect. Tests проверяют fixtures/shape/hash; chronological, revision,
identity и stateful assertions ниже проверяют runtime tickets, не JSON Schema самостоятельно.

## Transport и service authorization

| Направление | POST path (без deployment prefix) | Contract |
|---|---|---|
| Platform → Telegram | `/internal/community-entitlements` | `inside.community-entitlement.v1` |
| Platform → Telegram | `/internal/billing-notifications` | `inside.billing-notification.v1` |
| Telegram → Platform | `/internal/billing-dispatch/authorize` | `inside.billing-dispatch.v1` |

Это target paths, ещё не endpoints приложения. HTTPS; JSON body максимум 16 KiB; request timeout
5 секунд; redirects запрещены. Отдельные service secrets на каждое направление через project
configuration; `Authorization: Bearer` проверяется constant-time существующим механизмом.
Секреты не передаются в user-facing Web/MCP, в URL или payload. Существующий marketing caller не
получает billing authority. Bank notification использует собственную подпись, не этот протокол.
Никакие credentials в #403 не создаются и не настраиваются.

Authenticated HTTP 200 означает schema-valid result/error ниже, а не непременно external success.
Для `error`: malformed=400, unauthorized=401, unsupported_contract=422, not_found=404,
operation_conflict/revision_conflict/binding_conflict=409, unavailable=503. Существующий adapter
сверяет и HTTP, и body; несоответствие — invalid provider response/unknown, не повтор эффекта.
Без parseable operationId сервер возвращает generic 400/401 через свой HTTP error boundary;
не выдумывает correlation или успешное durable acceptance. Никакой effect до аутентификации,
валидации и durable receipt. Ошибки не раскрывают raw provider/identity details.

У каждой request есть operationId UUID. Для status lookup это ID исходной операции. Response
коррелируется с запросом: operationId и version всегда совпадают; result для entitlement также
сохраняет binding/revision/access исходной команды, не произвольного latest Account snapshot.
Для notification — noticeRef. Unknown/status not_found не разрешает caller слепо создать новый
operationId; sender сверяет свою durable запись и повторяет тот же command, если acceptance не
подтверждено. Новый ID допустим только для новой бизнес-операции или явно разрешённого recovery.

Idempotency scope — authenticated service + contractVersion + operationId. Fingerprint — SHA-256
UTF-8 JSON исходной schema-valid command с отсортированными ключами objects, исходным порядком
arrays, без лишних пробелов; Unicode сохраняется, integers только safe, даты остаются исходными
wire strings. На обеих сторонах один и тот же payload, без произвольной нормализации перед hash.
`payloadDigest` dispatch authorization относится к этому fingerprint исходной set/send команды,
а не authorize request. UUID spelling нормализуется на boundary до сохранения/вычисления hash.

## Community protocol

`entitlement.set` содержит binding (opaque accountRef и telegramIdentityRef, linkRef UUID,
linkRevision), монотонную entitlementRevision для Account, access, issuedAt и correlationRef.
`access.kind` — `denied`, `finite` с validUntil, либо `lifetime` без искусственной далёкой даты.
Протокол не передаёт цену, payment token, raw Account ID, Telegram chatId или username.

Platform #404 расширяет текущий link facet стабильным linkRef/revision и историческим tombstone;
это не новое доказательство Telegram identity. #415 привязывает каждую delivery к конкретной
verified связи. Provider не создаёт link из entitlement request и сверяет свою verified identity.

Правила admission и применения:

1. Одна operationId + тот же payload возвращает durable result; другая нагрузка — operation_conflict.
2. Меньшая entitlementRevision не меняет desired state. Новый operationId с той же revision и
   другим desired state — revision_conflict; идентичное состояние с той же revision не создаёт
   второй эффект. Link change также увеличивает entitlementRevision, а не только linkRevision.
3. Provider сохраняет accepted до acknowledgement. Очередь, запрос на вступление и фактическое
   членство различаются. `waiting_for_join` не считается `applied`.
4. Для выдачи создаётся контролируемый join-request путь; approve только intended verified
   identity и действующее право. Чужая ссылка/username не выбирает получателя.
5. Перед внешней mutation или approve Telegram запрашивает свежий dispatch permit. Даже при
   accepted старом grant он не выдаёт вступление после expiry/revoke/unlink.
6. После запрета Telegram устраняет членство и возможность повторного вступления, пока нет нового
   действующего allow. Exact Bot API sequence и права бота фиксирует #54; `banChatMember` запрещает
   rejoin, `approveChatJoinRequest` требует admin permission. [Bot API](https://core.telegram.org/bots/api#banchatmember)
   — источник поведения, не доказательство прав нашего бота.
7. Для revoke после unlink Platform разрешает удаление старой identity лишь по историческому
   binding того же Account и отсутствию разрешённого transfer. Такая команда не даёт права на
   старый grant; конфликт владения уходит оператору. Reconciliation не удаляет чужую identity.

Result `status`: accepted, waiting_for_join, applied, superseded, failed, unknown, expired.
`observedMembership`: member/not_member/unknown. `applied` allow означает подтверждённое member;
`applied` denied — подтверждённое отсутствие и закрытие admission. Schema проверяет непротиворечивость applied/access/observedMembership; фактическое observation
и порядок событий обязаны проверить provider/consumer runtime tests. Истёкший allow переводится
в expired и не даёт вход; worker устраняет оставшееся участие, не считает его уже удалённым.

Изменения outbox обрабатываются promptly; контрольная сверка known desired states не реже раза
в минуту, overdue apply/reconcile старше 5 минут виден оператору и в alert. Это интервал нашей
проверки, не гарантия доступности Telegram. Если Bot API недоступен, статус unknown/failed,
материалы по paid/manual праву продолжают работать. GetChatMember сверяет known identity,
не перечисляет весь roster. Timeout внешней mutation требует observation перед её повтором.

## Уведомления и dispatch permit

`notification.send` — plain text до 3000 символов, kind из закрытого списка, noticeRef/revision,
verified binding, issuedAt/notAfter. Только служебные типы; разметка, media и arbitrary URL fields
не входят. Ссылка управления может содержаться в подготовленном Platform text только на свой
настроенный HTTPS origin; producer проверяет её, Telegram не использует пользовательский URL
как произвольный destination. Текст не содержит bank tokens или данные чужого Account.

Расписание принадлежит Platform. Telegram принимает только готовую к ближайшей отправке notice,
notAfter не позднее issuedAt + 10 минут. При истечении она suppressed, не отправляется постфактум.
Platform пересоздаёт актуальное намерение по новой noticeRevision, если событие ещё требует
уведомления. Для email те же recipient/revision/current-state проверки выполняет локальный sender.
Ошибка любого канала не меняет подтверждённую оплату и права.

Порядок после durable acceptance:

1. Telegram worker берёт конкретную dispatch операцию под эксклюзивную блокировку. Для новой
   допустимой попытки сохраняет attemptId. До отправки вызывает `dispatch.authorize`, передавая
   исходные dispatchId, dispatchContractVersion и fingerprint; новый operationId идентифицирует authorization request.
2. Service adapter по dispatchContractVersion вызывает публичный authorization facet владельца:
   telegram-membership для community, billing для notice. Владелец находит свою outbox/notice запись, проверяет service scope, fingerprint,
   current entitlement/notice revision и verified binding. Для reminder дополнительно проверяет
   актуальные дату/сумму/отмену; для старого revoke — проверку исторического владельца выше.
3. Allowed даёт durable permitRef и validUntil не позже now + 5 секунд, связанные с dispatchId и
   attemptId. Повтор authorization operationId возвращает тот же результат; другая нагрузка —
   operation_conflict. Denied сообщает superseded/binding_conflict/expired/not_found/payload_conflict/
   already_dispatched. Unavailable не разрешает отправку.
4. Provider проверяет собственные latest desired state и deadline, до I/O сохраняет started
   вместе с attempt/permit. После этого unknown результат нельзя автоматически отправить снова.
   Permit, истёкший до started, не используется; новую попытку разрешают только после durable
   доказательства отсутствия started, под той же provider блокировкой. Platform проверяет status
   исходной операции перед выдачей нового permit после истечения прежнего; unknown запрещает его.
5. Успех Telegram API даёт sent с opaque noticeRef; однозначный запрет/недостижимый recipient —
   failed; superseded/expiry — suppressed. Потерянный ответ sendMessage — unknown, manual recovery:
   Bot API не предоставляет idempotency key для такого send, поэтому гарантии exactly-once нет.

Dispatch permit — граница уже разрешённой отправки. Отмена, пришедшая после started, не обещает
отозвать уже отправляемое сообщение. Она запрещает следующие attempts; это race boundary, а не
гарантия «ни одного сообщения после нажатия». Если отмена принята до authorization, stale reminder
не разрешается. Period/status cancellation не сбрасывает запись started.

No-acceptance network failures повтора internal HTTP request используют тот же operationId.
До внешнего started можно повторить authorization/доказанный временный failure по backoff
1, 5, 30 секунд с общим сроком не дольше notAfter; community reconciliation продолжает отдельный
путь. Это не разрешает retry bank Charge или unknown sendMessage. Вся история delivery доступна
оператору; queue ack никогда не становится sent/member автоматически.

## Conformance ownership

#403 исполняет только schema-valid/invalid examples, integrity и ссылки sequence corpus.
Platform #404/#407/#409/#410/#415 и Telegram #55/#56 исполняют normative expected outcomes через
real facets и PostgreSQL. Каждый consumer также проверяет response correlation, semantic поля,
replay и exact HTTP/body mapping. Нет тестовой реализации billing, которую можно принять за
production код. #413 объединяет обе стороны и отдельно доказывает разрешённые реальные эффекты.
