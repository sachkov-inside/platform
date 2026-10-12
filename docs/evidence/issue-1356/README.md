# Production-выпуск #1356

Выпуск 12 октября 2026 года: [#1356](https://github.com/sachkov-inside/platform/issues/1356),
часть запуска [#854](https://github.com/sachkov-inside/platform/issues/854).
Приложения, публикация контента и включение сдач выполняются раздельно. Продажи AIE выключены.

## Приложения

| Приложение | Версия | Publication | Deploy |
| --- | --- | --- | --- |
| Platform | `v34` | [38270696337, attempt 2](https://github.com/sachkov-inside/platform/actions/runs/38270696337/attempts/2) | [38274209283](https://github.com/sachkov-inside/platform/actions/runs/38274209283) |
| Telegram | `v16` | [38270703787](https://github.com/sachkov-inside/platform/actions/runs/38270703787) | [38274715173](https://github.com/sachkov-inside/platform/actions/runs/38274715173) |

Оба приложения используют source `bdae0c8284fe284569453183a40d567c2b099ec4`.
До выпуска на этом SHA прошли `pnpm check:full` (включает `check`), guarded Compose smoke с shutdown,
две оси независимого review без находок, обязательный
[merge-group CI](https://github.com/sachkov-inside/platform/actions/runs/38263369294) и
[nightly full-stack](https://github.com/sachkov-inside/platform/actions/runs/38266534513).
Nightly завершился: 172 passed, 4 skipped. Исторические #1304 и проверки #1335/#1338
не блокировали выпуск: обязательные пути на release SHA прошли. Проверки связаны с этим SHA;
они не объявляются проверкой любого последующего `main`.

Перед deploy названы оценки: 2–5 минут Platform и 1–2 минуты Telegram.
Platform maintenance занял 55 секунд. Вся операция Telegram заняла 26 секунд;
отдельный замер недоступности gateway не сохраняет.
Read-only `production:verify` после deploy: Platform — 61 passed, 0 failed, 0 not checked;
Telegram — 39 passed, 0 failed, 2 not checked. У Telegram optional cohort не настроен,
отдельное Logto test application не выбрано. Bot identity и существующий webhook проверены.

Точные image digests, schema identity, версии, время и результаты живых проверок записаны
в [квитанции выпуска](production-release.json). Она различает source приложения и source проверяющего кода.
Срез исходного production перед выпуском: Platform `v33`, Telegram `v15`.
Первый publication attempt Platform остановился на ECR 429 до build; второй прошёл.
Первый CI attempt тестовой правки также остановился на ECR до тестов; повтор failed jobs прошёл.
Причина отслеживается в [#1324](https://github.com/sachkov-inside/platform/issues/1324#issuecomment-6127692847).

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

## Политика v4

Владелец одобрил вариант А в [#991](https://github.com/sachkov-inside/platform/issues/991#issuecomment-6093765700).
Редакция опубликована в Platform `v34`: `effectiveFrom=2026-10-12`, digest
`efe67ec68fb394b9a83329dc4eed620289e9584ed1f2e3bc86083ecafee054f2`.
Полный видимый текст `/legal/privacy` и `/legal/privacy/v4` совпал с принятым `@inside/legal`.
Архив `/legal/privacy/v3` отвечает 200; полный текст и digest v3 сохранены.
[Фактическая публикация записана в #991](https://github.com/sachkov-inside/platform/issues/991#issuecomment-6127961851).
Статус редакций ведёт [legal README](../../legal/README.md); тексты опубликованных редакций не меняются.

## Принятый контент

Владелец [принял конкретный production-пакет](https://github.com/sachkov-inside/platform/issues/1356#issuecomment-6126965527)
из Content `2f04e11848b9cc281d67a7b34e51dd83b7370418`, manifest SHA256
`4fe936c220af33ca7d818b9ce7db38944bf83228aab26437694eab15fb4b7ac1`.
[Приёмка связана с #1355](https://github.com/sachkov-inside/platform/issues/1355#issuecomment-6126915200).
Пакет содержит 28 материалов, 133 исходных изображения и восемь заданий.
Глава 1 и два задания бесплатны; остальные 18 материалов и шесть заданий закрыты.
Все восемь заданий выбраны для публикации. Главы 3–5 остаются пустыми и показывают «Планируется».
Принятое описание: старт 9 ноября 2026 года, Europe/Moscow; материалы и общий чат без срока,
сопровождение шесть месяцев без SLA. Автор не проверяет код ученика.

Публикация завершилась `2026-10-12T17:17:13Z` штатным `authoring:release apply`.
После таймаутов результат проверялся на сервере; повтор использовал прежние ключи.
Предпросмотр обновлялся только для того же принятого manifest после собственных завершённых записей.
Все 144 записи изображений готовы: 136 загрузок материалов и восемь загрузок страниц заданий.
133 — число уникальных исходных PNG; повторное использование изображения создаёт отдельную запись загрузки.

Сверка подтвердила точные тексты, метаданные, порядок, доступность, provenance заданий и описание продукта.
Тела материалов сравнивались после штатного codec: он снимает envelope и удаляет `null` из атрибутов.
Все 22 прежних material IDs сохранены. 21 прежняя запись не изменилась;
`inside-content:aie-product-brief` обновлён по принятому пакету, сохранив ID и остальные поля.
Курс сохранил ID `625a0cca-c8ff-4a65-9125-17194dd3b769`.
Два grant, одна запись прогресса, десять account IDs, покупки и оферты совпали с исходным снимком.
Принятая замена старых привязок не удаляла старые материалы. Постоянный журнал публикации сохранён.

## Сдачи, доступ и telemetry

Политика v4 опубликована до включения `PRODUCT_TASK_SUBMISSIONS_ENABLED`.
Сдачи включены отдельным шагом `2026-10-12T17:18:37Z`: флаг равен `true` в API и MCP.
Перезапущены только эти два сервиса с прежними digest `v34`; операция заняла около 10 секунд.
После этого `production:verify` подтвердил 61 passed, 0 failed, 0 not checked.
Проход доступа в [PR #1377](https://github.com/sachkov-inside/platform/pull/1377) проверяет
закрытый материал `inside-content-aie-ch2-modules` и Product Task `aie-ch2-accounts-design`.
Он читает все части MCP-контекста с проверкой version/hash/bytes/end marker;
записывающий `learning_task_submit` остаётся запрещённым в его allowlist.
Для сдач используются отдельные явно синтетические проверки существующего тестового аккаунта.
Живой проход с проверяющим кодом `62811a289e621c5b897fdc84ac927c26a45f0bcc` против deployed `bdae0c82`
прошёл: 30 passed, 17 deferred. Отсрочки сохранены из матрицы, включая отсутствующее видео;
восемь фоновых запросов записи заблокированы allowlist до отправки.

Проверены четыре части контекста бесплатного задания, отправка через MCP и повтор того же ключа.
Повтор вернул прежнюю квитанцию; в базе одна MCP-сдача. Форма создала вторую сдачу без отчёта агента.
Ученик видит обе сдачи в «Моих сдачах»; автор видит обе карточки и подробный отчёт MCP.
Все критерии синтетического отчёта помечены «Не проверено»; учебный проект не оценивался.
Это проверка production-транспортов с тестовыми токенами, без нативного OAuth-входа Codex или Claude.

Владелец отдельно разрешил `platform:admin` существующему аккаунту публикации.
Штатная команда добавила право без создания аккаунта; тестовые identities не менялись.
Живой telemetry summary доступен администратору, обычному аккаунту и учебному MCP отказано.
Private `/internal/web-telemetry` снаружи отвечает 404. Retention завершился во время deploy;
свежесть результата подтверждена после выпуска.
watchdog timer активен, установленный скрипт содержит проверки telemetry.

## Восстановление после отказа

Platform применил миграции `0086`, `0087`, `0088`: 86 migrations стали 89.
В state записан `v33` с `compatible=false`. Откат приложения на `v33` не разрешён,
даже пока указанное в state время rollback ещё не истекло.
До maintenance отказ preflight/pull сохраняет текущие маршруты.
После maintenance сначала прочитать `operation.json`, затем повторить exact version или выпустить
следующий ordinal с исправлением (`repair forward`) по [production delivery](../../runbooks/production-delivery.md#deployment-order-and-state).
Down migrations не выполняются. Production-откат ради этой проверки не запускался.

При аварии данных восстановить выбранную актуальную точку backup/WAL в новый recovery volume по
[foundation runbook](../../runbooks/production-foundation.md#восстановление-базы).
Сверить данные до переключения. Старый volume сохранить; выполненная изолированная проверка production не переключала.
Telegram сохраняет migration identity
`sha256:f91e56479cfcae72f9596dc508c776c5c06e156f16d747e4e91d956931ca533d`, 31 migration.
Его gateway допускает только записанный предыдущий `v15` с тем же manifest и migration identity,
по [Telegram runbook](../../../apps/telegram/docs/operations/production.md#4-откат).

Закрытые raw logs, инвентари и журналы операций сохранены вне Git:
`/Users/dev/Work/Artifacts/platform-1356-release-2026-10-12/release-bdae/`.
Постоянный журнал публикации — `/Users/dev/.inside-authoring/production/`.
