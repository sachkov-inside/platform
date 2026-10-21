# Аудит доменной модели Platform (2026-10-21)

Снимок расхождений между `GLOSSARY.md`, ADR и кодом перед моделированием домена. Документ
фиксирует состояние на коммите `a6fe48abd`; решения принимаются отдельно и попадают в словарь и
ADR. Пути к коду указаны от корня репозитория.

## Контексты в коде сейчас

| Смысловая область | Где живёт | Замечание |
|---|---|---|
| Контент: Material, Topic, Tag, Format, тело, обложки | `apps/backend/src/modules/materials` | вместе с Product |
| Продукт: Product, членство в каталоге, размещения в программе, главы, вложения, последовательности шагов, артефакты, страница | `materials` (таблица `materials.series`) | отдельного модуля продукта нет |
| Видео, файлы | `videos`, `assets` | границы чистые |
| Задания и сдачи | `product-tasks` | ещё есть `PracticeDefinition` в `materials` |
| Чтение, прогресс, закладки, режим прохождения | `reading-activity`, `bookmarks` | прогресс вычисляется |
| Витрина и чтение для читателя | `content-library` (без таблиц) | зависит от `billing` и `account-rights` |
| Тарифы, оплата, возвраты, поток, уведомления об оплате | `billing` | спящая подписка, живой Tribute |
| Права, назначения, приглашения, активация, отзыв продукта | `account-rights` | Tribute, legacy bridge, membership evidence |
| Решение о доступе | `content-access` (без таблиц, собирается в `materials`) | словарь портов ещё `Membership*` |
| Аккаунт, Billing Contact, юридические согласия | `accounts` | |
| Профиль | `member-profiles` | `publicProfileId` и модерация при «видно только владельцу» |
| Telegram-связь и сообщество | backend `telegram-membership` + `apps/telegram` (`community`, `identity-linking`, `membership-evidence`) | desired state хранится с обеих сторон |
| Бот: контакты, вход, активация, приглашения | `apps/telegram` | модуль `subscription-activation` ведёт активацию курса |
| Воронка, список ожидания, набор | backend `sales-funnel` + события бота | подтверждения ожидания с обеих сторон |
| Рассылки, цепочки, анонсы | `apps/telegram/communications` + backend `communications` (прокси) | «funnel» значит цепочку сообщений |
| Уведомления | backend `notifications` + `apps/telegram/notifications` | модель согласована |
| Мёртвое | `identity-principals` (пустой модуль), Мастерская (только миграции) | |

## Путь продажи в коде

1. Страница продукта: `content-library` читает состояние продажи из `billing` (тарифы, варианты
   оплаты, стадия `product_cohorts`); видимость тарифа фильтруется по Offer Eligibility из
   `account-rights`. Если продажи нет, предлагается список ожидания (`sales-funnel`).
2. Согласие с офертой: `accounts` пишет Legal Acceptance.
3. Котировка: `billing.price_quotes`, резерв промокода.
4. Покупка: `billing.purchases` (`kind=one_time`, `state=prepared→sent`), T-Bank Init.
5. Подтверждение: webhook T-Bank или сверка переводит покупку в `confirmed` и пишет по одной
   строке `fulfillment_outbox` на каждое право.
6. Права: воркер раз в 60 с применяет outbox в `account_rights.access_grants` (`source=paid`).
   **Назначение тарифа при оплате продукта не создаётся.**
7. Доступ: `content-access` спрашивает `account-rights`: `product:<id>` или `materials`, минус
   `product_access_exclusions`, плюс legacy bridge.
8. Сообщество: после связки Telegram `telegram-membership` проецирует право `community` и
   `ProductCommunity.groupRef` в desired state, бот выполняет вход.
9. Уведомления: `billing.notices` → RabbitMQ → `notifications` → email/Telegram.

