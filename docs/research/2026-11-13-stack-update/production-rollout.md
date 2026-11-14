# Применённое состояние production, #2117

14 ноября 2026 выпущены [Platform v81](https://github.com/sachkov-inside/platform/releases/tag/v81)
и [Telegram v55](https://github.com/sachkov-inside/platform/releases/tag/telegram-v55).
Владелец разрешил merge, публикацию и production в этой проектной сессии. Все новые операции
на сервере выполнены под [lock #2144](https://github.com/sachkov-inside/platform/issues/2144).
Исходная ошибка прежней сессии, обновление ОС без lock, не переименовывается в соблюдённый процесс.

## Версии и владельцы

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
