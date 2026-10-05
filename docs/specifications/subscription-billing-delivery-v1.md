# Поставка собственной подписки Inside

Текущий объём #407 уточнён в [модели подписки](../product/subscription-billing-v1.md)
и [плане руководств](../product/guides-delivery-plan.md) по решению Workspace #156.
Закрытые #404/#405 остаются историей; их расширение выполняется в #407 после #448.
Разовая продажа не входит в текущий DEMO; проверка guide-scoped прав использует контролируемую
ручную/API-выдачу. Эта foundation сама по себе не завершает пользовательский путь #411/#413/#414.

Статус: **история**; план к согласованию в Workspace #147, не принят в этом виде. Правила доступа —
[модель доступа](../product/access-model.md). Созданные задачи являются подготовленным
backlog; наличие карточки или `ready-for-agent` не означает отсутствия native blockers или
готовности рабочего терминала. Приоритет направления — Next.

[Продуктовая модель](../product/subscription-billing-v1.md) — источник коммерческих правил.
[Общий контракт](../contracts/subscription-access-v1.md) — заменённая граница приложений; правила
доступа — [модель доступа](../product/access-model.md).
Текущие live статусы, assignee/claim, PR и зависимости принадлежат GitHub; таблица ниже фиксирует
порядок поставки, а не копирует изменяемую доску.

## Начало работы

1. Принять общий контракт и этот порядок поставки в pull request задачи #147. Это не разрешение включить
   оплату или переносить аудиторию. Исследование #341 и правила #128 уже завершены.
2. Platform фиксирует локальную specification и wire schemas; Telegram принимает те же schemas
   в самостоятельный repository. После их review уточняются downstream acceptance и readiness.
3. После Platform contract независимы права доступа, предложения/скидки и контакт/согласия.
   Банковская настройка не блокирует эти локальные задачи. Право не заявляется реализованным
   только по contract fixtures.
4. Checkout и renewal объединяют эти возможности; далее административные операции, уведомления,
   пользовательский интерфейс и Telegram provider. Юридическая подготовка идёт одновременно.
5. Сквозная DEMO приёмка требует реального тестового банка и каналов. Production приёмка и
   открытие новых продаж требуют отдельного решения владельца.
6. Миграция Tribute сохраняет отдельный runbook и последующую разбивку на repo-owned tickets;
   широкий родитель не исполняется напрямую на реальных людях.

## Дерево задач

