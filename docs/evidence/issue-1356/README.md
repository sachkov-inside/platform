# Подготовка production-выпуска #1356

Срез подготовки 12 октября 2026 года. Задача: [#1356](https://github.com/sachkov-inside/platform/issues/1356),
общий запуск: [#854](https://github.com/sachkov-inside/platform/issues/854).
Этот пакет фиксирует проверку текущего production, восстановление и порядок следующего выпуска.
Фактические release SHA, digests, финальные проверки и публикация записываются в #1356 после выполнения.

## Исходное состояние

| Приложение | Production | Source SHA |
| --- | --- | --- |
| Platform | `v33` | `bc94bf2063efb8061e6f3f792e982bf33f27857b` |
| Telegram | `v15` | `02ea5bcba24ad1d8fde8f7acd797369236f008db` |

Read-only `production-verify` текущего Platform прошёл 61 проверку, exit 0.
У Telegram прошли 34 из 35 проверок: история журналов содержит один `telegram.membership` error
и один timeout `platform.evidence-delivery`. Readiness, образ и manifest совпали с `v15`.
После следующей выкладки нужен свежий `production-verify`; старые журналы не заменяют её результат.

На сайте действует политика v3; `/legal/privacy/v4` отвечает 404.
Единственное предложение production — «Подписка Inside», `published=false`.
Продажа AIE не настроена. У Telegram `TELEGRAM_MARKETING_ENABLED=false`.
`PRODUCT_TASK_SUBMISSIONS_ENABLED` не задан; production-конфигурация `v33` выбирает `false` по умолчанию.

## Бэкап и восстановление

[Квитанция](backup-restore.json) содержит выбранный label, точку backup, время восстановления и результат сверки.
Backup завершён `2026-10-12T12:18:39Z`; systemd unit и `pgbackrest check` прошли.
Штатный [isolated restore](../../../scripts/isolated-database-restore.py) восстановил выбранный backup
в новый volume с `--network none`, без портов, API, Logto, бота и workers.

Для проверки подготовлена локальная копия цепочки выбранного backup и WAL из того же repository.
2210 объектов, 349642544 bytes, скопированы через `repo-get --raw`, сохранив шифрование.
Режим raw соответствует [command reference pgBackRest](https://pgbackrest.org/command.html#command-repo-get).
В контейнер передан только ключ расшифрования; S3 credentials туда не передавались.

Сверка сравнила число строк и MD5 от отсортированных хешей JSONB каждой строки.
Live-инвентари перед backup и после backup совпали. Восстановленный инвентарь совпал с обоими:

| База | Проверенные таблицы | Расхождения |
| --- | --- | --- |
| `inside` | 121 | 0 |
| `logto` | 79 | 0 |
| `inside_telegram` | 60 | 0 |

Сверка охватывает таблицы аккаунтов, прав, материалов, прогресса, платежей и сдач.
Служебные таблицы schema `pgboss` исключены; снимок Object Storage этим восстановлением не проверялся.
Restore-container, PostgreSQL-container и временный volume удалены.
Копия repository и временный файл ключа удалены. Live volume и foundation-конфигурация не переключались.
После очистки API/MCP/Web прошли штатные readiness-команды.
Закрытые инвентари и raw logs сохранены вне Git:
`/Users/dev/Work/Artifacts/platform-1356-release-2026-10-12/restore-evidence/`.

Перед deploy backup должен быть моложе восьми часов. Если окно истекло, повторить backup и проверку восстановления.
Эта квитанция не переносится на другой backup label.

## Выпуск и восстановление после отказа

1. Зафиксировать текущий `origin/main` и точный принятый Content SHA/manifest из [#1355](https://github.com/sachkov-inside/platform/issues/1355).
2. На release SHA получить все квитанции [course preflight](../../runbooks/course-release-preflight.md), включая `check:full`, Compose shutdown и telemetry.
3. Выпустить очередные ordinal Platform и Telegram штатными workflows. На исходном срезе ожидаются `v34` и `v16`; окончательные номера проверяет release plan.
4. Скачать immutable manifests и runtime bundle. Подставить реальные image digests в preflight; до publication они не известны.
5. Перед deploy назвать оценку maintenance. Предыдущий Platform deploy занял 43 секунды maintenance.
   Следующий применяет `0086`, `0087`, `0088`: предварительная оценка 2–5 минут Platform и 1–2 минуты Telegram.
   Это оценка; pull выполняется до maintenance. Порядок и измерение задаёт [release runbook](../../runbooks/release.md).
6. Выложить Platform, затем Telegram. Проверить exact versions/digests/schema, readiness, доступ и опубликованные документы.
7. Опубликовать только отдельно разрешённый Content SHA/manifest. Продажа AIE остаётся выключенной.
8. После публикации v4 и проверки выпуска включить приём сдач отдельным шагом.

Platform меняет schema: 86 migrations текущего production становятся 89.
Откат приложения на `v33` после этих миграций не предлагается.
До maintenance отказ preflight/pull сохраняет текущие маршруты.
После maintenance сначала прочитать `operation.json`, затем повторить exact version или выпустить следующий ordinal
с исправлением (`repair forward`), как требует [production delivery](../../runbooks/production-delivery.md#deployment-order-and-state).
Миграции вниз не выполняются. Старое окно rollback `v33 → v32` истекло 10 октября.

При аварии данных восстановить выбранную актуальную точку backup/WAL в новый recovery volume по
[foundation runbook](../../runbooks/production-foundation.md#восстановление-базы).
Сверить данные до переключения. Старый volume сохранить; изолированная проверка этого пакета не переключает production.
У Telegram текущая и кандидатная миграционная идентичность совпадают:
`sha256:f91e56479cfcae72f9596dc508c776c5c06e156f16d747e4e91d956931ca533d`, 31 migration.
Откат Telegram следует его [production runbook](../../../apps/telegram/docs/operations/production.md).

## Политика v4 и материалы

Вариант А одобрен в [#991](https://github.com/sachkov-inside/platform/issues/991#issuecomment-6093765700).
Содержание принятого текста сохраняется; дата кандидата — 12 октября 2026 года.
`effectiveFrom=2026-10-12`, digest:
`efe67ec68fb394b9a83329dc4eed620289e9584ed1f2e3bc86083ecafee054f2`.
До публикации сверить фактическую дату и при необходимости обновить текст, `effectiveFrom` и digest вместе.
После publication проверить `/legal/privacy`, `/legal/privacy/v4`, прежний адрес v3 и записать результат также в #991.
Политика ещё не опубликована; приём сдач не включён.

Кандидат материалов в [#1355](https://github.com/sachkov-inside/platform/issues/1355#issuecomment-6123391813):
Content SHA `b94c9f9afaf920b0b2d67b8fbc78eb68d55d2f0d`, manifest SHA256
`d32b37c2ab8c972dab50bff78b0d779d06101271bc74863b6ae387a3e0e05131`.
Он ожидает принятия уроков. Этот SHA обозначает кандидата и не разрешает его публикацию.
Принятые описание и программа сохраняются; незавершённые главы 3–5 обозначаются «Планируется».
Публикация материалов, merge кода, deploy приложений и открытие продажи учитываются раздельно.
