# Удаление Мастерской: проверка production перед миграцией #1063

Проверка выполнена 07.10.2026 в 13:45:35 UTC через SSH из
[production foundation runbook](../runbooks/production-foundation.md#production-сервер).
Контейнер PostgreSQL: `inside-production-database-postgres-1`, база: `inside`.
Каждый запрос выполнялся внутри `BEGIN TRANSACTION READ ONLY` и завершался `ROLLBACK`.
Production не изменялся; запросы читали только имена таблиц и количество строк.

| Таблица в схеме `workshop` | Строк |
|---|---:|
| `entitlements` | 0 |
| `cases` | 0 |
| `case_versions` | 0 |
| `case_materials` | 0 |
| `hint_reveals` | 0 |
| `solution_reveals` | 0 |
| `membership_entitlement_projections` | 1 |

В `materials.materials`, `materials.published_materials` и `videos.videos`
строк с `access = 'workshop'` нет. Дополнительная проверка в 13:52:51 UTC подтвердила
ноль таких строк в `videos.upload_attempts`.

Владелец в этой сессии разрешил удалить одну производную проекцию вместе с таблицами.
Перенос материалов на другой доступ не требуется: таких материалов нет.

Миграция `0081_remove_workshop` удаляет таблицы при будущем применении.
Она отказывается удалять новые данные в шести таблицах бизнес-состояния.
Новые ограничения доступа отказываются принимать прежние значения `workshop` в материалах,
публичных проекциях, видео и попытках загрузки. Ошибка откатывает всю миграцию.
Миграции `0021`–`0024` остаются неизменными для проверки уже применённого ledger.

Права Мастерской больше не выдаются из Membership evidence. Словарь `platformPermissions`
уже содержит только `materials:manage`, `communications:manage`, `billing:manage` и
`platform:admin`; отдельного разрешения Мастерской в нём не было.

Authority решения: [ADR 0033](../adr/0033-product-tariff-payment-model.md).
Проверки миграции: `apps/backend/test/integration/remove-workshop-migration.test.ts`.
Проверки ленты и открытой информации о закрытых материалах:
`apps/backend/test/integration/home-feed-access.test.ts`.
