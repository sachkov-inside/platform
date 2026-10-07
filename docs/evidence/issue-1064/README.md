# Issue #1064: проверка прежних назначений

Проверка выполнена 7 октября 2026 года, в 13:45:13 UTC, перед удалением текущего режима
подарка и активации по реестру Tribute. Источник — production PostgreSQL приложения Membership,
контейнер `inside-production-database-postgres-1`, база `inside`.

Все запросы выполнены внутри `BEGIN READ ONLY` с завершением `ROLLBACK`.
Персональные данные в этот документ не перенесены. Данные production не менялись.

| Проверка | Результат |
| --- | --- |
| Приглашения по каждому режиму | 0 записей во всех режимах; подарков нет |
| Назначения с `origin = 'course'`, включая снимок тарифа | 0 записей; прежних назначений всей платформы нет |
| Правила активации, включая режим проверки и тариф | 0 записей |

```sql
BEGIN READ ONLY;
SELECT now();
SELECT mode, count(*)
FROM membership_entitlements.invitations
GROUP BY mode;
SELECT id, account_id, tier_id, snapshot, source_ref, starts_at, ends_at, revoked_at
FROM membership_entitlements.subscription_enrollments
WHERE origin = 'course';
SELECT id, code, tier_id, tier_revision, source_ref, verification_mode, published
FROM membership_entitlements.activation_rules;
ROLLBACK;
```

## Решение в пределах задачи

Данные не требуют решения владельца о переносе подарков или прежнего доступа курса.
Исторические поля хранения и происхождения назначений остаются для совместимости чтения.
Новые команды не выпускают подарки и не активируют доступ по реестру Tribute.

Правило `COURSE` должно ссылаться на предложение курса: материалы курса без срока,
чат без срока и сопровождение на шесть месяцев от фактической активации.
Правило не создаётся этим изменением кода. Перед выпуском оператор проверяет его тариф
по [runbook активации курса](../../../apps/telegram/docs/operations/course-activation.md).
