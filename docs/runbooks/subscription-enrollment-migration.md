# Локальная миграция тарифов #624

Миграция 0063 создаёт Enrollment, ActivationRule, ActivationAttempt, SourceEntitlement и
content_scope_baseline; добавляет scope к AccessGrant и legacy bridge. Не запускайте production
операции по этому runbook без отдельного разрешения владельца.

## До применения

Снимите backup выбранной локальной БД. Preview должен перечислить текущие неархивные Guide,
опубликованные Material, grants с materials, включённые legacy bridges и опубликованные
subscription offers. Baseline включает текущие неархивные Guide целиком, включая их будущие шаги,
и только уже опубликованные отдельные Material. Проверьте состав с владельцем перед внешним rollout.

```sql
SELECT id, name, slug, archived_at FROM materials.series WHERE archived_at IS NULL ORDER BY id;
SELECT id, title, slug FROM materials.materials WHERE publication_state = 'published' ORDER BY id;
SELECT source, count(*) FROM membership_entitlements.access_grants
 WHERE capabilities @> ARRAY['materials']::text[] GROUP BY source;
SELECT classification, bridge_enabled, count(*) FROM membership_entitlements.legacy_classifications
 GROUP BY classification, bridge_enabled;
SELECT id, name, published FROM billing.offers WHERE published AND EXISTS
 (SELECT 1 FROM billing.payment_options WHERE offer_id = billing.offers.id AND mode = 'subscription');
```

Scope допускает максимум 1000 Guide и 1000 Material. При превышении требуется отдельный rollout
с расширением поддерживаемых границ, а не усечение. Идентичности pending course sources передаются
через owner sources.register. Не выводите из presence в Telegram факт покупки или согласия.

## Применение и проверка

Используйте обычный локальный `pnpm --filter @inside/backend db:migrate` с конфигурацией выбранной
локальной БД. Shared Compose подчиняется singleton ownership; отдельные PostgreSQL tests используют
Testcontainers и не занимают owner runtime. Проверка ниже создаёт и удаляет собственные test databases:

```bash
pnpm --filter @inside/backend test:integration subscription-enrollments subscription-activation community-entitlements migrations --maxWorkers=2
pnpm --filter @inside/backend contracts:check
pnpm api:check
pnpm mcp:check
```

Подтверждённые subscription purchases переносятся в Enrollment по исходному purchase ID.
Срок начинается с earliest paid grant либо confirmed_at, если доставка ещё не дошла. Старые
сообщения связываются по purchase source; банковские snapshots и receipts остаются исходными.

Проверьте сохранность прежних grant IDs, capability lists, starts_at, valid_until и revoked_at.
Сравните purchases/consents/receipts с backup. Новый отдельный Guide должен быть закрыт для старого
baseline, новый шаг уже включённого Guide — открыт. Новые неплатёжные назначения не создают rows
в billing.purchases. Перед запуском real provider требуется его отдельная проверка v2.

## Откат

До реальных записей откат репетируется PostgreSQL transaction rollback с полной migration statement.
После новых назначений не удаляйте таблицы и receipts: это потеря прав и идемпотентности. Оставьте
additive schema, отключите activation credential/provider v2, остановите новые назначения и
исправляйте вперёд. Старое приложение с глобальным materials resolver нельзя возвращать поверх
новых отдельных продуктов: оно проигнорирует scope. Восстановление backup допустимо только в
изолированной локальной БД либо после отдельного согласованного плана сохранения новых записей.