Общая поставка: [workspace #148](https://github.com/sachkov-inside/workspace/issues/148). Platform: [platform #401](https://github.com/sachkov-inside/platform/issues/401). Telegram: [inside-telegram #53](https://github.com/sachkov-inside/inside-telegram/issues/53).
Эти specifications связаны с человеческой целью Workspace #126; design map #127 остаётся открытой до завершения #147, Platform #403 и Telegram #54.
Контрактные задачи — её native children, реализация — дети delivery specifications.
Map не ждёт исполнения всех production работ и не закроется от одного merge #147.

| Шаг | Задача и результат | Нужные входы |
|---|---|---|
| [workspace #149](https://github.com/sachkov-inside/workspace/issues/149) | На сайте есть полный применимый юридический комплект, согласованный с реальным продавцом, продуктом и обработкой данных. | Подготовку можно начать сейчас; фактические настройки/тексты подтверждает владелец |
| [platform #402](https://github.com/sachkov-inside/platform/issues/402) | Известны пригодные настройки тестового и рабочего терминала, способы оплаты и параметры чеков; исполнитель понимает, что и где проверять. | Подготовку можно начать сейчас; фактические настройки/тексты подтверждает владелец |
| [platform #403](https://github.com/sachkov-inside/platform/issues/403) | Реализация Platform и Telegram опирается на точные интерфейсы, одинаковые примеры и проверяемые сценарии. | [workspace #147](https://github.com/sachkov-inside/workspace/issues/147) |
| [platform #404](https://github.com/sachkov-inside/platform/issues/404) | Материалы открываются по действующим основаниям Account; сбой/выход из Telegram не лишает оплаченного или бессрочного доступа. | [platform #403](https://github.com/sachkov-inside/platform/issues/403) |
| [platform #405](https://github.com/sachkov-inside/platform/issues/405) | Владелец задаёт предложения; покупатель получает серверную цену и узнаваемые сохранённые условия. | [platform #403](https://github.com/sachkov-inside/platform/issues/403) |
| [platform #406](https://github.com/sachkov-inside/platform/issues/406) | Вошедший через Telegram покупатель подтверждает адрес для чеков и уведомлений; принятые условия можно восстановить. | [platform #403](https://github.com/sachkov-inside/platform/issues/403) |
| [platform #407](https://github.com/sachkov-inside/platform/issues/407) | Оплата подписки восстанавливается без дублей; предложение и версия отделены от независимых прав, включая контролируемую выдачу права на руководство. One-off checkout исключён. | [platform #404](https://github.com/sachkov-inside/platform/issues/404), [platform #405](https://github.com/sachkov-inside/platform/issues/405), [platform #406](https://github.com/sachkov-inside/platform/issues/406) |
| [platform #408](https://github.com/sachkov-inside/platform/issues/408) | Покупатель управляет жизнью подписки без двойных списаний и потери оплаченного срока. | [platform #407](https://github.com/sachkov-inside/platform/issues/407) |
| [platform #409](https://github.com/sachkov-inside/platform/issues/409) | Владелец видит неопределённые операции и исправляет результат через проверенные действия, без правки базы. | [platform #408](https://github.com/sachkov-inside/platform/issues/408) |
| [inside-telegram #54](https://github.com/sachkov-inside/inside-telegram/issues/54) | Telegram получает однозначный provider contract, совместимый с Platform. | [platform #403](https://github.com/sachkov-inside/platform/issues/403) |
| [inside-telegram #55](https://github.com/sachkov-inside/inside-telegram/issues/55) | Оплаченный старший или ручной доступ позволяет войти в сообщество; окончание права прекращает участие. | [inside-telegram #54](https://github.com/sachkov-inside/inside-telegram/issues/54) |
| [inside-telegram #56](https://github.com/sachkov-inside/inside-telegram/issues/56) | Связанный участник получает сообщения о своей подписке как дополнительный к email канал. | [inside-telegram #54](https://github.com/sachkov-inside/inside-telegram/issues/54) |
| [platform #410](https://github.com/sachkov-inside/platform/issues/410) | Покупатель узнаёт об изменении подписки и предстоящем списании; ошибка доставки видна владельцу. | [platform #408](https://github.com/sachkov-inside/platform/issues/408), [platform #406](https://github.com/sachkov-inside/platform/issues/406), [inside-telegram #54](https://github.com/sachkov-inside/inside-telegram/issues/54) |
| [platform #411](https://github.com/sachkov-inside/platform/issues/411) | Покупатель выбирает вариант, видит точную сумму и управляет подпиской; владелец работает с платежами и правами через сайт. | [platform #409](https://github.com/sachkov-inside/platform/issues/409), [platform #410](https://github.com/sachkov-inside/platform/issues/410) |
| [platform #412](https://github.com/sachkov-inside/platform/issues/412) | Посетитель может без входа прочитать юридические условия; нужные ссылки и отдельные согласия доступны в соответствующих формах. | [workspace #149](https://github.com/sachkov-inside/workspace/issues/149) |
| [platform #413](https://github.com/sachkov-inside/platform/issues/413) | На разрешённом тестовом контуре доказан полный сценарий покупки и продления, а не только локальные тесты. | [platform #402](https://github.com/sachkov-inside/platform/issues/402), [platform #411](https://github.com/sachkov-inside/platform/issues/411), [platform #412](https://github.com/sachkov-inside/platform/issues/412), [inside-telegram #55](https://github.com/sachkov-inside/inside-telegram/issues/55), [inside-telegram #56](https://github.com/sachkov-inside/inside-telegram/issues/56), [platform #415](https://github.com/sachkov-inside/platform/issues/415) |
| [platform #414](https://github.com/sachkov-inside/platform/issues/414) | Новые покупатели могут безопасно оплатить Inside в рабочем окружении после отдельного разрешения владельца. | [platform #413](https://github.com/sachkov-inside/platform/issues/413) |
| [workspace #150](https://github.com/sachkov-inside/workspace/issues/150) | Старые участники сохраняют права и переходят на Inside без второго автосписания за уже оплаченный срок. | [workspace #147](https://github.com/sachkov-inside/workspace/issues/147) |
| [platform #415](https://github.com/sachkov-inside/platform/issues/415) | Изменение прав Account надёжно изменяет желаемое участие в сообществе и даёт владельцу видимый результат применения. | [platform #404](https://github.com/sachkov-inside/platform/issues/404), [inside-telegram #54](https://github.com/sachkov-inside/inside-telegram/issues/54) |

Задачи прикреплены native Parent/sub-issues; блокировка задаётся native dependencies.
Ссылки на specification не заменяют зависимости. Один writing worktree и один основной
исполнитель на задачу; соседние repositories не становятся runtime dependency.

## Четыре границы готовности

| Граница | Что достаточно | Что ещё не доказано |
|---|---|---|
| Реализация без банка | Принятый локальный contract, известные acceptance/inputs, нет открытых owner решений по её scope | Возможности терминала, живые чеки и доставка |
| DEMO | Все локальные slices, разрешённый тестовый терминал и настройки, corpus/failure injection плюс реальные test операции | Рабочий терминал и разрешение открыть продажи |
| Новые продажи | Production acceptance, юридические страницы и согласия, реальные каналы/касса, monitoring/recovery; безопасная классификация legacy и управление community | Полный перенос всех старых участников |
| Миграция и удаление bridge | Полнота источника, paid expiry, отсутствие старых будущих списаний, самостоятельные права, проверенное взаимодействие ботов | Не заменяется датой отключения или заявкой отмены |

Блокер миграции не автоматически блокирует всех новых покупателей. Однако unknown legacy статус
конкретного Account и непроверенное взаимодействие двух ботов должны быть разрешены до его
новых списаний/выдачи community. Эти проверки входят и в приёмку новых продаж.

## Согласования и проверяемые факты

- Магазин/терминал: рекомендация — выделить Inside отдельно; ответ владельца и условия банка ещё
  не подтверждены. Пока спецификация сохраняет изоляцию provider/terminal/customer references,
  а operational задача фиксирует окончательную конфигурацию.
- COF, смена привязки и касса: нужны текущие факты кабинета и разрешённая DEMO проверка. Карточный
  путь проверяется первым; СБП добавляется только после доказанного полного recurring lifecycle.
- Юридическая задача уточняет реального продавца, публичные реквизиты и контакты, вид договора,
  обработку/хранение данных, внешние сервисы и применимые обязанности. Неизвестные факты не
  подменяются шаблонными заверениями. Владелец согласует конечные тексты; спорная применимость
  выносится на квалифицированную проверку. Публикация требует отдельного разрешения.
- Реальные настройки/платежи/возвраты, сообщения, права и Tribute операции запрашивают конкретный
  scope разрешения непосредственно перед исполнением, с готовым планом и последствиями.
- Все merge, включая PR подготовки, остаются отдельным разрешением владельца по WORKFLOW.md.

## Покрытие принятой модели

| Требования #128 | Поставляющие задачи |
|---|---|
| Тарифы, месяцы, цены, акции/промокоды, сохранённые условия | [platform #405](https://github.com/sachkov-inside/platform/issues/405), [platform #411](https://github.com/sachkov-inside/platform/issues/411) |
| Входящий Account, verified email, согласия, checkout/return | [platform #406](https://github.com/sachkov-inside/platform/issues/406), [platform #407](https://github.com/sachkov-inside/platform/issues/407), [platform #411](https://github.com/sachkov-inside/platform/issues/411), [platform #412](https://github.com/sachkov-inside/platform/issues/412) |
| Платёж, подпись, сверка, dedupe, crash recovery и чек | [platform #407](https://github.com/sachkov-inside/platform/issues/407), [platform #402](https://github.com/sachkov-inside/platform/issues/402), [platform #413](https://github.com/sachkov-inside/platform/issues/413) |
| Календарь, recurring, cancel/resume, отказ без retry/grace | [platform #408](https://github.com/sachkov-inside/platform/issues/408), [platform #413](https://github.com/sachkov-inside/platform/issues/413) |
| Upgrade 1 250 ₽, downgrade, новая длительность, карта | [platform #408](https://github.com/sachkov-inside/platform/issues/408), [platform #411](https://github.com/sachkov-inside/platform/issues/411), [platform #413](https://github.com/sachkov-inside/platform/issues/413) |
| Ручные/бессрочные и batch права, права за курс | [platform #404](https://github.com/sachkov-inside/platform/issues/404), [platform #409](https://github.com/sachkov-inside/platform/issues/409), [platform #411](https://github.com/sachkov-inside/platform/issues/411) |
| Support, partial/full refund, решение об access, история/MCP | [platform #409](https://github.com/sachkov-inside/platform/issues/409), [platform #411](https://github.com/sachkov-inside/platform/issues/411), [platform #413](https://github.com/sachkov-inside/platform/issues/413) |
| Email + Telegram, напоминание за три дня | [platform #406](https://github.com/sachkov-inside/platform/issues/406), [platform #410](https://github.com/sachkov-inside/platform/issues/410), [inside-telegram #56](https://github.com/sachkov-inside/inside-telegram/issues/56), [platform #413](https://github.com/sachkov-inside/platform/issues/413) |
| Community, identity, async применение и сверка | [inside-telegram #54](https://github.com/sachkov-inside/inside-telegram/issues/54), [inside-telegram #55](https://github.com/sachkov-inside/inside-telegram/issues/55), [platform #415](https://github.com/sachkov-inside/platform/issues/415), [platform #404](https://github.com/sachkov-inside/platform/issues/404), [platform #413](https://github.com/sachkov-inside/platform/issues/413) |
| Публичные документы, футер, реквизиты и нужные формы | [workspace #149](https://github.com/sachkov-inside/workspace/issues/149), [platform #412](https://github.com/sachkov-inside/platform/issues/412), [platform #414](https://github.com/sachkov-inside/platform/issues/414) |
| Старые сроки, отсутствие двойных списаний, удаление bridge | [workspace #150](https://github.com/sachkov-inside/workspace/issues/150), [platform #404](https://github.com/sachkov-inside/platform/issues/404), [platform #414](https://github.com/sachkov-inside/platform/issues/414) |

Аналитика [Platform #337](https://github.com/sachkov-inside/platform/issues/337) остаётся Later.
Закрытые #128/#341 дают вход для исследования её event contract; финальные lifecycle source/schema
должны быть сверены с локальной billing specification. Она не блокирует оплату и не считает
manual grant/Telegram join доказательством выручки.

## Проверка подготовки

#147 проверяет полноту требований, ссылки, native hierarchy/dependencies и отсутствие циклов,
актуальность исходных issues/PR и bounded diff документов. Standards и Spec reviews используют
один фиксированный base Workspace `3acdb1a2e7f6286afcd63663a9e9804bae8331fa`.

Application code, реальные настройки банка/кассы, контактные данные, пользовательские сообщения,
выдача прав, миграция и production в подготовку не входят. Принятие плана не утверждает новую
архитектуру хранения/transport за owning repositories и не считается bank/legal launch proof.

## Расширение Notifications от 2026-09-08

[План общей системы](notifications-delivery-v1.md) добавляет RabbitMQ, Notifications и первый
сценарий нового материала. Telegram #54 включает новый corpus из Platform #434 наряду с
неизменённым community corpus #403. Platform #410 и Telegram #56 используют общий контракт,
а не прежний billing-only sender. Их native dependencies включают новые необходимые шаги.
