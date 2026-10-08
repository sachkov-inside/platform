# Отчёт участников группы: границы Bot API

Исследование #979, 08.10.2026. Проверенный исходный код: Platform commit
`b3f8555ccf8008bb8847decc6aa5749f7317f291`. Это исследование возможностей,
а не выгрузка production. Число «около 156» взято из Issue и здесь не измерялось.

## Вывод

Полный состав группы бот получить не может. Полезный частичный отчёт можно построить
по известным Telegram ID. Для каждого кандидата нужно заново проверить участие.
Отсутствие кандидата в таком отчёте не доказывает отсутствие человека в группе.
MTProto и пользовательский аккаунт не использовались.

## Telegram

| Источник | Что доступно | Ограничение |
| --- | --- | --- |
| [getChatAdministrators](https://core.telegram.org/bots/api#getchatadministrators) | Администраторы | Это не состав группы |
| [getChatMemberCount](https://core.telegram.org/bots/api#getchatmembercount) | Счётчик | Нет идентификаторов участников |
| [getChatMember](https://core.telegram.org/bots/api#getchatmember) | Статус известного `user_id` | Для других пользователей гарантирован при статусе administrator у бота |
| [Update](https://core.telegram.org/bots/api#update) | `chat_member` сообщает изменения статуса | Нужны administrator и явная подписка; начального списка нет |
| [Message](https://core.telegram.org/bots/api#message) | `new_chat_members`, `left_chat_member` | События вступления/выхода, а не исходный состав |
| [Getting updates](https://core.telegram.org/bots/api#getting-updates) | Недоставленные updates | Telegram хранит их максимум 24 часа |
| [Bots FAQ](https://core.telegram.org/bots/faq#what-messages-will-my-bot-get) | Сообщения доступных ботам участников | Молчащих участников сообщения не перечисляют |

В Bot API нет метода истории произвольной группы. Метод
[getUserPersonalChatMessages](https://core.telegram.org/bots/api#getuserpersonalchatmessages)
относится к чату в профиле пользователя и не решает задачу состава группы.

## Что знает приложение

| Источник в исходном коде | Данные | Следствие |
| --- | --- | --- |
| [`telegram-webhook.ts`](../../src/modules/webhook/telegram-webhook.ts) | Подписка на `message`, `chat_member`, `my_chat_member`, `chat_join_request`, `callback_query` | Нужные события уже запрашиваются |
| [`grammy-update.adapter.ts`](../../src/adapters/telegram/grammy-update.adapter.ts) | Извлекает ID субъекта `chat_member`; личный `/start` создаёт контакт | Сообщения группы не создают реестр участников; отдельных обработчиков `new_chat_members` и `left_chat_member` нет |
| [`membership-evidence-provider.ts`](../../src/modules/membership-evidence/membership-evidence-provider.ts) | При отсутствии PlatformLink пишет `unlinked_subject` | Событие сохраняется в аудите, но не создаёт привязку |
| [`database.ts`](../../src/database/database.ts), `MembershipEventAuditTable` | Аудит содержит чат, статус, дату и update ID, но не Telegram ID субъекта | Прежние непривязанные участники из аудита не восстанавливаются |
| [`telegram-update-inbox.ts`](../../src/modules/update-inbox/telegram-update-inbox.ts) | После обработки или окончательной ошибки `payload = null` | Inbox не является архивом участников |
| [`bot-contacts.ts`](../../src/modules/bot-contacts/bot-contacts.ts) | ID после личного `/start` | Источник кандидатов, включая непривязанные контакты; принадлежность группе не доказана |
| [`platform-links.ts`](../../src/modules/identity-linking/platform-links.ts) | Подтверждённая привязка Telegram ID к Account | Источник привязанных кандидатов |
| [`community-storage.ts`](../../src/modules/community/community-storage.ts), `community_bindings` | ID известных связей сообщества | Дополнительные кандидаты; сама связь не доказывает текущее право |
| [`retention.ts`](../../src/database/retention.ts) | Контакты, привязки и membership audit не имеют периода удаления | Очистка raw payload всё равно исключает восстановление непривязанных ID |

Реестр прежних непривязанных участников не найден. Проверки source-групп выполняют
`getChatMember` для уже известного ID, а не перечисляют их:
[`source-group-proof.ts`](../../src/modules/subscription-activation/source-group-proof.ts).
История активации и оплаты не доказывает текущий полный состав группы.

## Проверка права

Platform уже предоставляет операторский
`GET /community-entitlements/members-without-right`:
[`community-delivery.controller.ts`](../../../backend/src/modules/telegram-membership/adapters/nest/community-delivery.controller.ts).
Операция требует входа Account и разрешения `platform:admin`.

[`listMembersWithoutRight`](../../../backend/src/modules/telegram-membership/facets/community-entitlements/community-entitlements.ts)
проверяет действующие права на момент запроса. Она рассматривает ограниченную выборку
Accounts с последним наблюдением сообщества. Поле `truncated` сообщает об ограничении.
Отсутствие Account в ответе не доказывает наличие права: для него могло не быть наблюдения.
`readDelivery` возвращает сохранённую проекцию, а не новую проверку действующего права.

Поэтому частичный отчёт должен показывать отдельно непривязанных участников,
подтверждённые совпадения из списка «без права», неизвестные права и ошибки Telegram.
Совпадение должно учитывать текущие Account и TelegramIdentity, чтобы не использовать
старую привязку после переноса.

## Варианты и рекомендация

1. Отчёт по известным ID. Не требует пользовательского аккаунта и разрешён поручением.
   Проверка участия делает его полезным, но прежние молчащие непривязанные участники могут отсутствовать.
2. Полный исходный список стабильных Telegram ID, предоставленный оператором.
   Перед импортом нужно подтвердить источник и полноту; имена и username недостаточны.
   Сам импорт и контракт источника пока не реализованы.
3. Новый реестр ID из будущих `chat_member`. Расширит покрытие после выпуска,
   но не восстановит прежний состав. В этом изменении не создаётся.

Рекомендация: поставить частичный отчёт с явными неизвестными и неполным покрытием.
Для полного исходного списка запросить источник у владельца отдельно.
Это не разрешает удаления, рассылки или операции Tribute.

Связанная [#859](https://github.com/sachkov-inside/platform/issues/859) изменилась
решением владельца 07.10.2026: оплаченный период Tribute больше не переносится;
сроки оплаты не следует использовать как автоматически выдаваемое право.
См. [комментарий решения](https://github.com/sachkov-inside/platform/issues/859#issuecomment-6039142464).
