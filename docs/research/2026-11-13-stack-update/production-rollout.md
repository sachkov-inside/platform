# Применённое состояние production, #2117

14 ноября 2026 выпущены [Platform v81](https://github.com/sachkov-inside/platform/releases/tag/v81)
и [Telegram v55](https://github.com/sachkov-inside/platform/releases/tag/telegram-v55).
Владелец разрешил merge, публикацию и production в этой проектной сессии. Операции первого этапа
на сервере выполнены под [lock #2144](https://github.com/sachkov-inside/platform/issues/2144).
Исходная ошибка прежней сессии, обновление ОС без lock, не переименовывается в соблюдённый процесс.

## Версии и владельцы первого этапа

| Компонент | До | Применено | Фактический источник |
|---|---|---|---|
| Platform | v80, source e9faaecf5 | v81, source 492636dd8 | immutable manifest, server state, runtime readiness |
| Telegram | v54, source c064917cd | v55, source 07ed26b7b | immutable manifest, server state, runtime readiness |
| Node API/Web/Telegram | 26.10.0 | 26.13.1 | `node --version` в работающих контейнерах |
| Logto | 1.44.0-inside.15 | 1.46.0-inside.16, Node 26.13.1 | проверенный native amd64 image, миграции и readiness |
| PostgreSQL | 18.4 | 18.7 | `SHOW server_version`, прежний data volume |
| pgBackRest | 2.59.3 | 2.60.0 | binary version, metadata настоящего нового backup |
| RabbitMQ | 4.2.4 | 4.4.0 | immutable official mirror, `rabbitmqctl version` |
| Caddy | 2.11.4 | 2.11.9 | официальный deb, установленный и запущенный binary |
| Compose | Ubuntu 2.40.3 | официальный plugin 5.7.1 | Docker plugin inventory, pinned SHA-256 |
| distro-info / python3-distro-info | 1.15 | 1.15ubuntu0.1 | dpkg и configured apt candidate |
| qemu-guest-agent | 1:10.2.1+ds-1ubuntu3.2 | 1:10.2.1+ds-1ubuntu3.3 | Ubuntu package; hold сохранён |

Docker 29.1.3-0ubuntu4.1, Buildx на host 0.30.1-0ubuntu1, containerd 2.2.2-0ubuntu1.2 и
runc 1.4.0-0ubuntu1 уже совпадали с кандидатами настроенного Ubuntu-канала. Канал docker-ce
не добавлялся. Ядро остаётся 7.0.0-43-generic, reboot не требуется, `dpkg --audit` чист.
При обновлении qemu-guest-agent сохранены binary/unit/config preimages, состояние сервиса,
Docker PID и container IDs. Документированного владельца или причины прежнего hold не найдено;
обновление версии не снимает ограничение будущих автоматических обновлений.

Полные manifest/lock inventories остаются в [основном отчёте](report.md). Дополнительно выявленные
версии CI Buildx/BuildKit и их отдельная поставка описаны в [image builder](image-builder.md).
Рабочий Mac, чужие worktrees, общий зарезервированный стенд и другие серверы не обновлялись.

## Образы и сохранение данных

Platform backend digest `899c5c2d684ec35b4f15e97bc25f49dc3dac33e53d06a57e8d49a583d1a3dd7e`,
web `99a48f8ad244476972853e410bed1ad20f2c286a2571d1e6fd7c4af8fe2628bd`.
Оба принадлежат frozen source `492636dd8660b44a028f0358ad9d7b86302ab9b9` и publication run 43596577457.
Telegram digest `175394e01fae19ddcf1897fb3101a3337fc31fec7725a2f213b5c0559e3ab770`
принадлежит source `07ed26b7b67693cc475b2202208ab1c6639ae8dc`, publication run 43589645166.

Native PostgreSQL image `e316e4215979f368d9b5b5becb4df6e2ae080e0dfa55a8eae08c9f9125ff276e`
и Logto image `4ab057966804c2ed80a921485f81eab60e1f2f6ce0d50a3a57f42dd1ee3c559d`
собраны вне VPS. Контексты совпадают с проверенными исходниками; private patches и прежние
custom images сохранены. PostgreSQL сохранил mounts, networks, data volume и private pgbackrest.conf.
Credentials, cipher policy, stanza, repositories и история backups не менялись.

На изолированной копии настоящего backup проверены Logto alteration, сохранение subjects/identities,
connectors, private unique index и прежних публичных signing keys. Проверка не имела сети к providers.
RabbitMQ проверен на отдельных копиях настоящего холодного тома: 4.4 startup, stable flags,
restart и сохранение очередей; отдельно запуск 4.2 на старой копии. Старый backup hash не изменился.
Это не доказательство downgrade уже преобразованного тома. После новых записей нужен repair forward;
автоматический rollback v81→v80 в manifest отмечен incompatible.

## Проверки и интервалы

- Основной PR #2136 и подготовительный #2137 слиты через проектный процесс. Исправление Compose #2146
  прошло полный PR CI 43593000329 и queue CI 43594024930, включая native recovery обеих архитектур.
- Deploy Platform [43600305568](https://github.com/sachkov-inside/platform/actions/runs/43600305568)
  и Production access pass успешны. Независимый production:verify v81 успешен.
- Deploy Telegram [43600982354](https://github.com/sachkov-inside/platform/actions/runs/43600982354)
  успешен. Строгий production:verify v55 и минутное наблюдение прошли, error counters и unknown
  states не растут. Migration identity совпадает с v54.
- Необязательный отдельный Logto test app в локальном verifier не выбирался. Cohort не настроен;
  контракт допускает welcome без даты. Эти проверки не выдаются за выполненные.

Первая copy-only попытка остановилась до живого обновления RabbitMQ: network none не создал запись
hostname. Исходный сервис восстановлен, maintenance 13:00:37–13:06:53 UTC, 376 секунд.
После добавления loopback mapping новая native проверка копий прошла.
Второй интервал 13:14:02–13:24:25, 623 секунды. Внутри него ошибочный `--repo` у `check`
исправлен на проверку всех repositories одним вызовом; оба прошли. Журнал отказа сохранён,
continuation не повторял конверсию. Maintenance Platform 13:33:16–13:34:04, 48 секунд.
Telegram journal отмечает всю операцию 13:41:26–13:41:36, 10 секунд; отдельный интервал недоступности
в этом контракте не измеряется. Время доступности между окнами не включается в downtime.

После foundation новым writer 2.60 создан full `20261114-132615F`. Он восстановлен native 18.7/2.60
в 13:30:53 UTC до application migrations, все три БД прошли проверки. Предшествующие настоящие backups
также восстановлены новым restorer. Изоляция: network none, без портов, отдельный UUID volume,
512MiB/1CPU/128PIDs, удаление ресурсов подтверждено. Проверки доступности и базовых таблиц
не являются построчным сравнением всех исторических записей. После обоих application rollout создана копия `20261114-132615F_20261114-140016I` writer 2.60.0.
Её native restore завершился в 14:04:49 UTC: все три БД прошли проверки, сеть и порты отключены,
временные контейнеры и том удалены с подтверждением отсутствия. Остальная очистка ресурсов
фиксируется в lock #2144.

На контрольной точке после выкладки и qemu update: 12 healthy, available 1491 MiB, swap нет.
Периодические проверки и отдельные результаты в lock имеют свои timestamps.

## Security и ограничения

Свежая Trivy DB от 14.11.2026 07:01 UTC: фактические amd64 backend (OS 19 + Node 242 packages),
web (OS 19 + Node 22), Telegram (OS 19 + Node 143) и PostgreSQL дали ноль findings.
Logto сохраняет две разобранные medium Router findings. RabbitMQ сообщает zlib medium;
точный amd64 child имеет source/binary доказательство not_affected, не blanket-исключение других arch.

Caddy сохраняет 10 package rows (2H/6M/2unknown), Compose 5.7.1 пять rows (1H/3M/1unknown)
и отдельную находку включённых compress symbols по govulncheck. Новая OTel CVE учтена по нескольким
modules; активный Caddy не содержит tracing handlers/config или OTEL env. Это не доказательство
полной недостижимости всех sdk/log функций. Security review допускает текущие границы, сохраняя
остаточный риск и пересмотр до включения новых telemetry inputs либо при выходе исправленных binaries.
Подробности и первичные источники в lock #2144 и [Compose toolchain](compose-toolchain.md).

Остаточные находки учебных Debian/TypeScript images, Mailpit и CI builder сохраняются в аудитах,
не объявляются исправленными по одному pnpm audit. Ограничение #1627 сохранено:
`rngFailureVerified=false`, историческое качество subkeys не установлено; STOP на эксперимент
и обход его границ не отменён. Обычный upgrade и backup не выдаются за успешный RNG failure test.

## Завершение полного обновления 14.11.2026

После первого этапа независимая сессия под [lock #2151](https://github.com/sachkov-inside/platform/issues/2151)
выпустила Telegram v56 и отключила email-вход в существующей настройке Logto. Финальный этап #2117
сохранил это состояние. Текущий Telegram source `9a8751f07777e2c1575fcf4eea705fd5d3130134`,
digest `bf7b0f26ce1b1b14cbdfa5a3e29a496dd57846ec09dd05667e0075f97458536d`.
Его publication [43603769894](https://github.com/sachkov-inside/platform/actions/runs/43603769894)
и deploy [43606890220](https://github.com/sachkov-inside/platform/actions/runs/43606890220) успешны.
Platform остаётся v81. Новые изменения других задач из main не выпускались этой сессией.

[PR #2150](https://github.com/sachkov-inside/platform/pull/2150) обновил CI Buildx до 0.39.0
и BuildKit до 0.35.0 с проверкой фактически выбранного builder. PR CI 43603945239 и queue CI
43605020460 прошли: по 32 успешные проверки и два предусмотренных покрытых пропуска.
Это изменение инструментов CI, отдельного application release оно не требует.
Остаточные находки официального builder сохранены в [его аудите](image-builder.md).

[PR #2155](https://github.com/sachkov-inside/platform/pull/2155), merge
`bdcdf47d65f10ca92a5f45439d932bd9a3184bc4`, закрыл дополнительный пропуск собственных Go manifests.
Модули Gosu обновлены до user 0.5.0 и x/sys 0.50.0. Reviewed head
`7b441610bc41ae5078096b9365d65d433bfa69c2`; PR CI 43607827665 и
[queue CI 43609348479](https://github.com/sachkov-inside/platform/actions/runs/43609348479)
прошли по 32 проверки с двумя покрытыми пропусками. Queue checkout совпадает с merge SHA.
Native backup/recovery и broker jobs прошли на amd64 и arm64. Подробности в [Go-аудите](gosu-modules.md).

### Последняя замена PostgreSQL helper image

Операция выполнена под новым [lock #2159](https://github.com/sachkov-inside/platform/issues/2159).
После создания выдержаны 30 секунд и повторно проверены locks и четыре production workflow.
Источники, операторы и native archive привязаны SHA-256 к merge #2155. Archive SHA-256
`baf9d5612592c926e027b9e538756e2f1619d4ac1a3025de2d0c9f1b85b75113`.
Работающий image теперь `2d598f70d4c399d09a1b7d7d2d82cec90f7df39351f78434cfc43420a9959f91`.
Это замена helper при тех же PostgreSQL 18.7 и pgBackRest 2.60.0.
Прежний `e316e421…`, его архив и отдельный rollback tag сохранены.
Хеш работающего ELF Gosu совпал с проверенным amd64 binary:
`aac64fc54ec495f697cde6d86019fdf4bdffe4ddcd4b89167c2809cf71e332eb`.

Каждая backup/restore-фаза запускалась отдельной systemd unit с canonical supervisor.
На настоящем сервере подтверждены PPID1 владельца и удержание обеих operation.lock.
Четыре локальных сценария, включая смерть тела/владельца и отказ удаления чужого ресурса,
использовали подставные Docker/systemctl;
они не выдаются за эксперимент с убийством SSH или systemd на production.
Units завершились success, `bodyExitCode=0`, `cleanupConfirmed=true`.
Таймаут аварийной очистки не обрывает ожидание действующего backup.

До окна создана копия прежним writer `20261114-132615F_20261114-160927I`.
Новый image восстановил её в 16:10:54 UTC. После замены фактический новый writer создал
`20261114-132615F_20261114-161814I`; её восстановление завершилось в 16:19:41 UTC.
В обоих случаях проверены `inside`, `logto`, `inside_telegram`; отдельный UUID volume,
network none, ноль опубликованных портов, 512 MiB/1 CPU/128 PIDs. Отсутствие временных контейнеров
и томов после удаления проверено. Восстановление не выполнялось поверх рабочего тома.

Первый apply остановился до journal/preimages и обслуживания. Guard ожидал operations-сервис
в модели Compose без соответствующего профиля. Чтением также выявлена явная null-семантика
наследуемых Entrypoint/Cmd/User. Исправления повторно прошли Standards, Spec и security review;
эффективная модель и все сохранённые foundation inputs проверены до повторного запуска.
Прежние operator/binding bytes и журнал отказа сохранены. Эта попытка не добавила downtime.

Успешное окно 16:15:20–16:17:35 UTC, 135 секунд. Пересоздан только PostgreSQL.
Сохранены рабочий том, сети, полное окружение и политики запуска, private pgbackrest.conf,
семь закрытых env/policy inputs, IDs/images всех клиентов и состояния application deployments.
Хеш `sign_in_experiences` Logto совпал до и после. Доступность восстановлена до проверки всех
backup repositories; `check` прошёл без `--repo`, таймеры возвращены в active.

Контроль 16:20:33 UTC: все 12 контейнеров healthy, HTTP 200, `dpkg --audit` чист,
reboot не требуется. Available memory 1556 MiB из 3910 MiB, swap нет, корневой диск занят на 52%.
Старые custom images, cold RabbitMQ copies, закрытые preimages и recovery archives сохранены.
Чужие worktrees и зарезервированный локальный стенд не изменялись.

Platform production:verify v81 прошёл после замены. Строгие проверки Telegram v56 прошли.
Первое дополнительное наблюдение 16:17:56–16:18:57 не прошло условие пустой очереди:
community_due 4→1, возраст 0.715→0.015 секунды. Ошибок обработки и рестартов не было.
Диагностика десятью read-only samples за 30 секунд показала периодическую обработку заданий,
максимальный возраст 0.472 секунды и нулевые счётчики ошибок. Новое наблюдение
16:20:18–16:21:18 прошло все пять условий без перезапуска: due/age/unknown равны нулю,
backlog 7 равен семи проверенным приглашениям, ожидающим добровольного вступления.
Первый отрицательный результат сохранён. Данные, задания и счётчики не менялись вручную;
новый Telegram deploy не потребовался.

Финальная проверка 16:22:12 UTC подтвердила все 12 healthy, HTTP 200, свободные серверные
блокировки и отсутствие собственных временных restore-ресурсов. Available memory 1600 MiB,
swap не используется. Lock #2159 закрыт с результатами. Ограничения security и #1627 из этого
отчёта остаются в силе. Это завершённое обновление, а не перенос работы в Workspace.