Прежние участники идут другим путём: бот → `telegram-membership` → `billing.SubscriptionActivation`
→ `account-rights.activateSubscription`: SourceEntitlement + Tariff Assignment (`origin=course`) +
бессрочные права.

## Главные расхождения

### 1. Что человек «имеет» после покупки

Словарь называет один слой шестью именами: Tariff Assignment, AccessGrant, Direct Right, Lifetime
Access Grant, OneTimePurchase, Account Rights. Код: оплата создаёт только `access_grants`;
активация и решение владельца создают `tariff_assignments` + `access_grants`. В коде у назначения
есть происхождения `platform_payment` и `invitation`, а словарь называет назначение только
бесплатным. `AccessScope` типа не имеет: это строки возможностей и JSON `coverage`.

### 2. Подписка и Tribute

ADR 0037 убрал продажу подписок, но словарь сохраняет живые определения Invitation («единственный
допуск к подписочному варианту оплаты»), RenewalConsent, ScheduledChange, PaymentMethodBinding,
BillingNotice (вокруг подписки), BuyerClassification (про регулярные списания и Tribute). В коде
подписка спит (`subscriptionsAllowed=false`), эндпоинты отмены и смены зарегистрированы, режим
оплаты по умолчанию `subscription`. Tribute жив: webhook, ежеминутный sweep, происхождение
назначения `tribute`, допуск `former_tribute_subscribers`. В словаре Tribute не определён.

### 3. Продукт называется series

Таблица `materials.series`, колонки `series_id`, `ContentCollectionKind = product | series | topic`,
маршрут `authoring/playlists`, в web `Course*`. Членство в каталоге (`series_memberships`) и
размещение в программе (`product_programme_placements`) хранят главу, порядок и `stepGroup`
дважды; флаг `programmeExplicit` выбирает модель. Для членства в каталоге нет термина.

### 4. Поток и набор

Cohort живёт в `billing.product_cohorts`: одна изменяемая строка на продукт без собственной
идентичности. Product Intake живёт в `sales_funnel.product_waitlist_intakes` со стабильной
идентичностью. Воронка вдобавок называет когортой группу по периоду входа.

### 5. Сообщество

Две модели: старая (MembershipEvidence, Membership Signal, Canonical Membership Chat; открывает
доступ только через legacy bridge) и новая (CommunityEntitlement по группе продукта). Desired
state сообщества хранится и в backend, и в `apps/telegram`; корневой словарь называет его
CommunityDelivery, словарь Telegram называет CommunityEffect/CommunityDesiredState. Слово
Membership используется, но не определено.

### 6. Структура обучения

- Supplementary Material и ChapterAttachment описывают одну таблицу.
- Product Step Sequence в коде `stepGroup`.
- Material запрещает слово «урок», но словарь содержит Lesson Block, Lesson Difficulty, Lesson Outcomes.
- `PracticeDefinition` (критерии, привязанные к материалу) близок к Task Version и не описан.
- Format `guide` совпадает со старым именем продукта `Guide`.
- `Material.showInFeed` противоречит правилу «все открытые опубликованные материалы в ленте».

### 7. Аудитория и коммуникации

- `communication_funnels` в Telegram это цепочки сообщений, не Sales Funnel.
- Состояние подтверждения списка ожидания хранится с обеих сторон; путь владения идёт через
  `sales-funnel` и `communications`.
- Tracking hits есть и в backend, и в Telegram.
- Приглашение погашается в Telegram-модуле `subscription-activation`, хотя Invitation не ActivationRule.

### 8. Гигиена словаря

- Раздел Notifications написан по-русски.
- В определения попали детали реализации: `primaryVideoId`, `@inside/material-blocks`, `presentation`, тесты.
- Строка `Product Purchase` повторяется в таблице совместимости.
- Нет терминов для Promotion, PriceQuote, PaymentLink, ProductCommunity, ActivationAttempt, SignInRequest, Broadcast.
- В `web-telemetry` есть таблица `coverage`, которая совпадает по имени с Coverage тарифа.
