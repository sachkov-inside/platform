# Эксплуатация активации курса и community v2

Этот runbook не разрешает реальные выдачи, изменение Telegram, запуск или merge.
Локальные проверки используют два приложения, отдельные PostgreSQL и synthetic Telegram authority.
Факты Tribute и полномочия реальных ботов требуют отдельного подтверждения владельца.

Текущий срок сопровождения курса определяет [решение от 23.10.2026](../../../../docs/product/access-model.md#единая-выдача-доступа-решение-владельца-23102026).
Три календарных месяца сопровождения начинаются с фактической бесплатной выдачи Product Access.
Право бессрочное. Сохранённые прежние receipts и финансовые факты не переписываются.

## Настройка

| Параметр Telegram | Назначение |
| --- | --- |
| `TELEGRAM_ACTIVATION_ENABLED` | По умолчанию false; включает durable worker и private course ingress |
| `PLATFORM_ACTIVATION_URL` | HTTPS base `/integrations/telegram/v1/course-activation`; loopback HTTP разрешён локально. Порядок перехода старого URL и сохранения receipts задаёт общий portable protocol |
| `PLATFORM_ACTIVATION_SECRET` | Отдельный activation credential; совпадает с Platform ingress credential |
| `PLATFORM_ACCOUNT_URL` | Обычный browser Account URL, без токенов, query или fragment |
| `TELEGRAM_ACTIVATION_SOURCES` | JSON registry: sourceRef, chatId, policy; для confirmed_list — confirmedIdentityRefs |
| `TELEGRAM_COMMUNITY_CONTRACT_VERSION` | Явный `inside.community-entitlement.v2` на обеих сторонах; другое значение или его отсутствие при настроенном сообществе — отказ при старте |
| `TELEGRAM_COMMUNITY_REMOVALS_ENABLED` | `true` в production по решению владельца 04.10.2026 (platform#907): бот Inside исключает человека, когда Platform присылает `denied`. При `false` бот никого не исключает |
| `TELEGRAM_COMMUNITY_TRIBUTE_BOT_ID` | Удалённая настройка. Непустое значение останавливает запуск; удалите переменную |
| `TELEGRAM_COMMUNITY_READMISSION_TEXT` | Необязательный текст личного сообщения со ссылкой для возвращения |
| `TELEGRAM_COMMUNITY_WELCOME_TEXT` | Необязательный текст приветствия со ссылкой после первого права на сообщество ([интеграция](../integrations/community-entitlements-v1.md#приветствие-после-первого-права)) |

Остальные настройки и пары секретов с Platform — в [production.md](production.md#конфигурация).
Source chat identifiers, id ботов и списки identity находятся только в защищённой конфигурации,
не в Git или отчёте PR.

Перед включением: принятые версии обоих приложений, миграции, проверенный versioned corpus,
отдельные credentials, source policy владельца и проверенные права бота-администратора. Canonical
чат не меняется. Условия курса, scope тарифа и публичная продажа остаются решениями Platform/владельца.

## Подтверждение статуса прежних участников

Прежний покупатель курса получает права через бота только по ссылке
владельца `/start a_<code>` ([#115](https://github.com/sachkov-inside/inside-telegram/issues/115),
уточнение [#113](https://github.com/sachkov-inside/inside-telegram/issues/113), спецификация
[Workspace #238](https://github.com/sachkov-inside/workspace/issues/238)). Бот только доказывает
основание и передаёт его Platform по [протоколу активации](../integrations/subscription-activation-v1.md);
какие права выдать, решает правило активации на Platform.

**Обычный `/start`.** При включённой активации бот читает связь Telegram с аккаунтом и текущие
права Platform, чтобы показать меню и продукты ученика. Он не начинает активацию, не проверяет
основание прежней покупки и не создаёт запись в очереди разбора. Входы с метками воронок
сохраняют свои сценарии. Решение владельца от 27.09.2026 (#115) запрещает автоматическую проверку
основания при каждом `/start`, чтобы новые читатели бесплатной главы не засоряли очередь.

**Ссылка владельца `/start a_<code>`.** Проверяется выбранное правило: членство в группе прежнего
курса (`course_membership`). Правило указывает Product напрямую. Подтверждение выдаёт один бессрочный Product Access,
сопровождение обещано на три календарных месяца с первой фактической выдачи. Без привязки бот ведёт ко входу
на платформу и продолжает после связывания. Итог:

- основание подтверждено — карточка курса с кнопкой «Открыть курс». Кнопка «Вступить в группу»
  появляется при действующем праве и настроенной связи продукта с группой. Она выдаёт личную ссылку
  по Community Entitlement; участник группы получает кнопку «Открыть группу». Повтор не выдаёт права
  второй раз и не создаёт вторую попытку;
- основание проверено и не подтверждено (`rejected`, `pending_review`, `source_not_confirmed`,
  `identity_conflict`) — ответ по правилу ссылки с дальнейшим шагом и запись в очереди разбора
  владельца. Ручной отзыв права требует явного восстановления владельцем;
- любой другой отказ Platform (`not_found`, `policy_paused`, `revision_conflict` и прочие) — вопрос
  настройки правил владельца: человек получает текст отказа, записи в очереди нет.

**Ответ ученику.** Если аккаунт уже связан, ссылка сразу запускает проверку выбранного ученика.
Бот не отправляет отдельное сообщение о планировании. После подтверждения он показывает курс
и действия по текущим правам Platform. Без связанного аккаунта бот ведёт на платформу, сохраняя
выбранный продукт. После связывания бот автоматически обновляет карточку; отдельная кнопка проверки
для продолжения не нужна. При сбое ученик получает сообщение о недоступной проверке и действие
для повтора, а не ложное подтверждение доступа. Фоновое восстановление сохраняется. Фоновая
проверка без запроса человека молчит о временном сбое, например во время перезапуска Platform:
сообщение о сбое получает только тот, кто сейчас сам запустил проверку. Окончательный результат
фоновая проверка присылает как прежде.

Each new activation or retry command receives a result even when Platform repeats a saved
confirmation. Reply deduplication includes the command's Telegram update ID; replaying that same
update or recovering a worker does not duplicate the reply. A repeated start of an activation that
still waits for an Account gets the account prompt again; a background check never repeats it. A retry during a leased background
check preserves the lease and evidence; the running worker answers the latest processed request.

Ссылка перезапускает только своё правило, остальные проверки человека не трогает. Человек с уже
подтверждённым основанием не попадает в очередь из-за другого, неподтверждённого кода. Время
подтверждения хранится у попытки отдельно (`confirmed_at`): повторная проверка или сбой Platform его не
стирают, подтверждённая попытка не удаляется по сроку хранения, а её незавершённый повтор после срока
возвращается в подтверждённое состояние. Выход из группы после выдачи ничего не отзывает — бот не
наблюдает группу курса после проверки. Ссылку можно публиковать в общем чате: `/start` работает только
в личном чате, а общий чат остаётся запрещённым источником основания — реестр источников его не
принимает, и бот никогда не проверяет членство в нём.

Известное ограничение: проверка по ссылке, которая 30 дней подряд остаётся в `retry` (Platform или
Telegram недоступны) или в `needs_account` (Account не связан), удаляется по сроку хранения без ответа и
без записи в очереди; неопределённая запись evidence не удаляется, пока не будет повторена. Рост виден по
метрикам `activation_pending` и `activation_oldest_pending_seconds` из раздела «Наблюдение и остановка»;
новое нажатие кнопки запускает проверку заново.

### Кнопка владельца в группе курса

Владелец передаёт агенту точный текст и конкретный private chat id для личного сообщения.
Операция добавляет одну кнопку «Получить доступ» со ссылкой `https://t.me/<bot>?start=a_<code>`.
Агент отправляет только разрешённый личный образец. Владелец пересылает и закрепляет сообщение в группе.
Операция не публикует сообщения в группах и не редактирует текст владельца.

Команда принимает JSON через stdin с полями `operationId`, `privateChatId`, `sourceRef`, `productId`,
`code`, `text`. Файл содержит личный адрес: храните его вне Git с доступом только владельцу.
`sourceRef` должен присутствовать в `TELEGRAM_ACTIVATION_SOURCES` с политикой `whole_group`.
Platform через authenticated `course-activation/announcement` проверяет опубликованное действующее
правило, актуальную ревизию Offer и единственный Product. Несовпадение source или Product вызывает отказ.
Telegram `getChat` подтверждает тип `private`; отрицательные group id и username не принимаются.

Сначала `--preview` возвращает JSON с точным текстом и кнопкой без отправки. Затем `--send` отправляет
один личный образец. Оба режима требуют настроенные Platform, Telegram и `DATABASE_URL`.
На production из runtime-образа:

```bash
"${telegram_compose[@]}" --profile operations run --rm -T activation-announcement --preview < /protected/announcement.json
"${telegram_compose[@]}" --profile operations run --rm -T activation-announcement --send < /protected/announcement.json
```

В checkout разработчика — `pnpm owner:activation-announcement --preview < /protected/announcement.json`.
Вывод не содержит private chat id или credentials. `sent` означает личную доставку; `not_sent` с
`providerErrorCode` означает отказ Telegram; `unknown` означает неизвестный результат.
Все итоги, кроме `ready` и `sent`, завершаются с кодом 2; ошибка входных данных или инфраструктуры — с кодом 1.

Перед сетевой отправкой база атомарно сохраняет `operationId` и отпечаток сообщения, получателя и ссылки.
Повтор той же операции или того же сообщения запрещён даже после потери ответа, сбоя процесса или отказа.
Не удаляйте запись и не меняйте идентификатор ради повторной отправки. Проверьте личный чат и выясните
результат с владельцем; новая доставка требует отдельного решения и нового конкретного содержания.
`--preview` ничего не резервирует и остаётся доступным после отправки.

После личной доставки проверьте реальную пересылку: кнопка должна сохранить URL нужного Product.
До такой проверки модульные тесты не доказывают, что выбранная операция Telegram сохраняет кнопку.
Если кнопка пропадает, зафиксируйте препятствие; не заменяйте пересылку автоматической публикацией в группу.

**Очередь разбора.** Одна запись на человека: Telegram user id, opaque identityRef, accountRef,
итог по коду и время. Новый неподтверждённый итог по ссылке обновляет запись, подтверждённое основание
закрывает её автоматически. Решение владельца — Direct Right через owner-операции Platform; после него
запись закрывается командой. Новый неподтверждённый итог по ссылке открывает закрытую запись заново.
На production из runtime-образа:

```bash
"${telegram_compose[@]}" --profile operations run --rm -T activation-review --list
"${telegram_compose[@]}" --profile operations run --rm -T activation-review --resolve <reviewId>
```

В checkout разработчика — `pnpm owner:activation-review --list` и `--resolve <reviewId>` с
`DATABASE_URL`. `--list` печатает открытые записи по одной JSON-строке только оператору; не копируйте
их в issue, PR или журналы. `--resolve` отвечает `{"status":"resolved"}` или `not_found` с кодом 2.

Включение: коды должны быть опубликованными правилами Platform; включение активации в production —
шаг 10 [совместной выкладки](production.md#совместная-выкладка-с-platform) и решение владельца, как и
отправка сообщения с кнопкой. Проверка: `test/integration/owner-link-activation.integration.test.ts` —
обычный `/start` без запуска активации, кнопка ведёт к правам и приглашению, участник вне группы получает ответ
и одну запись в очереди, повтор без дубликатов, общий чат, реестр Tribute, приостановленные и
неизвестные правила; `test/unit/activation-announcement.test.ts` — текст, кнопка, ссылка и отказы.

## Два бота в общей группе

Распознавание новых удалений ботом Tribute удалено по
[спецификации #1693](https://github.com/sachkov-inside/platform/issues/1693).
`TELEGRAM_COMMUNITY_TRIBUTE_BOT_ID` больше не задаётся. Непустое значение отклоняется
при запуске, чтобы прежняя конфигурация не создавала ложного доверия к внешнему боту.

Новые события `chat_member` продолжают обрабатываться. Удаление человеком-модератором
сохраняет `moderation`; удаление внешним ботом, включая прежний Tribute, получает
`external_unknown`. Бан без известного автора тоже остаётся запрещённым для
автоматического снятия. Новое право Product или активация Course эти запреты не снимают.
Владелец разбирает их через `community-restriction restore`.

Сохранённые подтверждённые исторические `bot_expiry` и `tribute_expiry`, receipts и
аудит остаются. При действующем праве и точной текущей привязке бот может безопасно
снять такой бан и выдать ссылку. Сохранённый запрос возвращения получает одно личное
сообщение при доступном BotContact; повторная сверка не создаёт второе сообщение.
Неизвестный исход чтения членства не считается отсутствием участника. Обычный выход
из группы не создаёт новый исторический запрос возвращения.

Проверка на synthetic Telegram и настоящей PostgreSQL:
`test/integration/community-v2.integration.test.ts`, блок
«historical removal recovery and retired live recognition».

## Разбор ограничений и неизвестного исхода

Сначала прочитать текущие desired state, revision, attempt outcomes и ограничения через локальные
операторские средства. Не изменять таблицы вручную для повторения Telegram эффекта. При `unknown`
дать reconciliation проверить фактический roster; неизвестную ссылку не создавать заново до expiry.

Для hold/restore подготовить JSON с `operationId` (UUID v4), `botIdentity`, opaque `accountRef`,
`identityRef`, `expectedRevision`, `action`, `actorRef`, `reason`. Не передавать реальные данные в
командной строке или логах. Передать файл через stdin.

На production — из runtime-образа, в котором нет pnpm (`telegram_compose` — из
[production.md](production.md#команды-оператора-на-текущей-версии)):

```bash
"${telegram_compose[@]}" --profile operations run --rm -T community-restriction --preview < decision.json
"${telegram_compose[@]}" --profile operations run --rm -T community-restriction --apply < decision.json
```

В checkout разработчика с `DATABASE_URL` в `.env`:

```bash
pnpm owner:community-restriction --preview < decision.json
pnpm owner:community-restriction --apply < decision.json
```

Вывод — только `{"status": ...}`: `ready`, `applied`, `duplicate`, `conflict` (код 2). Неверное
решение или отсутствие состояния — код 1 без references.

Apply выполняет только отдельно разрешённое решение владельца. Между preview/apply изменение
revision возвращает conflict: прочитать новое состояние и заново согласовать решение. Повтор
того же operationId/payload возвращает duplicate; изменение payload конфликтует.
Restore снимает admission hold, но не создаёт entitlement: допуск всё равно требует актуального
права Platform и свежего dispatch permit. Purchase/start никогда не вызывает эту команду.

Журнал `community_restriction_decisions` сохраняет actor, причину, operationId и время вместе
с versioned `audit`: opaque target/binding, action, expected/applied restriction revision,
restriction/removal/confirmed-ban/status до и после, исходную community operation, её contract version,
entitlement revision и correlationRef. Эти сведения читаются под блокировкой Account и записываются
в одной транзакции с решением; последующий hold, новая проекция или duplicate/conflict их не меняют.
Community contract не передаёт course/payment sourceRef: журнал связывает решение с доступной
community operation/correlation, не угадывая источник выдачи Platform. CLI по-прежнему выводит
только статус, без references и содержимого журнала.

Миграция `021` сохраняет старые replay receipts с `audit = null`: их недостающий target/before-after
нельзя восстановить из fingerprint или текущей проекции. Новые решения фиксируют `audit.version = 1`.


## Наблюдение и остановка

Метрики `activation_pending`, `activation_oldest_pending_seconds`, `community_due`,
`community_oldest_due_seconds`, `community_effect_backlog`, `community_effects_unknown`,
`community_admission_restricted` публикуются существующим redacted metrics endpoint.
Рост возраста сверх двух циклов требует проверки связности/credentials/provider; `needs_account`
может ожидать пользователя, а restriction требует оператора. Не выводить source payload, токены,
chat identifiers или identity в логи. Счётчик unknown не доказывает ошибку или успех Telegram.

Остановка: выключить activation flag для новых/фоновых course проверок; выключить removals для
автоматических исключений; при полном останове community отключить live mode. Durable attempts,
Enrollment, receipts и уже выданные права сохраняются. Не откатывать новые v2 команды на v1 и
не удалять БД. После восстановления тех же версий/credentials worker продолжает leases и exact
uncertain retries. Backup/restore выполнять штатными средствами обеих отдельных баз; перед
возобновлением проверить ограничения и неизвестные эффекты. Это не включает recurring payments.

## Локальная проверка

`pnpm check:full` использует настоящую Telegram PostgreSQL, portable corpus и сценарии потери
ответов/lease/identity/moderation. `pnpm proof:course:provider` запускает обычный AppModule с
заменой только внешнего Telegram. Процесс требует literal synthetic token, loopback адреса и
отдельную тестовую базу. `/proof/source` управляет synthetic source/roster; `/proof/state` читает
только synthetic исходящие сообщения и эффекты. Само право выдаётся реальной Platform по HTTP.

Platform запускается своей принятой версией, со своей БД и локальным Logto. Настроить linking,
sign-in, activation, community v2 и dispatch; запустить API, Web и billing worker. Использовать
локальный email sink/Logto и synthetic owner bootstrap. Владелец создаёт тариф и правило через
обычный UI; consumer не импортирует Platform source, не пишет в её БД и не подставляет binding.
Проверить новый и существующий Account в desktop/mobile browser, bot-provided Account URL,
долговечное продолжение после linking, кабинет/чтение, own-access, личный join request и отказ
чужой ссылке. Browser runner также проверяет focus/Enter входа, WCAG critical/serious в кабинете,
отсутствие горизонтального переполнения и moderation в боте/кабинете после повторного start. Остановить только созданные для проверки процессы/контейнеры, сохранив артефакты.

Воспроизводимые browser commands для отдельного loopback стенда:

```bash
pnpm exec playwright install chromium
COURSE_PROOF_USER=6400101 COURSE_PROOF_OUTPUT=/tmp/course-proof-desktop pnpm proof:course:browser
COURSE_PROOF_USER=6400102 COURSE_PROOF_OUTPUT=/tmp/course-proof-mobile COURSE_PROOF_MOBILE=true pnpm proof:course:browser
COURSE_PROOF_USER=6400103 COURSE_PROOF_OUTPUT=/tmp/course-proof-nonmember COURSE_PROOF_SOURCE=left pnpm proof:course:browser
COURSE_PROOF_USER=6400104 COURSE_PROOF_OUTPUT=/tmp/course-proof-existing pnpm proof:course:existing
```

Каждый новый прогон использует новый synthetic user. Адреса намеренно фиксированы: Platform Web
3600/API 3601, Telegram 3606, локальный Logto `identity.inside.localhost:3631`, Mailpit 3625/SMTP
3626, локальный банковский двойник 38090. Они не являются адресами production. Browser runner
требует published rule `course64`, source `course64`, owner-created tier «Курс 64 · локальная
практика» с правом `product:<id>` seeded product `platform-inside`, правом `community` без срока
и `support` на 6 месяцев. Материал `developer-pipeline-bez-poteri-konteksta` входит в этот продукт.
Тариф назначается за курс без даты окончания; срок поддержки отсчитывается от активации.

Для `proof:course:existing` дополнительно включить штатный Platform `TBANK_PROVIDER_MODE=test`,
его loopback API/notification/return URLs и локальный billing-contact SMTP. Seeded разовая покупка
руководства должна быть доступна. Runner создаёт email Account через Logto, подтверждает email
для чека в Mailpit, проводит покупку через локальный hosted bank double, сохраняет отметку чтения,
затем связывает курс через BFF. Сравниваются прежние paid grounds, notices, профиль и progress;
добавленное course основание ожидаемо отличается. Ни фиктивный Account, ни готовый grant в БД
не подставляются. Артефакты остаются за пределами Git; отчёт публикует только отобранные synthetic
скриншоты и результаты без auth cookies и токенов.


## Прежние источники и сохранённые данные

Tribute ingress, реестр выдачи, личные invitations на подписку и entitlement bridge удалены.
Ни флаг, ни скрытый endpoint не включают их. Технические таблицы и исторические receipts
сохранены для проверки происхождения. Их чтение не создаёт новую выдачу или банковскую операцию.

Правило Course Activation выбирает Product. Отдельный Activation Source подтверждает прохождение
курса. Общая группа и владение кодом ссылки не заменяют это подтверждение. Неизвестное основание
остаётся запросом владельцу. Для старых subscription-activation receipts действует общий
[порядок перехода и удаления контракта](../../../../docs/contracts/subscription-activation-v1/protocol.md#ordered-rollout-and-removal-gate).

Идентификатор прежнего бота в community наблюдениях служит только происхождением исключения,
чтобы отличать его от модерации. Допуск проверяется по текущему Product Access Platform,
а событие прежнего бота не создаёт и не восстанавливает право.
