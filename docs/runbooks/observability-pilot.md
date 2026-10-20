# Пилот наблюдаемости Platform

Статус на 19.10.2026: подготовлен исполняемый **кандидат** первого технического smoke
для [#1566](https://github.com/sachkov-inside/platform/issues/1566) /
[принятой спецификации #1565](https://github.com/sachkov-inside/platform/issues/1565).
Текущий синтетический Mac core source `525f71d1` прошёл с новым Alloy privacy config:
accessible-field sentinels и SDK-shaped links, закрытые receiver/exporter counters, restart,
read-only/revocation и три native Victoria MCP с изолированным CPU. Worker exit 0, monitor
не отказал, cleanup PASS, собственных containers/volumes/networks осталось 0; чужой stand сохранён.
[Точное evidence](https://github.com/sachkov-inside/platform/issues/1566#issuecomment-6276818970)
и [границы collector proof](collector-privacy.md#проверка-и-доказательства).
Это не общий PASS source `525f71d1`: fresh-carrier PostgreSQL case с 240-секундным timeout
остаётся открытым. Actual SDK wire/protobuf, произвольные link metadata и full resource/spec
acceptance не закрыты. Ниже сохранены успешные запуски предшествующего контура.
Функциональный Linux smoke прошёл на sources `a087bb271` и `14faa9904`:
[run 39288942467](https://github.com/sachkov-inside/platform/actions/runs/39288942467),
[run 39289463842](https://github.com/sachkov-inside/platform/actions/runs/39289463842).
На Mac source `3bd70d3398a2341d0fd619e1a796b822edcfd0a8` весь core smoke прошёл:
три native Victoria MCP прочитали известные fixtures, identity/storage monitor и cleanup завершились
успешно. Кураторские доказательства сохранены в `.reports/observability-1566/mac-3bd70d33`.
В этом запуске отдельный native CPU ещё был unavailable. В последующем Mac core запуске source
`b708afe1` новый изолированный helper измерил CPU: VM 14.702612s, VL 1.810982s, VT 0.319836s;
известные fixtures, совместимость и cleanup прошли. Это не full resource acceptance.
История: source `507ed39c` также прочитал fixtures, но остановился из-за
VM identity monitor; diagnostics/down/residue прошли, а отклонённый sample тогда не сохранялся.
Production не менялся; аналитика не включалась.
Этот smoke не является полным ресурсным пилотом или выполнением спецификации.
Подготовленный доменный отчёт Platform MCP описан в
[инструкции диагностики](production-diagnostics.md); его наличие не подтверждает rollout всего контура.

Linux и Umami runtime используют общий внешний supervisor, cleanup и storage policy.
На Linux перед первым приобретением фиксируются local Unix socket/inode, context, daemon ID
и DockerRootDir; перед mutation и recovery эта identity проверяется заново. Смена daemon
останавливает автоматическое действие и требует ручной проверки владельца. Umami сохраняет
собственные services/project prefix, private configuration и whitelist доказательств; её
процедура описана в [отдельном runbook](observability-umami-pilot.md).

## Подготовка без установки

Из корня репозитория:

```bash
python3 scripts/observability-pilot/pilot.py preflight
python3 scripts/observability-pilot/pilot.py prepare
bash scripts/heavy-check.sh node --test scripts/observability-pilot.test.mjs
pnpm docs:check
```

`preflight` сообщает место **на файловой системе checkout**, не измеряет Docker VM и не
подтверждает готовность Docker. При недостатке места возвращает 2. `prepare` создаёт
случайный каталог `.reports/observability-pilot-*`, Compose JSON, временный query key и
Grafana datasources. Ничего не скачивает и не запускает. Каталог содержит только тестовый
ключ, не production credentials. Его можно удалить после просмотра.

Конфигурация и public release metadata закреплены в
[inputs.lock.json](../../infra/observability/pilot/inputs.lock.json). OCI index digests получены
19.10.2026 из publisher Docker Registry API; Caddy повторяет существующий pin из
[scripts/fixtures/production-runtime/compose.smoke.yaml](../../scripts/fixtures/production-runtime/compose.smoke.yaml).
Artifact SHA256 предоставлены GitHub Releases; runner проверяет архивы перед распаковкой.
Publisher releases: [Grafana 13.2.4](https://github.com/grafana/grafana/releases/tag/v13.2.4),
[Alloy 1.21.0](https://github.com/grafana/alloy/releases/tag/v1.21.0),
[VictoriaMetrics 1.154.0](https://github.com/VictoriaMetrics/VictoriaMetrics/releases/tag/v1.154.0),
[VictoriaLogs 1.53.0](https://github.com/VictoriaMetrics/VictoriaLogs/releases/tag/v1.53.0),
[VictoriaTraces 0.12.0](https://github.com/VictoriaMetrics/VictoriaTraces/releases/tag/v0.12.0).
Это происхождение inputs, а не доказательство совместимости.

Для каждого asset закреплён `size_bytes` из GitHub Releases. Downloader читает не больше
этого размера плюс один байт и требует точного размера и SHA256; дополнительный предел
сжатого содержимого архива — 128MiB.
У VictoriaLogs datasource v0.33.1 опубликованный ZIP занимает 79,389,151B и превышает прежний
общий предел 64MiB. Проверенная по закреплённому digest центральная директория ZIP содержит
45 entries общим распакованным объёмом 224,056,733B; крупнейший entry — 28,246,176B.
Эта проверка 19.10.2026 читала архив в памяти, без распаковки или выполнения. Точный
`unpacked_size_bytes` закреплён отдельно; перед распаковкой требуется совпадение, в пределах 256MiB.
Сумма compressed/unpacked размеров этого plugin — 303,445,884B, внутри общего growth cap 4GiB;
расход images и всего workload по-прежнему проверяется самим пилотом.

## Права процессов при запуске

Временный `auth.json` сохраняет режим `0600`. `prepare` читает UID/GID этого файла и задаёт
их процессу vmauth: иначе root контейнера после `cap_drop: ALL` не может прочитать файл,
принадлежащий другому UID на Linux. `DAC_OVERRIDE` не добавляется.

У закреплённого vendor binary Caddy есть file capability `cap_net_bind_service=ep`.
Если убрать её из bounding set контейнера, ядро отказывает в выполнении binary ещё до чтения
Caddyfile. Поэтому только `gateway` получает `NET_BIND_SERVICE` поверх `cap_drop: ALL`.
Остальные capabilities остаются сняты; `no-new-privileges`, read-only filesystem, лимиты,
порт `8080` внутри контейнера и публикация только на loopback сохраняются.

Изолированные проверки закреплённых amd64 images подтвердили чтение конфигурации vmauth
под владельцем файла и `caddy validate` с этой единственной capability. Это проверка запуска
отдельных компонентов, а не успешный полный smoke или подтверждение ресурсного запаса.

## Изолированный запуск

Нужны Linux Engine с локально доступным `DockerRootDir` либо Mac arm64 с уже работающим
OrbStack, Docker Compose, Git, Python 3.9+ и сеть для получения pinned images/artifacts.
Checkout должен быть чистым и закоммиченным. Короткий core smoke на OrbStack проверен:
core Mac smoke прошёл на sources `3bd70d33` и `b708afe1`; во втором проверены отдельные CPU records.
Новый privacy config требует нового supervised smoke. Остальные Darwin/context combinations
отклоняются до получения images.

```bash
bash scripts/heavy-check.sh python3 scripts/observability-pilot/pilot.py run
```

Запуск не использует production env, volumes, порты или Compose project. Проект получает имя
`inside-observability-pilot-<random>`. Сеть `pilot` остаётся internal: metrics, logs, traces и vmauth
подключены только к ней, без опубликованных портов. Только gateway, Alloy и Grafana, чьи порты
опубликованы на `127.0.0.1`, дополнительно подключены к собственной bridge-сети `ingress`.
В изолированной проверке закреплённого Caddy контейнер только в internal-сети работал, но
Docker port mapping отсутствовал и запрос к host loopback получал отказ соединения. Добавление
отдельной ingress bridge-сети восстановило mapping и HTTP-ответ. `ingress` разрешает этим трём процессам также
исходящие соединения; остальные процессы остаются в изолированной сети. Обе сети принадлежат
одноразовому Compose project и удаляются его cleanup. Занятые порты приводят к отказу.
Другой `inside-platform` сохраняется: его работа записывается в evidence как посторонняя нагрузка.
Такая среда не доказывает ресурсный запас production.

Публикуются только loopback:
- `14318`: fixture OTLP ingress Alloy без production auth, только синтетические данные;
- `18427`: Caddy → vmauth, query key;
- `13000`: Grafana anonymous Viewer для временного локального обзора.

Backend ports хранилищ и vmauth не публикуются. Fixture ingress не защищён от другого
пользователя того же хоста; это **не production read-only boundary**. Тестовый ключ
проверяет запреты на query ingress. Перед production нужна отдельная изоляция write ingress
и проверка прямых сетевых обходов. Нельзя направлять сюда персональные данные или реальные секреты.

Caddy разрешает GET/POST, vmauth — отдельный
[каталог query routes](../../infra/observability/pilot/vmauth.routes.json).
Неизвестные пути не имеют fallback backend. В закреплённом vmauth нет `src_methods`:
[исходник 1.154.0](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/v1.154.0/app/vmauth/auth_config.go)
определяет paths/hosts/query/headers; методы ограничивает Caddy.
[Правила нормализации Caddy](https://caddyserver.com/docs/caddyfile/matchers#path)
проверяются отрицательным корпусом, а не предположением о raw URI.
Запросы ограничены 64KB, ответы harness — 1MiB, backend query duration — 8s;
vmauth concurrency — 2 на ключ / 4 суммарно. Это начальные ограничения smoke.

## Что делает smoke

Runner ждёт принятия пустого OTLP запроса Alloy, затем отправляет синтетические
OTLP metrics/logs/traces, читает известный
log и trace через query API, выполняет обязательный read POST, отрицательные проверки
auth/method/mutation/encoded traversal, перезапускает Alloy, дожидается сохранения нового
уникального trace через защищённый Jaeger API и отзывает временный ключ.
Пять spans HTTP → publish → attempt → retry → dependency **сгенерированы fixture**;
это не доказательство передачи контекста SDK/настоящей очередью/worker.

Три native Victoria MCP скачиваются с проверкой SHA256 и запускаются по stdio на платформе runner
(Linux либо Darwin arm64 для OrbStack):
initialize → tools/list → query известного fixture. Tools discovery сохраняется; stderr не сохраняется.
На Darwin/Linux каждый native MCP запускается через stdlib helper `native_cpu.py`, который создаёт
только этого ребёнка и вызывает `Popen.wait()`. После reap он читает свой kernel
[`RUSAGE_CHILDREN`](https://docs.python.org/3/library/resource.html#resource.RUSAGE_CHILDREN):
учитывается CPU native процесса и тех потомков, чей расход ядро включило после их завершения/reap.
CPU самого helper, параллельных Compose/storage-probe процессов и остального pilot не включается.
Это не замер полного дерева с неубранными или detached потомками и не полный resource corpus.
`os.wait4()` параллельно с `Popen.wait()` не используется.

Закрытый private pipe переносит максимум 512 bytes с exact schema и конечными неотрицательными
user/system CPU seconds; native executable не наследует этот descriptor. Данные принимаются только
после EOF, сумма имеет sanity ceiling 86 400 секунд. Повреждение, неполный record, отсутствующие
данные или неуспешный reap оставляют `cpu_seconds: null`, `cpu_measurement: unavailable`; значения
среды, argv, пути, stderr и тексты ошибок туда не попадают. Весь helper/native остаётся в группе
внешнего supervisor; protocol response сохраняет прежний предел 1 MiB и 15 секунд. Helper имеет
60-секундный lifetime; после запроса остановки даёт 0,25 секунды на TERM и 0,5 секунды на reap после
KILL; аварийная уборка helper повторяет KILL/reap с тем же 0,5-секундным сроком. Родитель ограничивает wait helper двумя секундами и затем KILL/reap ещё двумя.
`isolated_reaped_child_cpu` описывает только измеренный интервал, без утверждения о запасе хоста.

Core снимает CPU-pending только при трёх корректных Victoria records; Umami — при своём одном.
Остальные missing/resource acceptance пункты сохраняются. Старые evidence не пересчитываются;
четыре native Mac MCP уже получили корректные изолированные records на source `b708afe1`,
при byte-identical runtime inputs integration `b33d7a52`:
[точное evidence](https://github.com/sachkov-inside/platform/issues/1566#issuecomment-6274516488),
curated SHA256 `b9fba18421c78d73a672d97d23eb9670b89abf21332b57132b781a7d4b0e73df`.
Полный ресурсный пилот остаётся обязательной отдельной проверкой;
общую сумму дочерних процессов нельзя выдавать за расход одного MCP. Umami использует тот же
изолированный CPU-канал для своего одного native MCP.

## Admission для Mac/OrbStack

Точка входа та же: только guarded `pilot.py run`, не `worker`. Никаких Linux machines
создавать не нужно. Другие контейнеры OrbStack остаются посторонней нагрузкой.
[OrbStack FAQ](https://docs.orbstack.dev/faq) объясняет: `~/OrbStack` — представление данных,
а не backing filesystem. Runner требует context `orbstack` и локальный socket текущего
пользователя, идентифицирует единственный открытый OrbStack Helper файл `data.img.raw` через
`lsof` metadata и сохраняет canonical path/device/inode. Socket, daemon ID и DockerRootDir
также закрепляются. Runtime Docker commands используют явно закреплённый socket; смена
контекста, endpoint, daemon или backing identity даёт отказ. Docker endpoint overrides не допускаются.

До приобретения probe/image проверяется минимум 16GiB на host filesystem backing image,
checkout и отчётов; разные filesystems измеряются отдельно. Внешний public supervisor
запускает независимый host monitor каждые 250ms **до bootstrap**. Сохраняются пределы
10GiB floor, общий 4GiB growth cap и 2GiB cleanup headroom; stop margin — 256MiB.
Проверяются также реальные allocated blocks sparse image, а не apparent size.
Daemon/socket/backing identity проверяется отдельно, чтобы metadata commands не задерживали
быстрые host measurements. Любая потеря или смена identity прерывает собственный worker.

Внутренний VM filesystem нельзя выдать за `/var/lib/docker` на host. До его измерения
разрешён только ограниченный bootstrap preflight, **не admission всего пилота**:
[probe.lock.json](../../infra/observability/pilot/probe.lock.json) закрепляет publisher
[Docker Official Image BusyBox](https://github.com/docker-library/busybox), `1.37.0-musl`,
отдельный Linux arm64 OCI manifest, config и единственный gzip layer. Проверенные 19.10.2026
размеры: 899,665B compressed / 1,853,440B unpacked. Manifest/config/layer и распакованный layer
проверяются по точным размерам/digests и config diff ID в памяти до `docker pull`.
Пределы входов — 2MiB compressed / 4MiB unpacked. Bootstrap получает отдельный sampled host
рост не более 32MiB **внутри прежнего 4GiB cap**, включая metadata; это кандидат бюджета,
а не измеренный расход Docker и не hard quota. Нет предположения о cached image.
Bootstrap acquisition имеет timeout 60s; public worker deadline остаётся 10 минут.
Если metadata/budget/identity не проверены, полного workload не будет.

До pull регистрируется тот же случайный Compose project и внешний supervisor. Probe service
`storage-probe` входит в этот собственный project. Он non-root, read-only, без сети,
capabilities, Docker socket и privileged mode, с 16MiB memory / 0.05 CPU / 8 pids. Единственный
read-only bind — подтверждённый daemon DockerRootDir; missing path не создаётся. Фиксированная команда `stat -f` выполняется отдельным `compose exec -T` только в собственном
probe с паузой 250ms после завершённой попытки измерения. Это не гарантированный период опроса 250ms.
Каждый запрос несёт новый случайный challenge, который должен вернуться
в единственном ответе с filesystem ID/type, fundamental block size и counters. Старые или
буферизованные logs не читаются. На ответ от нового процесса отводится максимум 1s,
проверяемая также host monotonic clock; отрицательная/слишком большая длительность либо
несовпавший challenge отвергаются. Сравнение wall clocks Mac и VM не требуется. Первый такой
свежий VM sample должен подтвердить те же 16GiB перед установкой plugin или стартом остальных
services. Identity, floor и growth VM далее контролируются отдельно от host. Потеря ответа,
malformed/oversized output, отказ probe или смена identity приводят к cleanup. Чужой `exec`
не используется. Время/число verification requests учитываются отдельно; их CPU пока явно
unavailable и не выдаётся за CPU native MCP или resource acceptance.

VM identity закрепляет filesystem ID, размер блока и тип. Поле total blocks проверяется
как текущий счётчик ёмкости, а не identity: [statfs(2)](https://man7.org/linux/man-pages/man2/statfs.2.html)
описывает `f_fsid` и `f_blocks` отдельно. Рост или уменьшение total сами по себе не означают
замену filesystem. Каждый sample по-прежнему требует положительной ограниченной ёмкости,
`0 <= available <= total`, прежнего 10GiB floor и прежнего 4GiB growth cap от initial free.
Рост total не сбрасывает initial free и не компенсирует нарушение свободного места.
Дополнительно рост `(total - available) * block` относительно первого VM sample ограничен
тем же 4GiB cap с прежним stop margin 256MiB: увеличение ёмкости не может скрыть рост
недоступного места при неизменном free. В snapshot сохраняются initial/current unavailable
bytes. Этот консервативный счётчик включает зарезервированные блоки и чужую нагрузку;
его нельзя выдавать за фактический объём записей пилота. Прежний контроль потери free
сохраняется, в том числе при уменьшении ёмкости или изменении reserved blocks.

Каждый foreground `exec` остаётся в группе worker. Public supervisor останавливает всю эту
группу перед `down --volumes --remove-orphans`; diagnostics, down и residue checks независимы
и охватывают probe вместе с core. Сигналы обоих host monitors только фиксируют failure в
supervisor: bounded wait loop прекращает acquisition, а mandatory cleanup/outcome не
прерываются этими сигналами. Ошибка monitor или cleanup сохраняет ненулевой exit status.
Перед каждым cleanup step и каждой Docker mutation сверяются socket/backing/daemon identity.
При несовпадении мутации запрещены: replacement daemon/volumes не трогаются, owner record и
failed outcome сохраняются для ручного восстановления исходного окружения. Тесты с настоящими локальными процессами и Docker doubles
проверяют success, failure, timeout, SIGTERM и SIGKILL, fresh challenge requests, завершение
зависшего процесса ответа и сохранность foreign resource. Отдельные регрессии проверяют
monitor signals внутри down и replacement identity между diagnostics и down. Это не Docker/OrbStack runtime evidence. Полная потеря supervisor/host
сохраняет прежнее ограничение ручного exact-owner recovery. Recovery также сверяет OrbStack
identity и использует закреплённый socket; при несовпадении отказывает. Для recovery нужна ровно
одна полная запись Linux или OrbStack identity. Отсутствующая, пустая, повреждённая или
неоднозначная запись запрещает cleanup до обращения к Docker; fallback на текущий daemon нет.

`storage-host.json` и `storage-vm.json` содержат только начальные/последние числовые измерения
и filesystem identity, без backing path, socket, env, argv или raw errors. Они включены
в curated upload allowlist. `monitor-failure.json` сохраняет первую причину отказа до сигнала:
источник `host` / `identity` / `vm`, фиксированную категорию exception и фиксированный reason.
При смене VM identity дополнительно сохраняются только фиксированные имена изменившихся полей
и проверенные числовые counters предыдущего и отклонённого samples. Значения filesystem ID
и типа в эту диагностику не копируются.
Сообщения исключений, команды, paths и payload в него не попадают; последующий отказ не
перезаписывает первый. Если исходный отказ произошёл до этой диагностики, его причина остаётся
неизвестной. Файл создаётся с режимом `0600` и включён в curated allowlist.
Если запись evidence запрещена или место закончилось, остановка всё равно выполняется:
наружу выходит только категория исходного отказа и фиксированная отметка недоступности записи,
без текста исключений и без необработанного исключения фонового потока.
Shared image cache не удаляется; размер acquisition учитывается
в бюджете. Совместное выполнение с foreign stand не доказывает capacity Timeweb или 25% запаса.

## Проверка на GitHub-hosted Linux

[Observability functional pilot](../../.github/workflows/observability-pilot.yml) запускает
тот же публичный supervisor на `ubuntu-24.04` при изменениях пилота или его workflow в PR
к `main`. Это дополнительная функциональная проверка; обязательный `CI Gate` и его покрытие
не меняются. Workflow не использует secrets, production, self-hosted или larger runners.
Checkout и upload-artifact закреплены теми же commits, что Application CI; checkout не сохраняет credentials.
Установка Node.js/pnpm и зависимостей для этого job не нужна.

Сначала выполняются локальные process/loopback contracts, затем записывается фактическое
свободное место на файловой системе Docker. 16GiB admission сохраняется. GitHub гарантирует
стандартному Linux runner только [14GB SSD](https://docs.github.com/en/actions/reference/runners/github-hosted-runners);
наличие 16GiB нельзя предполагать. Недостаток места даёт отказ с artifact, без `prune`, изменения
порога или покупки другого runner. Это отдельный проверяемый результат, не пропуск ресурсной проверки.

`source.json` различает фактический checkout SHA/tree и provider PR head SHA, а также хранит
repository, run ID/attempt и SHA256 входов. Для PR checkout обычно является synthetic merge commit;
его нельзя выдавать за branch head. Из приватного каталога результатов копируются только явно
перечисленные ограниченные JSON/JSONL: source/admission, итог, cleanup/recovery, native MCP discovery,
query timings и короткие stats/phase snapshots. Auth/datasources JSON, binaries/plugins и raw collector
errors не загружаются; symlink под разрешённым именем отклоняется.

Для разбора startup/ingestion failures сохраняется `readiness.json`: имя этапа, число попыток,
исход, последний HTTP status либо тип transport error. URL, response body и текст ошибки туда
не входят. `container-states.json` содержит только известный service, state, health и exit code;
первый успешный snapshot до shutdown сохраняется при последующем recovery. Command, env,
labels и raw error text исключены до записи и публикации.

После шага запуска `always()` выполняет best-effort recovery только зарегистрированного случайного
проекта. Значение project/cwd проверяется, команда Compose конструируется заново; argv из owner JSON
не исполняется. Если worker или его process group ещё существует либо регистрация неполна,
recovery отказывает, чтобы
не опережать продолжающийся `up`; после завершения job остаётся утилизация disposable VM провайдером.
Обычные выходы/timeout/signals по-прежнему обслуживает собственный supervisor.

Зелёный hosted smoke подтверждает только проверенный синтетический Linux сценарий этого source.
Он не доказывает запас Timeweb VPS, полный согласованный resource workload,
аналитическую часть, production rollout или семь суток наблюдений. Первый фактический запуск workflow
и его artifact должны быть отдельно записаны в #1566.

## Короткие измерения smoke

Для фаз idle/steady/spike сохраняются Docker stats snapshots, длительность короткой серии,
query latency и состояния контейнеров перед остановкой. Это 0/10/50 цепочек, **не** согласованный
длительный workload, baseline приложения или расчёт тарифа. Runner не объявляет ресурсные
критерии пройденными по сумме limits. Limits семи сервисов составляют 3584MiB/1.9CPU;
это экспериментальный потолок, не измеренный расход, и PostgreSQL/Umami сюда ещё не входят.

## Место и остановка

No-build smoke допускается при 16GiB на идентифицированной файловой системе Docker:
10GiB обязательного host floor из
[локального runbook](local-development.md#start-from-a-fresh-clone),
4GiB ограниченного роста этого запуска и 2GiB на остановку/очистку.
4GiB — выбранный защитный cap, не замер потребления.
20GiB из local stand относится к build; здесь build отсутствует.
25% запаса приложения из #1565 относится к итоговому workload и не означает требование
освободить четверть всего Mac-диска перед smoke.

Во время запуска монитор проверяет место каждые 250ms и начинает остановку за 256MiB
до host floor или growth cap. На занятом хосте учитывается общий расход, поэтому чужой рост
тоже может безопасно прервать пилот. Docker VM quota и физическая изоляция partition
этим не доказаны; для resource acceptance они остаются открытыми.

Публичная точка входа `run` — supervisor: до acquisition он записывает точный случайный проект
и cleanup, затем запускает внутренний worker в отдельной process group. Прямой запуск
`worker` без зарегистрированного родителя не поддерживается. После успеха, ошибки, timeout,
SIGTERM или SIGKILL worker supervisor ограниченно останавливает всю его группу **до**
`down --volumes --remove-orphans` и проверяет отсутствие только своих containers/volumes.
Сбой diagnostics не пропускает shutdown; оба residue check выполняются независимо.
Исходный exit code worker сохраняется при успешной очистке; ошибка очистки явно завершает запуск.

Локальные process fixtures проверяют эти пять исходов, остановку оставленного дочернего
процесса с игнорированием SIGTERM и сбой diagnostics без Docker;
реальное успешное удаление Docker resources подтверждено текущим Mac core `525f71d1`.
Это не Docker fault-injection proof для каждого из перечисленных аварийных исходов. SIGKILL самого supervisor, уничтожение
всего внешнего дерева и отключение машины требуют ручного восстановления. В `owner.json`
заранее записана точная команда cleanup; `worker.json` содержит PID/group и supervisor PID.
Не применять `docker system prune` и не удалять чужие volumes/images.
Скачанные pinned images остаются общим Docker cache.

Evidence находится в `.reports/observability-pilot-*/evidence.json` вместе с source SHA,
именем проекта, native MCP, stats и query timings. Временный query key удаляется после
остановки; raw logs/collector error payloads не собираются. Для приёмки сохранить нужные
нечувствительные результаты в issue #1566 с SHA и фактическими exit codes.

## Открытая приёмка всей спецификации

После успешного core smoke по #1565 ещё обязательны:

- Полный resource corpus: успешный synthetic core `525f71d1` с новым collector privacy config
  и Mac stdio/CPU proofs Victoria/Umami не заменяют эту проверку.
- SDK всех production процессов, реальная HTTP/queue/retry/worker/dependency корреляция,
  отдельные попытки, SQL/HTTP latency и release comparison.
- PII/sentinel во всех storage/MCP/collector/browser/exporter путях; ограниченная cardinality.
- Freshness/sampling/drops/gaps/reset, полный HTTP counter независимо от traces.
- Настоящий baseline приложения, idle/steady/spike/restart/cleanup, повторения и retention corpus;
  RAM/page cache/CPU seconds/IOPS/volumes/query lag и latency под одновременным приёмом;
  отсутствие OOM/ENOSPC/необъяснённых потерь, lag≤60s, query≤10s, HTTP p95 overhead≤5%,
  average дополнительный CPU≤10% хоста, запас памяти/диска приложения≥25%.
- Целевые event-time windows 14/90/365 суток, реальная очистка с lag, disk isolation,
  Umami PostgreSQL/pgBackRest и isolated restore с актуальными удалениями.
- Platform MCP через владельцев бизнес-фактов с platform:admin и continuation.
- Каталог аналитики, Moscow boundaries, dedup/distinct/unknown, tracker OFF до новых legal
  редакций и принятого Storybook proof пути согласия. Текущий storage-notice не является согласием.
- Обзор владельца, проверенные обновление/откат и при необходимости SigNoz по тому же workload.
- Независимые review/security/checks; отдельно порученный production rollout и семь суток наблюдений.

Ни этот документ, ни зелёные preparation tests не закрывают #1566.

### Короткое сравнение реального API с SDK OFF/ON

Первый resource runner находится в [runtime.py](../../scripts/observability-resource/runtime.py).
Это подготовленный исполняемый эксперимент. Первый запуск `3a501dca` завершился до измерений: API вышел с кодом 1, очистка собственного project прошла. Измерительных результатов пока нет.
Профиль [short-sdk-pair-v1](../../infra/observability/resource/profile.json) предложен для
синтетической проверки и не является принятой производственной нагрузкой.

Один случайный Compose project содержит текущие семь observability services, отдельный
PostgreSQL 18 foundation, одноразовые migrations, API, локальный JWKS double и генератор.
API/provider/loadgen доступны только во внутренней сети, без опубликованного API порта и
маршрута к внешним провайдерам. Коллектор присутствует в обоих режимах. Сравнение относится
к переключению SDK, не к цене всей observability stack. Web, workers, broker, Umami и MCP
в этот workload не входят. Production smoke и full-stack reset helpers runner не запускает.
Shared private env writer извлечён без изменения содержимого production configuration.

Локальный JWKS double использует HTTPS. Production API отвергает HTTP `LOGTO_JWKS_URL`
до открытия порта; исходная конфигурация `3a501dca` воспроизводимо нарушала это требование
при проверке настоящим `parsePlatformConfig`. Сохранённого stderr того запуска нет,
поэтому наличие дополнительных причин отказа не исключено.
Следующий запуск `fbbc4ebe` подтвердил работающий API, но также завершился до измерений;
прежний общий `api_off` не различал readiness, создание Account и protected GET.
Воспроизводимый contract test с настоящими `parsePlatformConfig`, remote JWT verifier
(HTTPS/fetch, generated CA, issuer и audience) и `accountResponseSchema` выявил отдельное
расхождение клиента: API возвращает `account.accountId`, а клиент ожидал `account.id`.
Тест проходил проверку JWT и получал `unexpected_response` на успешной форме POST `201`;
после исправления принимает POST `201` и GET `200`. Это тест реального verifier и схемы
через собственный loopback transport, без полноценного Nest application и PostgreSQL.
Исторические HTTP status/outcome запуска `fbbc4ebe` не сохранены, поэтому этот дефект
не объявляется единственной причиной фактического отказа.
Теперь `readiness.json` различает public readiness, establish и protected readiness
для каждого SDK mode. Отдельный `startup-client.json` сохраняет только закрытые stage/state,
фиксированный тип command failure либо проверенные label/outcome/HTTP status/elapsed time.
Token, Account ID, URL, request/response body и exception text/stack в него не попадают.
Файл записывается до cleanup и входит в whitelist public artifacts; неизвестная форма
sample отвергается без сохранения её содержимого. POST создания Account не повторяется.

Перед запуском требуется host `openssl`: стандартная команда создаёт отдельный однодневный
сертификат с единственным SAN `DNS:provider`, deadline 5 секунд. Ошибка генерации закрытая,
без вывода stderr. Свежий EC P-384 private key имеет mode `0600` и доступен только provider.
Публичный сертификат монтируется read-only только в API и подключается через
`NODE_EXTRA_CA_CERTS`; mode `0444` позволяет production пользователю `node` прочитать CA.
Host trust store, production HTTPS guards и проверка имени сервера не меняются.
TLS handshake ограничен 1 секундой, HTTP headers 1 секундой и request 2 секундами;
неполные соединения освобождают ограниченные четыре slots.
TLS private files исключены из public artifacts. После `down` и `residue=passed`
runner удаляет только известные TLS files; при неудачной очистке сохраняет их для recovery.
Следующий фактический запуск требует образа с новым точным Source SHA, отдельного review
этого исправления и coordinator-owned public supervisor. Старый образ не переименовывается
в образ нового source.

Профиль фиксирует две пары (`off,on`, затем `on,off`), прогрев 2 секунды и измерение 10 секунд
на режим, 10 запланированных запросов в секунду, один активный запрос и sample ratio 1.
Каждый режим содержит 100 measurement slots, по 50 на public `/library/site-index` и
protected `/accounts/current`. Один Account создаётся через настоящий API по локально
подписанному ES384 token с обычным сроком 300 секунд. Material corpus пустой. Это не проверка
поиска на 10 000 Material, очередей или принятой representative workload.
После медленного запроса generator отмечает пропущенные slots, не догоняет их всплеском.
Прогрев и measurement имеют отдельные samples. Перезапуск API, порядок и прогрев известны;
DB/cache/storage между режимами не сбрасываются, поэтому влияние предшествующей пары остаётся.

Для будущего reviewed запуска координатор готовит собственные cache images. Runtime принимает
только immutable image IDs, сверяет их с двумя тегами собственного cache owner, не строит и
не скачивает images. Backend `release-identity.json` должен содержать `release=v1` и точный
Source SHA текущего checkout; Node должен совпадать с `.node-version`. Foundation image ID
фиксируется отдельно, его source provenance не выводится из backend identity.
Пример формы private cache manifest (значения заменяются фактическими):

```json
{
  "schema": 1,
  "source": "<current full 40-character commit>",
  "owner": "inside-platform-production-smoke-cache-resource",
  "backend": "sha256:<64 lowercase hexadecimal characters>",
  "foundation": "sha256:<64 different lowercase hexadecimal characters>"
}
```

Теги должны быть `<owner>-backend:v1` и `<owner>-foundation:local`.
После independent review и подготовки cache images публичные команды такие:

```sh
bash scripts/heavy-check.sh python3 scripts/observability-resource/runtime.py run --output "$RESOURCE_OUTPUT" --images "$RESOURCE_IMAGE_MANIFEST"
python3 scripts/observability-resource/runtime.py recover --output "$RESOURCE_OUTPUT"
python3 scripts/observability-resource/hosted.py --output "$RESOURCE_OUTPUT" --public "$RESOURCE_PUBLIC_OUTPUT"
```

`RESOURCE_OUTPUT` должен быть новым каталогом своего запуска. Используется существующий внешний
supervisor с deadline 600 секунд, host/VM admission, growth/floor guards и cleanup ровно одного
проекта. Дополнительные ports и полномочия query gateway не появляются. Все новые mutations и
reads проверяют frozen daemon identity. Worker дополнительно проверяет project prefix, checkout,
зарегистрированные PID/group и внешний parent. Если daemon сменился, автоматический cleanup
отказывает, требуется осмотр ownership records. Чужой `inside-platform` не останавливается.

JSON сохраняет статус и измеренную конечную latency каждого начатого запроса, включая ошибки,
тайм-ауты и oversize. Общий HTTP deadline 1200 ms покрывает connect/headers/body даже при
постоянном поступлении bytes. При обрыве процесса сохраняется завершённый NDJSON prefix;
остальные slots получают `phase_aborted` без выдуманной latency. При SIGKILL всего worker
может остаться только внешний worker outcome; незавершённое окно не считается измеренным.
p95 считается nearest rank по фактическим samples. Парный overhead вычисляется отдельно для
каждого маршрута и пары, только при полном успешном прогреве/measurement и подтверждающем
post-phase SDK observation. Percentiles между парами не усредняются.

SDK observation делает один ограниченный read через прежний gateway. Проверяется timestamp
API request counter через фиксированный dotted metric `http.server.request.count` с quoted
label `"service.name"="platform-api"` и `latency_offset=1ms`, с учётом
[OTLP mapping VictoriaMetrics](https://docs.victoriametrics.com/victoriametrics/integrations/opentelemetry/).
Запрос и минимальный offset разделяют закрытые constants с paired diagnostic; число reads,
абсолютный deadline 8 секунд и response limit 64 KiB сохранены.
Граница `phase_started_seconds` фиксируется после завершения замены API и успешных
public/protected readiness, перед диагностикой ON и одинаковым прогревом/measurement.
Финальный sample прежнего ON-процесса во время замены не относится к следующему OFF-окну;
свежий sample после этой границы по-прежнему не соответствует OFF.
Новый sample в ON подтверждает активность экспорта; отсутствие нового sample в OFF относится
только к этому наблюдению. Это не доказательство отсутствия позднего экспорта или no-loss ledger.
Неизвестный/недостоверный результат не разрешает overhead claim.

Фактический короткий запуск `248c1315` завершил четыре режима по 100 успешных HTTP samples,
но оба ON observation вернули пустой результат; `partial` и подавление p95 overhead сохранены.
На том source selector предполагал underscore metric name и `service_name`, тогда как SDK
отправляет `http.server.request.count` и `service.name`. Последующая диагностика не меняла
этот selector или acceptance gates. Фактический source-bound запуск `80673cdd` получил
свежий raw dotted/service sample через `1ms` в обеих ON-фазах, тогда как default reads
остались пустыми или stale. Исправление основного observation использует этот подтверждённый
query contract. Критерии свежести и interpretation ON/OFF сохранены: stale/missing sample
не подтверждает ON, свежий sample не соответствует OFF, UNKNOWN не подтверждает ни один
режим. Даже доступный численный p95 относится только к короткой синтетической SDK-only
нагрузке; `acceptance=pending` и список непокрытого полного corpus сохраняются.

Только для ON runner собирает два закрытых snapshot: после protected readiness перед
measurement и после прежнего SDK observation. Каждый snapshot выполняет шесть фиксированных
GET queries через тот же gateway: legacy selector в поле `current`, underscore name без service filter,
dotted name без service filter, dotted name с quoted label `"service.name"`, collector
receiver accepted metric points и sent metric points точного metrics exporter.
Результаты содержат только агрегатные числа или UNKNOWN. Имя сервиса фиксировано;
raw series, label maps, тела ответов, token, URL и error text не сохраняются.
Один последовательный batch имеет общий абсолютный deadline 8 секунд, response limit
64 KiB на query и не создаёт дополнительной query concurrency. Четыре batch добавляют
максимум 24 queries вне measurement window, общий supervisor deadline остаётся 600 секунд.

`resource-sdk-diagnostics.json` входит в public whitelist и ограничен прежним 1 MiB.
Он сохраняет частичные стадии до команд и закрытый `command_failed` при отказе;
identity/transport command failure продолжает останавливать worker. Некорректный JSON,
неизвестные поля, nonfinite/future timestamp и недостоверный counter дают UNKNOWN без
копирования содержимого. Отсутствующий counter не становится нулём; наблюдаемое уменьшение
обнуляет достоверность delta, но не подменяется нулевой разницей.

Матрица позволяет проверить гипотезы: dotted sample при пустом normalized selector указывает
на различие наблюдаемых форм имени; normalized sample без результата прежнего selector
выделяет service-label filter. Поле `current_fresh_after_original_missing_or_stale` сохранено,
но после исправления основного observation оно сравнивает legacy и raw query, поэтому не
доказывает позднюю видимость того же selector или задержку экспорта. Запросы последовательны,
поэтому различия между ними ещё не доказывают причину.
Receiver/exporter deltas показывают только прогресс общего collector между snapshot,
без отнесения к конкретному producer и без доказательства отсутствия потерь или resets
между двумя наблюдениями. Нулевые/отсутствующие deltas не доказывают выключенный SDK.
Диагностика остаётся `observations_only` и не разрешает p95 при неуспешном прежнем observation.
Фактический запуск `9dcbb763` также завершил 400 HTTP samples с HTTP 200 и сохранил partial.
Второй after snapshot содержит dotted/dotted_service timestamp `1792448230.232` и collector
receiver/exporter counters `18`, но timestamp на 10,53 секунды старше начала этой ON-фазы.
Это не подтверждает свежую активность текущей фазы или причину исходного пустого selector.

Дополнительная проверка выполняется только после исходного observation и
шести after queries, до переключения режима. Она сравнивает две фиксированные scalar queries
`max(timestamp(...))` для dotted metric с quoted `"service.name"="platform-api"`: без override
и с `latency_offset=1ms`. Поле `immediate` означает минимальную поддерживаемую задержку 1 мс,
а не нулевую. У пары одинаковый `time`, но запросы последовательны и не имеют общего
storage snapshot. До трёх пар с интервалом 2 секунды используют один абсолютный deadline
8 секунд. Polling прекращается при свежем immediate sample; command вместе с проверкой
identity ограничен 10 секундами. Максимум добавляется шесть GET на ON-фазу, двенадцать на
запуск, всего с прежними snapshot не более 36 diagnostic GET. Response/output limits,
600-секундный supervisor, исходный selector, profile и acceptance gates не меняются.

Поле `latency` того же ограниченного artifact сохраняет evaluation time, две закрытые
scalar строки и признаки свежести относительно начала текущей ON-фазы. Сохраняется допуск
расхождения часов: timestamp до двух секунд впереди evaluation time может подтверждать
свежесть текущей фазы. Более поздний future timestamp, nonfinite или неизвестное значение
не подтверждает свежесть; sample предыдущей фазы также её не подтверждает. Отсутствие
данных не становится доказательством выключенного SDK. Partial/command failure сохраняются,
а identity/transport command failure останавливает worker. Эти результаты не разрешают p95.

В image lock закреплён VictoriaMetrics `v1.154.0` с digest. Его
[исходник prometheus.go](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/v1.154.0/app/vmselect/prometheus/prometheus.go)
задаёт `search.latencyOffset=30s`, читает per-query `latency_offset` и сдвигает instant-query
evaluation time вблизи текущего времени (строки 36–38, 835–846, 1110–1114).
[Официальное описание query latency](https://docs.victoriametrics.com/victoriametrics/keyconcepts/#query-latency)
также предупреждает, что недавно принятые buffered samples могут ещё не быть видимыми.
Однако pinned [GetDuration](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/v1.154.0/lib/httputil/duration.go)
после перевода в миллисекунды отклоняет `msecs <= 0` (строки 19–31), поэтому `0` и `0s`
недопустимы, а минимум равен `1ms`. SHA256 проверенного файла:
`7085d337f12acd3cb8de4a5eb3e8719c612f49d5d23044c11bb9f4fb3609551b`.
Предыдущий аргумент `0` был дефектом запроса. Это не доказывает единственную причину
исторического UNKNOWN, поскольку HTTP-статус не сохранён. Проверка `1ms` на pinned runtime
подтверждена paired diagnostic в запуске `80673cdd`: обе ON-фазы имеют свежий raw sample.
Это не исключает другие причины исторических UNKNOWN. Глобальные flags, ACL, collector
и flush не меняются. Исправленный основной observation ожидает review и фактического
запуска с точным source-bound образом.

Raw Engine sampling хранит charged memory, file/active/inactive cache, working-set estimate,
накопленные CPU nanoseconds и guest online CPU count раздельно. Используется
[Engine API v1.51](https://docs.docker.com/reference/api/engine/version/v1.51/),
не отформатированные `docker stats` строки. Per-container read windows имеют monotonic bounds;
CPU interval uncertainty сохраняется. Sampled memory maximum является нижней границей пика.
Счётчики операций читаются только из собственного private-cgroup
[io.stat](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html), без privileged mounts.
Изменение device set, замеченный reset, отсутствие/недоступность/nonfinite counter дают UNKNOWN
(JSON `null`), не ноль. Engine byte totals не выдаются за IOPS. CPU и IO windows включают одинаковый
прогрев; IO дополнительно охватывает сбор snapshot. Это не точный CPU-only interval HTTP workload.

CPU load generator представлен своим cgroup и process CPU; process CPU является частью cgroup,
их нельзя складывать. Host helper CPU включает sampler thread, child CPU CLI учитывается отдельно.
Guest vCPU не является physical Mac/Timeweb denominator. Нормализованный whole-host overhead,
полный app memory/disk reserve, volume/inode accounting, lag/loss ledger, steady/spike/query/restart,
retention/restore и thresholds остаются pending. Даже `completed_short_profile` не означает
resource acceptance #1566; недостающие counter/latency данные сохраняются как partial/UNKNOWN.

Source proof связывает commit/tree, manifest и hashes executable/shared inputs с image IDs.
Публичный сборщик копирует только whitelist bounded JSON, не более 1 MiB на файл. Compose,
env files, JWT/query keys и сырые Engine bodies остаются private. После подтверждённых down/residue
удаляются только известные private input files своего запуска. При failed down env files остаются
для корректного recovery. Refused preexisting output не очищается. Архивировать весь output нельзя.

Лёгкие contracts без Docker запускаются отдельно:

```sh
bash scripts/heavy-check.sh node --test scripts/observability-resource.test.mjs
```

### Наблюдение собственных операций Kinescope

Включённый SDK наблюдает `delete`, `find` и `initUpload` через явную границу
`observeKinescopeOperation`. Каждое фактическое обращение к методу даёт один CLIENT span,
один прирост `inside.dependency.operations` и одно измерение `inside.dependency.duration`
в секундах. Длительность включает существующую обработку и проверку ответа адаптером.
Она не обозначает отдельное время сети. Ранние ответы, например DELETE 404/429/503,
не требуют дополнительного чтения тела. Повторная попытка существующей бизнес-операции
остаётся отдельным обращением к методу, повторная доставка OTLP не становится новой операцией.

Span содержит только фиксированные `dependency.name=kinescope`, `dependency.operation`,
`dependency.outcome=completed|failed`, HTTP method и допустимый числовой status, если ответ
получен. `completed` обозначает завершение существующего контракта адаптера, включая
ожидаемый 404 в `find`/`delete`. Ошибки провайдера, исключения и невалидный успешный ответ
дают `failed`. Различение timeout/network в возвращаемом результате DELETE сохраняется;
новая метка причины ошибки не вводится. Метрики содержат только dependency/operation/outcome,
максимум шесть известных сочетаний на инструмент и resource identity. HTTP status, URL,
provider request ID, названия/идентификаторы видео и произвольные ошибки туда не попадают.
К провайдеру не добавляются trace headers. OFF подавляет сбор и внутри другого включённого SDK.

`privacy-policy.json` и сгенерированный Alloy допускают этот фиксированный каталог.
Для внешних отправителей каждый из трёх metric dimensions имеет отдельный `_OTHER`:
максимум 24 сочетания на инструмент и resource identity. Это граница каталога, не измеренное
число хранимых рядов. Corpus ожидает 70 рядов для двух фиксированных releases
и семи сочетаний, включая общий fallback, по пяти экспортируемым histogram/counter series;
это ожидаемое число конкретного corpus, которое должен подтвердить runtime gate. `scripts/observability-pilot/dependency_privacy.py` содержит фиксированный
OTLP JSON/protobuf corpus с шестью известными сочетаниями и неизвестными, отсутствующими и неверно
типизированными полями. Runtime controller проверяет его отдельным gate: logging-none до ingest, только два
фиксированных trace IDs, максимум десять полных строк на запрос и закрытый итоговый
`dependency-collector.json` без raw данных. Исполнение этого gate в pinned collector,
настоящий API/deletion worker с PostgreSQL, причинная цепочка и ресурсная приёмка остаются
отдельными незавершёнными проверками #1566. Loopback SDK/HTTP/OTLP проверки их не заменяют.

### Технический контекст почтовой доставки

Кандидат SDK продолжает email-команды через `emailMaterial`, `emailSubscription`
и `emailResult`. Отдельные операции фиксируют публикацию, приём, разбор одной строки
отправки и применение результата. `dispatch` существует только для двух командных
дорожек, `project` только для результата. Старые операции и метрики материалов не
меняются. `smtp send` означает один фактический вызов настроенного отправителя.
`sent`, `not_sent`, `failed` и `unknown` остаются разными исходами. Завершившийся
вызов с `unknown` не подтверждает доставку. Пропущенный или запрещённый вызов SMTP
не увеличивает этот счётчик.

Migration `0111_notifications_email_trace_context` добавляет nullable `varchar(55)`
на собственные `notification_outbox`, `commands`, `email_inbox`, `email_attempts`.
Контекст записывается впервые, отдельно от canonical payload и digest. Повторный
приём не заменяет его, включая прежний `NULL`. Новая допустимая ревизия команды
с тем же sourceEventId берёт контекст предыдущей сохранённой команды. При смене
sourceEventId источником служит соответствующий immutable inbox с точными lane,
payload и digest. Отсутствие такого источника даёт `NULL`. Каждая попытка начинает отдельный
`dispatch` до записи `unknown` и до внешнего I/O. Её carrier записывается вместе
с попыткой. Результат использует carrier соответствующей попытки, а результат без
attemptRef использует email inbox. Проверяются operation, delivery и command revision
через исходный inbox. Несовпадение даёт разрыв контекста. При восстановлении
отсутствующей строки result outbox берётся тот же сохранённый carrier, без текущего
контекста повторного входящего сообщения. Контекст mutable email effect не расширяется.
Текущая реализация не добавляет очистку этих строк или историческое заполнение.

Для `inside.email.operations` и `inside.email.duration` зарегистрированы девять
операций с исходами `completed`/`failed` и `smtpSend` с четырьмя исходами отправки.
Это максимум 22 допустимых сочетания меток на один набор service/environment/release.
Pinned SDK использует 15 конечных границ histogram, 16 bucket series с `+Inf`,
count, sum и отдельный counter. Аналитическая верхняя граница составляет
`22 × 19 = 418` рядов на такой набор, без рядов других инструментов. Collector
сводит недопустимые сочетания email-метрик в один дополнительный `_OTHER/_OTHER`
набор, поэтому граница с ним составляет `23 × 19 = 437`. Это расчёт каталога,
не измерение сохранённых рядов. Корпус материалов с 70 рядами сохраняет свою
прежнюю область проверки.

Email spans проходят закрытый snapshot до batch: только фиксированные операции,
дорожки, известный исход, trace identity и code статуса. Содержимое письма,
получатель, subject, тело, credentials, Message-ID, provider reply, operation/attempt
IDs, exception message, events и links не сохраняются в новых spans или метках.
SDK по умолчанию выключен. Проверки source admission и loopback SDK сами по себе
не доказывают реальное хранение нового каталога или полный путь HTTP, PostgreSQL,
Rabbit, worker, SMTP и применение результата. Эти проверки, восстановление после
остановок и оценка ресурсов остаются обязательными отдельными доказательствами
перед приёмкой всей спецификации. Production email не используется для таких проверок.
