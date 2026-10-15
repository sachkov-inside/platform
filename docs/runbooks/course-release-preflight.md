# Подготовка выпуска курса (#854)

Этот runbook связывает [выпуск](release.md), [production delivery](production-delivery.md),
[telemetry](web-telemetry.md) и [foundation/backup](production-foundation.md). Он готовит технический
выпуск; production-приёмка интерфейса, контент, сообщения, реальные деньги и открытие продаж имеют
свои подтверждения. Количество материалов и календарь не являются условиями технического выпуска.
Полный monitoring #1289, marketing и Tribute migration остаются после запуска.

## До публикации

1. Получить свежий `origin/main` и включить его через merge. Записать итоговый SHA, список отличий
   от production и точные версии Platform/Telegram. #855 и #806 уже в main; это не подтверждение
   production-приёмки «Сдач». Принятый Reader `501dc62e` и вариант A прототипа не заменяют её.
2. Collect final-source coverage under the [verification evidence policy](../agents/release-evidence.md).
   Reuse applicable successful trusted CI and manual investigation receipts, including cleanup;
   fill only named missing coverage.
   Keep independent Standards/Spec review receipts. Submit v3 evidence below; local aggregate runs
   are fallback choices, not mandatory duplicate executions.
3. Заполнить [техническую форму](../../config/release/course-launch-inputs.example.json) по разделу
   ниже. Секреты и реальные identities остаются в защищённом хранилище. `credentials://` — условные
   ссылки на записи владельца, не встроенный resolver и не свидетельство существования credential.
   Заменить их на фактические защищённые ссылки. Наличие ссылки не подтверждает настройку процесса.
