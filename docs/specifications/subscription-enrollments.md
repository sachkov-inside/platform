# Тарифы и права: Platform #624

Основание: Workspace #180 → Platform #624. Это локальная реализация Platform. Telegram #64 и
Platform #625 имеют отдельных владельцев; интеграции, merge и deploy этим документом не разрешены.

## Назначение и состав

Offer хранит независимые availableForAssignment, published и archived. SubscriptionEnrollment
фиксирует tier revision, benefits, contentScope, origin, sourceRef, startsAt/endsAt и endPolicy.
BillingSubscription остаётся расписанием платежей. Неплатёжное назначение никогда не создаёт
BillingPurchase или recurring consent. Интервал доступа: startsAt ≤ now < endsAt, NULL означает
открытый конец. Account UUID не является Telegram accountRef.

Course deduplication: SHA-256 от JSON ["course", policyRef, verifiedIdentityRef]. Ручное
подтверждение и self-service используют одну функцию. Первая успешная транзакция фиксирует
начало курса. Повтор не заменяет tier snapshot, дату начала или tombstone отзыва.
SourceEntitlement может оставаться без Account и без прав; ActivationAttempt хранит продолжение
после связывания. Published rule и текущая tier revision проверяются перед первой выдачей. Точный повтор evidence
возвращает сохранённый результат до изменяемых условий; изменение payload при том же evidenceRef
отклоняется. Этот путь доступен только отдельному credential source authority.

Назначение, grants, SourceEntitlement, access changes, attempt outcome и evidence receipt
записываются одной транзакцией. Catalog lock удерживает eligibility, Membership владеет
транзакцией изменения прав. Текущая Telegram binding защищена тем же advisory lock, который
использует владеющий ею trigger. Все owner mutations требуют billing:manage и operationId.

Состав — Guide UUID и Material UUID; capability guide:* относится к отдельной покупке и не
принимается как состав назначаемого тарифа. materials не открывает community/support/reviews.
Resource authorization фильтрует scope до определения Membership на всех ContentAccess paths.
Общий Material открывается любым подходящим включённым Guide или прямым Material scope.

Preview expansion фиксирует source revisions, target Enrollment IDs и полную новую версию.
Apply проверяет все revisions до записи, сохраняет старые benefits, индивидуальные сроки grants
и tombstones. Редактирование Offer не обновляет старые назначения. Расширение не является
операцией возврата денег или восстановления отзыва. Редакция состава не заменяет редакцию
платёжного источника. Новое платёжное назначение и все его benefit grants выдаются атомарно;
исторические отдельные сообщения сохраняют совместимость, сроки и tombstone назначения.

## Поверхности

Owner billing UI и тот же API/MCP поддерживают каталог, назначение, изменение срока, отзыв,
восстановление, историю, подтверждение источника до Account, публикацию/паузу правил и preview/apply расширения.
Владелец находит получателя по точной текущей подтверждённой Telegram identity и выбирает
показанный Account. Username и историческая отвязанная identity не используются; отсутствие и
неоднозначность связи не разрешают выбор. Lookup требует billing:manage и не кешируется HTTP.
Назначение курса повторно проверяет текущую связь под блокировкой до записи прав.

Редактор Offer сохраняет benefitPeriods при изменении названия или состава. Изменённая
редакция тарифа не подставляется в опубликованное правило автоматически: владелец явно
обновляет привязку с expectedRevision. Код активации и sourceRef правила неизменны.

Customer cabinet
показывает сохранённые назначения и текущие названия включённых позиций; исчезнувший материал
не удаляется из обещанного состава. Metadata читает Materials-owned ContentScopeCatalog:
чтение названия не разрешает body, asset, video или artifact.

Навигация кабинета читает назначения тем же hook, что и раздел: активные, будущие,
завершённые и отозванные назначения видны без BillingSubscription и без публичной продажи.
Enrollment changes объявляются соседним вкладкам того же браузера; customer и owner hooks
перечитывают данные каждого открытого получателя после назначения, отзыва и расширения. Другие устройства получают
актуальное состояние при новом запросе. UTC хранится в БД, даты формы отображаются по Москве.

## Переносимые контракты

- [subscription-activation-v1](../contracts/subscription-activation-v1/protocol.md): отдельный
  credential, bounded source proof, exact binding/rule and own-access.
- [community-v2](../contracts/community-v2/protocol.md): обязательный admissionRestriction,
  v2-only новые effects и dispatch target/digest внутри envelope billing-dispatch.v1.
- Исторический billing-v1 corpus неизменяем; v1 receipts остаются читаемыми.

Нет fallback с v2 на v1. Community provider включается только явным
TELEGRAM_COMMUNITY_CONTRACT_VERSION=inside.community-entitlement.v2; отдельный activation
credential не подменяет dispatch credential. До подтверждённого совпадающего результата
кабинет показывает checking. moderation/external_unknown не отзывают доступ к материалам.

## Миграция и границы

См. [локальный preview/backfill и rollback](../runbooks/subscription-enrollment-migration.md).
Миграция additive, не переписывает банковские receipts, purchases, consent или прежние даты.
Compatibility grants и legacy bridge получают неизменяемый baseline; поздняя доставка старого
payload не захватывает новый отдельный продукт. Новые назначения получают explicit scope.

Generic membership для Profile остаётся общим фактом наличия materials; body/media/artifact
обязательно требуют resource scope. Workshop сохраняет отдельный WorkshopEntitlement и не
становится частью нового тарифа. Notifications повторно проверяют доступ к конкретному Material;
публикация нового отдельного материала сама по себе не включает его в старые тарифы.

## Проверка

`pnpm check`, `pnpm test:integration`, `pnpm smoke:enrollments`, переносимые schema/fixtures и PostgreSQL activation HTTP
suite обязательны перед handoff. Browser/Storybook доказывают только локальный интерфейс.
Synthetic source/provider/bank doubles не доказывают реальное подтверждение курса, delivery в
Telegram, Tribute backfill или production rollout. Финальные SHA, команды воспроизведения,
проверки и ограничения фиксируются в PR implementation report.
