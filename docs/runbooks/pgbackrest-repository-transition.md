# pgBackRest: сохранение истории и переход repository (#1627)

Статус: исполнимый кандидат, production ещё не изменён. Final merge и применение требуют
принятия конкретного HIGH результата по [policy](../agents/change-risk.md). Проверенный commit,
CI receipts и принятое окно фиксируются в [#1627](https://github.com/sachkov-inside/platform/issues/1627).
Полное поручение владельца разрешает подготовку, безопасное чтение и synthetic proof.
Оно не подменяет принятие готового HIGH результата.

## Что меняется

Старый repository `/inside-platform` и stanza `production` сохраняются как repo1. Для repo2
используется **тот же существующий backup bucket**, новый непересекающийся prefix
`/inside-platform-v2`, отдельная stanza с тем же именем и новая независимая cipher passphrase.
Cloud access key остаётся прежним, его не вращать. Нового bucket, service account или сервера
не требуется. Это сохраняет общий failure domain провайдера, а не создаёт географическую
резервную площадку. Отдельный bucket из первоначального проекта заменён отдельным prefix,
чтобы не менять облачные права и не добавлять инфраструктуру в этот переход.

Старые `archive.info`, `backup.info`, manifests и ciphertext не переносить в repo2.
Initializer имеет только repo2 env/config и read-only data mount. После переключения WAL
отправляется штатным multi-repository механизмом в оба repository; backup выбирает repo явно.
Не отключать old WAL в рамках этого пакета. Историю и старые ключи не удалять.

`database-backup` передаёт `--no-expire-auto` и `--repo=1|2`. В обеих backup конфигурациях
задано `expire-auto=n`. Это сохраняет историю от автоматического pgBackRest expire после backup,
но не защищает от постороннего ручного удаления или будущего изменения bucket lifecycle.
Отдельные expire jobs и lifecycle проверить повторно перед окном.

## Доказательства и ёмкость

Read-only наблюдения 21.10.2026:

- [Inventory](../evidence/issue-1627/repository-inventory-2026-10-21.json): 88 labels, 4 full,
  9 diff, 75 incr на 08:03 UTC. От `20261011-010316F` до
  `20261021-051241F_20261021-080240I`. Это не снимок T0 и не доказательство непрерывности WAL.
- [Provider metadata](../evidence/issue-1627/storage-metadata-2026-10-21.json): lifecycle
  отсутствует по HTTP 404 + `NoSuchLifecycleConfiguration`; versioning не настроен;
  новый prefix пуст на момент наблюдения. Класс одного выбранного объекта STANDARD, не всех объектов.
- [Host metadata](../evidence/issue-1627/host-metadata-2026-10-21.json): 38 157 750 272 bytes
  свободны; размеры трёх БД 106 534 591 / 37 893 823 / 120 493 759 bytes.
  Production image остаётся `sha256:e8c0c4e0acd81074186c2bc85dec272d820dae2a7cb55827ebd0d3f404e764a5`.
- Read-only `repo-ls --recurse --output=json` 08:03 UTC дал 1679 backup объектов,
  2 081 920 480 bytes; 15070 archive объектов, 3 070 829 424 bytes. Эти агрегаты получены
  последовательно при работающем production и не включают невыбранные namespaces.

Рабочий запас: **40 GiB object storage на 30 дней** для существующей и новой истории вместе,
**10 GiB свободного host disk** для последовательного staging/restore. Измеренный текущий
namespace около 4,8 GiB; latest full около 46 MiB compressed. Это начальный бюджетный envelope,
а не измеренный будущий рост. После первого full пересчитать по фактическим bytes и WAL/day.
При каждом этапе повторять измерение и прогноз роста, без новых уведомлений/alarms.
Если прогноз превышает envelope, остановить переход и согласовать ёмкость, не включать expire.

[Официальная тарификация](https://yandex.cloud/ru/docs/storage/pricing) использует GiB и
оплачивает storage, запросы и egress. По опубликованному примеру STANDARD 2,376 ₽/GiB-month
40 GiB дают 95,04 ₽/month без вычета free tier. Это ориентир из документации, не проверка
договора billing account. Предлагаемый предел дополнительных расходов: **1000 ₽ за первые
30 дней**, включая операции и restore egress. Не создавать платные ресурсы. При неизвестной
или превышающей этот предел оценке конкретной операции её не выполнять. 30 дней не являются
разрешением удалить историю: после этого срока хранение продолжается до отдельного решения.

## Проверки до принятия кандидата

[Foundation workflow](../../.github/workflows/foundation-recovery.yml) строит native images
amd64/arm64 и выполняет обычные synthetic recovery, legacy compatibility и transition proof.
Последний проверяет три БД, неизменность old namespace при создании нового, два full сверх
retention count, явный backup repo, old/new full restore и PITR, сохранение источников и
возврат маршрута с сохранением новых записей. Это POSIX namespaces на исправленном 2.59.3,
не S3/provider/IAM acceptance. Отдельный Compose test проверяет настоящую staged/active env схему.
Lifecycle tests проверяют исчезновение inventory worker и потомка внутри контейнера даже
после отключения Docker client. Нужны реальные successful receipts, не только наличие тестов.

CI source/image и production image фиксируются раздельно. Нового binary upgrade этот пакет
не выполняет; перед применением повторно проверить production version/image. Использовать
прежний закреплённый image, volumes, mounts и приложения. Общий local Compose stand не трогать.

## Последовательность после принятия конкретного HIGH результата

Команды выполняются root на `inside-production` из проверенного checkout принятого commit.
`ACCEPTED_SOURCE` в операционной записи должен совпадать с его полным SHA. Публичные файлы
доставляются из этого checkout; секреты только через [существующую процедуру](../../infra/production/secrets/README.md).
Ни один шаг ниже ещё не выполнен. Держать оба deployment locks на протяжении изменений:

```bash
exec 8<>/var/lib/inside/deployments/operation.lock
flock --exclusive --nonblock 8
exec 9<>/var/lib/inside/telegram-deployments/operation.lock
flock --exclusive --nonblock 9
```

1. Повторить оба metadata readers из принятого source. Проверить свободное место, текущий
   image, prefix repo2, отсутствие lifecycle и отдельных expire jobs. Сохранить hash/public
   preimages config/helper/unit в root-only audit directory. Не сохранять туда открытые секреты.
2. Остановить только три backup timers, дождаться завершения активного backup service без
   его прерывания. При чужой операции или timeout отказаться от изменения. WAL не останавливать:

   ```bash
   systemctl stop inside-pgbackrest-full.timer inside-pgbackrest-diff.timer inside-pgbackrest-incr.timer
   systemctl is-active inside-pgbackrest-backup@full.service inside-pgbackrest-backup@diff.service inside-pgbackrest-backup@incr.service
   ```

   Все три должны стать inactive, последний exit status надо проверить отдельно. `is-active`
   вернёт ненулевой код для inactive, поэтому это наблюдение, не команда в слепой цепочке `&&`.
3. Установить принятые `database-backup`, service unit и обычный `pgbackrest.conf` с expire off.
   Пути: `/usr/local/libexec/inside/database-backup`, `/etc/systemd/system/inside-pgbackrest-backup@.service`,
   `/opt/inside/foundation/infra/production/database/pgbackrest.conf`. В
   `/etc/inside/foundation/backup-policy.env` mode 0600 задать `INSIDE_BACKUP_REPOSITORY=1`.
   Выполнить `systemctl daemon-reload`, проверить отсутствие CLI/env переопределений expire
   у всех entrypoints. Зафиксировать inventory **T0**, все его labels и зависимости сохранять.
   Timers оставить остановленными до шага 8, чтобы backup не начался во время следующего
   переключения config/recreate. Нужные промежуточные backups выполняются вручную под теми же
   locks. Изменение защиты от expire не должно откатываться при дальнейшей ошибке.
4. Через защищённую процедуру подготовить `pgbackrest-repo2.env.staged` mode 0600.
   Bucket/access key соответствуют repo1, cipher passphrase новая и независимая. Зашифровать
   для host и offline recipients до создания stanza. Не печатать значения, не копировать
   весь repo1 env как repo2 env. Доставить новые публичные Compose/config файлы; active
   `pgbackrest-repo2.env` пока отсутствует. Повторно доказать пустоту нового prefix.
5. Создать только новую stanza:

   ```bash
   docker compose --env-file /etc/inside/foundation/compose.env \
     --file /opt/inside/foundation/infra/production/database/compose.yaml \
     --profile repository-transition run --rm initialize-repo2 \
     --stanza=production --no-online stanza-create
   ```

   Старый source volume смонтирован read-only, old config/env не передаются. Если prefix уже
   содержит объекты, не переиспользовать его и не очищать, остановиться для разбора.
6. Перед переключением получить свежий old backup и его isolated restore. Подготовить maintenance
   и точный список текущих writers через [foundation runbook](production-foundation.md).
   Назвать владельцу ожидаемый перерыв **2–5 минут**, начать окно только после принятия.
   Дренировать и остановить текущих writers, сохранив их идентичность и новые записи в той же БД.
   Применить `pgbackrest-transition.conf` как live `pgbackrest.conf`, установить active repo2 env
   из staged файла mode 0600, пересоздать только postgres без сборки и зависимостей:

   ```bash
   docker compose --env-file /etc/inside/foundation/compose.env \
     --file /opt/inside/foundation/infra/production/database/compose.yaml \
     up --detach --no-deps --no-build --force-recreate --wait postgres
   ```

   Проверить тот же data volume, health, pgBackRest version и WAL/check обоих repos.
   Вернуть прежних writers и маршруты. Зафиксировать фактический перерыв и результат проверок.
7. Получить явный full backup repo2 с выключенным expire, проверить WAL и восстановление:

   ```bash
   INSIDE_BACKUP_REPOSITORY=2 /usr/local/libexec/inside/database-backup full
   ```

   До выбора repo2 в расписании новая full должна пройти isolated restore всех трёх БД и PITR.
   Для каждого retained label T0 выполнить последовательный isolated restore, проверить схемы
   и доступность трёх БД; выбранные интервалы WAL и границу перехода проверить отдельно через
   PITR. Сырые plaintext данные и ключи не публиковать. Пробелы не объявлять PASS.
   [Restore driver](../../scripts/isolated-database-restore.py) поддерживает repo1/repo2,
   immediate и named/time targets. Пример для encrypted staging нового repository:

   ```bash
   PRODUCTION_IMAGE_ID="$(docker inspect --format '{{.Image}}' inside-production-database-postgres-1)"
   docker image inspect --format '{{.Id}}' "$PRODUCTION_IMAGE_ID"
   python3 -B scripts/isolated-database-restore.py \
     --image "$PRODUCTION_IMAGE_ID" \
     --repository /var/lib/inside/backup-assurance/new-repository \
     --cipher-env /var/lib/inside/backup-assurance/repo2-cipher.env \
     --repo 2 --backup-label "$NEW_FULL_LABEL"
   ```

   Local `.Image`/`.Id` проверить до создания recovery ресурсов, связать с принятой image
   identity. Не подставлять произвольный OCI manifest вместо local image ID. Наблюдение
   host receipt получено именно из container `.Image`, а не из RepoDigests.
   Cipher file mode 0600 содержит только `PGBACKREST_REPO2_CIPHER_PASS`; его значение не
   печатать. Для PITR добавить `--target-time "$TARGET_UTC"`, формат
   `YYYY-MM-DDTHH:MM:SS+00:00`, либо `--target-name "$RESTORE_POINT"`.
   Target выбирается после backup stop в доступном WAL интервале. Driver требует успешного
   окончания recovery, три БД и базовые application tables. Он не доказывает полное совпадение
   содержимого с историческим состоянием, для которого исходный эталон отсутствует. Для старых
   labels использовать repo1/cipher1 и отдельные receipts; отсутствие ожидаемых БД/таблиц
   фиксировать как ограничение и разбирать по истории схемы, не скрывать как успешный restore.
   Plaintext volumes удаляются в finally; staged ciphertext и recovery materials сохраняются
   защищённо. Полное сравнение данных при наличии закрытого эталона выполняется отдельно.
8. После successful new proof задать `INSIDE_BACKUP_REPOSITORY=2` в policy file, возобновить
   три timers и проверить их расписание. WAL остаётся в обоих repos. Старые backups, metadata,
   WAL и recovery secrets сохраняются. Удаление и прекращение old WAL не входят в пакет.

Если preparation или создание repo2 не удались, оставить прежний live маршрут. После переключения
при ошибке вернуть old-only config **с expire off**, убрать active repo2 env из live schema
в защищённое staging (не уничтожать), пересоздать тот же postgres без смены data volume и
вернуть backup policy 1. Проверить WAL catch-up, свежую old копию и isolated restore.
Не восстанавливать старый backup поверх рабочей БД. При gap WAL или неуспешном restore
возврат не считать завершённым, новые изменения остановить. Защиту истории не отменять.
На отмене операции после проверки рабочего WAL маршрута вернуть правильную backup policy
и её timers. Не оставлять расписание выключенным после завершения или передачи операции.

## Закрытие результата

Раздельно записать: принятую ревизию/операцию, T0, сохранённые цепочки, new stanza/full/WAL,
проверенные old/new restores/PITR, cleanup, расходы и ограничения. Блокировки и временные
ресурсы освободить, сохранить audit/recovery материалы. Непроверенная часть матрицы остаётся
открытой. Историческое качество подключей новая stanza задним числом не доказывает.
`rngFailureVerified=false` и STOP остаются; никаких экспериментов или альтернативных механизмов
для остановленного критерия. #1627 и security acceptance не становятся GREEN из-за merge этого пакета.