4. Проверить доступную память (после выкладки не меньше 1 GiB), свободный диск с запасом для WAL
   и четырёх full backup. По принятому решению #1430 автоматические telemetry resource measurements
   и обязательный receipt `telemetry-resource-budget` исключены из текущего preflight v3.
   Функциональные telemetry tests остаются частью application coverage.
   `pnpm telemetry:measure` сохранён как ручная диагностика; его результат не является условием выпуска.
   [Cloud-проверка 11 октября](../verification/web-telemetry-707.md#cloud-verification--11-october-2026)
   не прошла лимит p75. Исключение измерения не исправляет исторический failure #1386.

   Исторические receipts v1/v2 сохраняют прежнюю проверку telemetry budget, включая ограниченное
   исключение `owner-2026-10-13-1408-v36`. Оно обозначает `exitCode: null`,
   `outcome: "owner-excluded"`, а не успешный замер. Для новых receipts используется v3;
   publication, assets, backup и isolated restore остаются обязательными.

## Backup и изолированная проверка восстановления

Foundation — единственный владелец PostgreSQL и pgBackRest. Перед изменениями выполнить
`sudo systemctl start inside-pgbackrest-backup@incr.service`, проверить `Result=success` и выполнить
`pgbackrest --stanza=production check` через существующий operations service. Получить
`pgbackrest --stanza=production --output=json info` и сохранить label и время завершения выбранной
копии. Перед выкладкой backup должен быть моложе восьми часов; повторить его, если окно истекло.
Логи и metadata хранить в защищённом каталоге оператора, не коммитить.

Для проверки нужны полный локальный snapshot **того же** pgBackRest repository (backup chain и WAL),
права чтения, выбранный label и уже имеющийся образ foundation с pgBackRest 2.57.0/PostgreSQL 18.4.
Подготовить этот snapshot штатным защищённым способом; не менять live repository. Скопировать только
`PGBACKREST_REPO1_CIPHER_PASS` в временный env-file с mode `0600`. Не копировать S3/production database
credentials. Источник plaintext и временный repository содержат production-данные: хранить их вне Git
и отчётов в защищённом каталоге; после проверки удалить по политике владельца.

```bash
pnpm release:restore:check \
  --image sha256:<local-foundation-image-id> \
  --repository /secure/backup-snapshot/inside-platform \
  --cipher-env /secure/restore-cipher.env \
  --backup-label <exact-pgbackrest-label> > /secure/restore-receipt.json
```

`--image` принимает immutable image digest или точный local image ID, не tag. Сначала проверить его
соответствие установленному foundation image и версию PostgreSQL/pgBackRest. Команда никогда не
pull-ит образ. Она создаёт только уникальный `inside-production-postgres-data-recovery-check-*`,
монтирует repository read-only, запускает restore и PostgreSQL с `--network none`, без портов,
отключает archive-push и не запускает API, Logto, бот или workers. Она ждёт окончания WAL recovery,
выполняет read-only SQL для `inside`, `logto`, `inside_telegram` и удаляет свои container/volume при
успехе и отказе. Если cleanup не завершился, green receipt не выдаётся.

Timeout и SIGTERM проходят через cleanup. SIGKILL или потеря Docker daemon не позволяют скрипту
завершить очистку: после такого прерывания проверить контейнеры `inside-restore-copy-*` /
`inside-restore-check-*` и volumes с label `inside.restore-check=true`, удалить только ресурсы
прерванного restore. До этого результат остаётся failed, а данные — в защищённом контуре.

Receipt доказывает возможность открыть базы и прочитать ключевые таблицы. Для приёмки сохранности
сверить инвентарь курса, IDs аккаунтов, права, прогресс, платежи и последние подтверждённые операции
с защищённым инвентарём на выбранной точке backup. Сравнение должно учитывать время копии; записи
после этой точки в ней не ожидаются. Один `pgbackrest info/check` без реального restore недостаточен.
Live volume и `/etc/inside/foundation/compose.env` этой процедурой не переключаются.

`RESTORE_TEST_IMAGE=sha256:<local-postgres-image-id> pnpm release:restore:test` отдельно проверяет
реальную очистку Docker/process при успехе, отказе, subprocess timeout и SIGTERM.
SIGTERM проверяется и после записи синтетических данных, и между созданием volume и подтверждением
Docker CLI. Каждый случай
имеет бюджет 15 секунд, собственные container/volume и только синтетический файл. Этот contract
включён в CI; он проверяет lifecycle, а восстановление выбранного backup остаётся отдельным gate.

## Миграции и порядок применения

1. Опубликовать очередной immutable `vN` через `release.yml`. Скачать exact `release-manifest.json`
   и `production-runtime.tar.gz` по [release](release.md). Публикация ещё не выкладка.
2. Проверить source SHA, publication run, bundle digest и оба GHCR image digests. Скачать образы
   по **полному reference из manifest**, затем запустить preflight ниже. Не выбирать `latest` или
   tag. Host повторно проверит immutable Release и bundle/manifest перед исполнением.
3. Проверить server-owned конфигурацию и доступность текущей schema identity. Перед deploy назвать
   ожидаемую длительность maintenance по прежним drain/migration/start/readiness/reload измерениям.
4. Выполнить штатный `deploy.yml`: preflight → image pre-pull → maintenance → candidate compatibility
   → drain старых workers → migrations → новые процессы → readiness/schema/version → read-only smoke
   → public routes → journal. Все Platform migrations идут в порядке `platformMigrations`, затем
   converges pg-boss. Не выполнять отдельную `0087` через psql и не править checksums старых миграций.
5. `0087_web_telemetry` создаёт schema, quota/coverage routines и `web_telemetry.health`;
   следующая `0088_web_telemetry_percentile_index` вычисляет stored UTC day из `occurred_at` и
   бинарный ключ исходного float, затем заменяет summary index для точного p75. Оба поля заполняются
   одним table rewrite; учесть rewrite/index build в maintenance.
   Не менять checksum `0087` и не выполнять эти миграции вручную. Billing-worker
   запускает retention при старте и ежедневно в 03:00 UTC (06:00 по Москве). Только после миграций
   deploy устанавливает watchdog из exact backend image. Проверить установку: её warning не отменяет
   deploy автоматически и не считается готовым мониторингом.
6. После выкладки выполнить [production verify](production-release.md), сверить state/journal,
   versions/digests, все readiness и доступ. Проверить private telemetry ingress, summary с
   `platform:admin`, отказ обычному Account и learner MCP, завершение retention, memory/disk и
   watchdog timer. Private `/internal/web-telemetry` снаружи должен давать 404. Не инъецировать
   неисправность в production для теста: failure/recovery проверены на изолированном контуре.

## Проверяемый preflight

`pnpm release:course:preflight <evidence.json> <manifest.json> <runtime.tar.gz> [previous-manifest.json]`
binds v3 `selectedSourceSha` (frozen before publication), exactly one successful receipt per coverage item,
publication run, immutable status, bundle hash, `RepoDigests` скачанных образов и binding предыдущего
manifest. Перед командой выполнить `git fetch origin main:refs/remotes/origin/main`.
Она ничего не выкладывает и не заменяет host preflight. Evidence — аттестация оператора с raw logs
по `evidenceRef`; script не может подтвердить содержимое произвольно заполненного receipt.

Evidence v3 uses coverage receipts without a resource-budget gate; v1/v2 remain historical formats.
Each CI receipt identifies its workflow and job; local fallback
receipts use `execution: {"kind":"local"}`, and independent reviews use `{"kind":"review"}`.
The `check` receipt references all four completion phases; integration references parallel and serial
jobs; Compose references development and production jobs and their cleanup. Preserve actual logs.

For a synthetic queue commit, preserve the actual checked `checks[].sourceSha`; do not replace it
with `selectedSourceSha`. V3 can include `sourceCorrespondence: {"candidates": [...]}` using the
provider run/job/artifact inputs of `selectReleaseEvidence` in `scripts/release-source-evidence.mjs`.
The operator must obtain and verify these inputs against GitHub; preflight checks the same trust,
coverage and whole-tree rules as release publication, and binds the receipt's workflow run, actual
source and exact provider job name to the proved run. Aggregate receipts require their complete
job coverage in that same run, with `execution.job` naming one of its applicable provider jobs. The CLI obtains the selected commit's tree directly from Git. Missing proof,
a different tree, an untrusted run or incomplete job coverage fails the receipt. Direct API callers
must supply `selectedSourceTreeSha` from the selected immutable source, rather than copying the
candidate's tree. Standards/Spec review receipts still require the selected commit itself.
This manual receipt remains an operator attestation, not a live GitHub provider query.


```json
{
  "schemaVersion": "inside.course-release-preflight.v3",
  "selectedSourceSha": "<frozen-release-40-hex>",
  "checks": [
    {"name":"check","sourceSha":"<40-hex>","exitCode":0,"evidenceRef":"<raw-log>","execution":{"kind":"ci","workflowRunId":1,"job":"<actual-job>","conclusion":"success"}},
    {"name":"integration","sourceSha":"<40-hex>","exitCode":0,"evidenceRef":"<parallel-and-serial-jobs>","execution":{"kind":"ci","workflowRunId":1,"job":"<actual-job>","conclusion":"success"}},
    {"name":"enrollment","sourceSha":"<40-hex>","exitCode":0,"evidenceRef":"<job-log>","execution":{"kind":"ci","workflowRunId":1,"job":"<actual-job>","conclusion":"success"}},
    {"name":"buyer-journey","sourceSha":"<40-hex>","exitCode":0,"evidenceRef":"<job-log>","execution":{"kind":"ci","workflowRunId":1,"job":"<actual-job>","conclusion":"success"}},
    {"name":"compose-smoke-shutdown","sourceSha":"<40-hex>","exitCode":0,"evidenceRef":"<raw-log-and-shutdown>","execution":{"kind":"ci","workflowRunId":1,"job":"<actual-job>","conclusion":"success"}},
    {"name":"standards","sourceSha":"<40-hex>","exitCode":0,"evidenceRef":"<review>","execution":{"kind":"review"}},
    {"name":"spec","sourceSha":"<40-hex>","exitCode":0,"evidenceRef":"<review>","execution":{"kind":"review"}},
    {"name":"ci","sourceSha":"<40-hex>","exitCode":0,"evidenceRef":"<run-url>","execution":{"kind":"ci","workflowRunId":1,"job":"<actual-job>","conclusion":"success"}},
    {"name":"fullstack","sourceSha":"<40-hex>","exitCode":0,"evidenceRef":"<run-url>","execution":{"kind":"ci","workflowRunId":1,"job":"<actual-job>","conclusion":"success"}}
  ],
  "publication": {"sourceSha":"<40-hex>","workflowRunId":1,"immutable":true,"succeeded":true},
  "backup": {"label":"<label>","finishedAt":"<UTC-ISO>","checkExitCode":0},
  "restore": {"backupLabel":"<same-label>","finishedAt":"<UTC-ISO>","exitCode":0,
    "volume":"inside-production-postgres-data-recovery-check-<id>","networkMode":"none",
    "publishedPorts":0,"databasesPassed":["inside","logto","inside_telegram"]}
}
```

Подставлять только фактические результаты. Незапущенная, failed или stale проверка остаётся pending;
не переписывать её как `exitCode:0`. Restore receipt берётся из предыдущего шага.

## Формы T-Bank, callback и двух каналов

В JSON-форме `technical` содержит вычисляемые поля: текущие URLs, целевые env-files и принятые суммы.
В `ownerEvidence` остаются подтверждённые факты терминала и получателей. `null` означает missing input.
Основная цена 29 900 RUB, альтернативная 39 900 RUB; скидка опроса 10% даёт 26 910 RUB. После отдельного
разрешения сценарий предусматривает **ровно две оплаты** 29 900 и 26 910 RUB, всего 56 810 RUB, затем
два полных возврата в течение семи дней. Альтернативная цена не добавляет третью контрольную оплату.

| Настройка | Вычисляемое техническое поле | Защищённый input / evidence владельца |
|---|---|---|
| T-Bank | `environment=production`; `/payment/return`; POST callback `/billing/tbank/notification`; одинаковый `TBANK_CONFIG_JSON` в API/MCP/billing-worker | terminal key/password; сохранённый 32-byte base64 binding key; факты terminal capabilities, limits, taxation/tax и включённые HTTP notifications |
| Callback | Caddy пропускает только POST; приложение проверяет подпись и terminal binding | включение в кабинете банка; evidence callback без token/полного payload |
| Основной канал | `/etc/inside/watchdog/watchdog.env`, `WATCHDOG_TELEGRAM_BOT_TOKEN`, `WATCHDOG_TELEGRAM_CHAT_ID`; relay из production-monitoring | отдельный бот сигналов и одобренный recipient; разрешение exact test message |
| Запасной канал | тот же env-file, `WATCHDOG_SMTP_URL`, `WATCHDOG_SMTP_USER`, `WATCHDOG_SMTP_PASSWORD`, `WATCHDOG_EMAIL_FROM`, `WATCHDOG_EMAIL_TO` | действующий SMTP TLS endpoint, login, sender и одобренный recipient; разрешение exact test message |
| Внешняя проверка | GitHub repository secrets `MONITOR_TELEGRAM_BOT_TOKEN`, `MONITOR_TELEGRAM_CHAT_ID` | ссылки на те же защищённые записи; actual delivery proof отдельно |

`receipt` и limits берутся из актуального evidence рабочего терминала, а не из example defaults.
Схема `apps/backend/src/config/tbank-config.ts` — authority допустимых полей. Recurring confirmations
относится к подписке: она остаётся выключенной; не придумывать подтверждение ради запуска курса.
Binding key сохраняется между выпусками, иначе ранее зашифрованные привязки перестанут читаться.
В env-files записываются настоящие значения по защищённому каналу, не сами `credentials://` ссылки.

Проверка маршрута/token через `getMe` ничего не отправляет. Для испытания доставки подготовить текст
с synthetic failure/recovery и точный recipient каждого канала; разрешение и фактическое получение
зафиксировать отдельно. Telegram-поломка не должна лишать SMTP-сигнала; проверить запасной канал
отдельно. Наличие credentials, успешный curl или outbox запись не заменяют получение владельцем.

## Отказ, восстановление и rollback

- До миграций: read-only preflight отказывает без изменений. При отказе после maintenance сохранить
  operation/journal; повторять exact version штатным deploy, не повторять неизвестный SSH write.
- После `0087`/`0088`: schema identity изменилась. **Application rollback на предыдущую schema запрещён**
  текущим release contract; сохранить данные и выпустить repair forward следующим ordinal.
  Не выполнять down migration, restore поверх live или редактирование state/journal вручную.
- При одинаковой schema identity manifest может разрешать rollback только на recorded previous
  успешный выпуск в 24-часовом окне; окончательное решение принимает host preflight. В preflight
  `eligible-after-host-preflight` не означает автоматически разрешённый rollback.
- Потери forwarding/minute ceiling видны в журналах и сигнале watchdog; восстановление значит
  отсутствие новых событий за окно. Квота отдельно даёт dropped coverage и `incomplete` p75.
  Просроченная retention вызывает сигнал, successful cleanup снимает его. При недоступной базе
  прежние SQL-сигналы сохраняются, не объявляются восстановленными.
- Аварийное восстановление live cluster — отдельная процедура
  [foundation](production-foundation.md#восстановление-базы), с сохранением старого volume и explicit
  recovery replacement. Preflight restore не является её разрешением.

RKN #856 и оферта #780 закрыты; повторного согласования цены/юридических решений здесь нет.
Отчёт отличает подготовленный код, merge, actual deploy, публикацию content и public-sale GO.

Полный CI receipt и receipt `check` используют нормализованные application stage IDs из
`scripts/ci-coverage-plan.mjs`: Static включает `docs:check`, Unit включает `test:tooling` и
root `test:contracts` через `check:contracts`. Отдельные focused jobs `docs`/`contracts` не нужны
вместе с этими stage IDs. Их команды остаются самостоятельными для документационных и
instruction-only планов; package-command contract проверяет сохранение покрывающих команд.
