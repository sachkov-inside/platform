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

`test:tooling` допускает Node test files последовательно (`--test-concurrency=1`).
Состав проверок, предварительная сборка backend, ограничения дочерних процессов и CI job
сохранены. Production concurrency не меняется. Общее время набора может вырасти;
причина прежних тайм-аутов и улучшение времени в hosted CI пока не подтверждены.

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
Native MCP проверяет сохранённую историю конечного fixture в пределах исходного worker
600s. Только его VM caller использует `last_over_time(pilot_requests[10m])` и boolean
`nocache: true`; дополнительный notification selector обёрнут в такой же `last_over_time`
и получает тот же boolean. Глобальный notification selector не меняется. Закреплённый
[MCP v1.20.2 принимает boolean и переводит его в HTTP `nocache=1`](https://github.com/VictoriaMetrics/mcp-victoriametrics/blob/fb45b04fbb93bdeda4ea7117ea50420a5ad4cb7e/cmd/mcp-victoriametrics/tools/query.go).
Logs caller использует `_time:10m`, сохраняя `start: "0"` и `limit: 10`; trace ID и
validators остаются прежними. Это совместимость чтения истории, не свежесть источника.
Серии старше окна не засчитываются. Размеры ответа, RPC deadlines, read-only routes,
credentials и управление процессами не расширяются.

CI39405217200 прошёл все 13 E metric checkpoints, но завершился общим отказом основной
MCP fixture. Прежний artifact писался только после всех трёх native probes. Поэтому
точный инструмент и причину этого CI установить нельзя: тот же отказ объединял
необъектный result, `isError` и отсутствие маркера. Отдельная модель закреплённых
временных правил воспроизводит потерю одноразового sample при старом запросе.
Это доказанный недостаток конечной проверки, а не доказанная единственная причина CI.

`native-mcp-progress.json` сохраняет закрытый итог и последний этап каждого начатого
инструмента, включая отказ. Допустимы только фиксированные `route`, `phase`, `outcome`.
Он различает `invalid_result`, `tool_error`, `fixture_absent` и общий `failed`, сохраняет
предыдущие завершённые probes. Дополнительные проверки имеют этапы `additional_1` и
`additional_2`; второй допустим только для traces. Только завершение всех трёх probes
даёт `passed`; частичное выполнение остаётся `incomplete` или `failed`. Payloads,
обнаруженные имена инструментов, trace IDs, URL, credentials и ошибки туда не входят.
Перед публичным копированием CI снова проверяет всю схему, включая повторные JSON keys,
неизвестные значения и лимит 4096 bytes. Невозможность сохранить progress не даёт PASS.

Host tests вызывают настоящий `native_probes` и его stdio boundary с собственными
дочерними процессами, проверяя finite-history модель, отказ за окном, закрытую
проекцию и фактическое завершение детей. Vendor MCP и Docker в этих tests не запускаются.
Новый native exact-source CI остаётся необходимым; прежний generic отказ не доказывает
выполнение последующих семи фаз проверки свежести.

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
Срабатывание таймера query исчерпывает весь batch, даже если monotonic clock ещё показывает
остаток до deadline. Быстрый ответ 503 оставляет возможность выполнить следующие queries
в пределах того же бюджета.

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

`privacy-policy.json` и сгенерированный Alloy допускают фиксированный каталог Kinescope
PostgreSQL, T-Bank, Logto и Telegram HTTP (community, communications, link, contacts, sign-in). Для внешних отправителей каждый из трёх metric dimensions имеет отдельный
`_OTHER`: максимум 396 сочетаний на инструмент и resource identity. Это граница каталога,
не измеренное число хранимых рядов. Общий corpus ожидает 430 dependency series для двух
фиксированных releases и 43 сочетания (42 известных и общий fallback), по пяти
histogram/counter series. Ещё десять series проверяют пять pool gauges для двух releases.
Итого ожидаются 440 series. Это ожидаемые числа конкретного corpus, которые должен
подтвердить runtime gate точной версии исходников.

`scripts/observability-pilot/dependency_privacy.py` содержит фиксированный OTLP JSON/protobuf
corpus: шесть известных сочетаний Kinescope, шесть PostgreSQL, 14 T-Bank, два Logto, четыре community set/status и три adversarial spans с
неизвестными, отсутствующими и неверно типизированными полями. Controller проверяет
logging-none до ingest и шесть фиксированных trace IDs в трёх partitions. Для core query
разрешены максимум 36 полных строк при 35 ожидаемых spans; для communications query
сохраняется предел 30 строк при двух ожидаемых spans; отдельный Telegram HTTP query имеет тот же предел 30 строк при восьми ожидаемых spans. Закрытый `dependency-collector.json`
не содержит raw данных.
Pool metric dimensions удаляются полностью. Runtime нового corpus в pinned collector,
настоящие API/worker с PostgreSQL, причинная цепочка и ресурсная приёмка фиксируются отдельно
для точного source commit. Loopback SDK/HTTP/OTLP проверки их не заменяют.

### Наблюдение Prisma PostgreSQL

Кандидат SQL-наблюдения использует отдельный pool на каждый `PrismaPg.connect()`.
Фабрика передаёт pool в vendor adapter после локального наблюдения его публичного `connect`.
Только клиенты этого pool получают наблюдение публичного `query`, без замены объекта клиента
или `release`. Vendor adapter владеет завершением через `disposeExternalPool: true`.
Новый `connect()` создаёт новый наблюдаемый pool. Лимиты остаются 10 соединений и 5 секунд
на получение соединения. Телеметрия не читает SQL, параметры, имена таблиц, DSN или ошибки.

Фиксированные операции `postgresql acquire` и `postgresql query` считают получение соединения
и фактическое выполнение driver query отдельно. Длительность `query` включает работу клиента
и сети, это не чистое время PostgreSQL. Управление транзакцией и savepoints также проходят
через driver query. Фиксированная операция `postgresql material-slug-lock` измеряет вызов
известного lock helper; она не является дополнительным SQL statement или мониторингом всех
блокировок PostgreSQL. Остальные ключи advisory lock не попадают в телеметрию.

Пять gauges `inside.postgresql.pool.*` не имеют labels. `available=1` означает, что при сборе
есть наблюдаемый живой Prisma pool и registry не переполнен. Только при этом значении можно
интерпретировать сумму `total`, `idle` и `waiting`. При `available=0` их нули являются
placeholders, а не здоровым пустым pool. Dashboard, MCP и проверка приёмки обязаны учитывать
`available`. Получение старого metric sample не доказывает свежесть источника.

Локальный бюджет SDK удерживает до 16 pool references, независимо от connection limits.
Закрытые pool удаляются при следующей регистрации; последовательные reconnect не расходуют
этот бюджет навсегда. При переполнении `registry_overflow=1`, `available=0` до перезапуска SDK.
Так неполный набор pool не выдаётся за полный. Эта граница не меняет business lifecycle.

Прямые `pg` owners, pg-boss, Telegram, bootstrap/migration SQL, shadow database и Submittable
query streams вне этого покрытия. Наблюдение начинается внутри собственного включённого SDK
scope; default OFF сохраняется. Source-тесты и внешний JSON/protobuf corpus не доказывают
реальные PostgreSQL, retained collector, resource overhead или всю причинную цепочку #1566.
Такие результаты фиксируются отдельно для точного source commit после runtime-проверки.

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
attemptRef использует email inbox. Проверяются operation, delivery, payload digest и command revision
через исходный inbox. Несовпадение даёт разрыв контекста. При восстановлении
отсутствующей строки result outbox берётся тот же сохранённый carrier, без текущего
контекста повторного входящего сообщения. Контекст mutable email effect не расширяется.
Текущая реализация не добавляет очистку этих строк или историческое заполнение.

После объединения с main `81111848` registry сохраняет его первые 103 миграции,
включая `0101_waitlist_confirmations` и `0102_material_telegram_announcements`, и добавляет
13 миграций observability без изменения их SQL или имён. Всего зарегистрированы 116 уникальных
имён. Порядок задаёт registry, а не числовая часть имени. Канонические main0100, main0101
и main0102 остаются точными префиксами. Исторический неопубликованный root109 расходится
на позиции102, а старые registry113/114/115, на позиции103. Автоматического исправления,
перестановки ledger или сброса базы нет. Независимые fixtures из неизменяемых коммитов
сохраняют их прежние digest. Проверки отдельно подтверждают отказ без изменения ledger
и строк, воспроизведение совместимой старой истории и nullable writers. Для новой истории
предшественники tracking/waitlist имеют 114/115 записей и не называются старыми fixtures.
Эти PostgreSQL-проверки требуют CI или отдельной разрешённой базы данных.

Main `2f530002` также добавляет `WaitlistConfirmationPump`, HTTP отправку подтверждения
из Platform и `HttpWaitlistConfirmationAdapter` в Telegram. Их техническое наблюдение
остаётся отдельным пробелом полной спецификации #1566; наблюдение существующих
communications, community, link, contacts и sign-in не доказывает эти новые границы.

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


### Отдельный внешний email corpus

`scripts/observability-pilot/email_privacy.py` проверяет отдельные фиксированные JSON/protobuf
входы. Два known trace IDs оканчиваются на `d7`/`d8`, два adversarial IDs на `d9`/`da`.
Каждый содержит 32 hex-символа; первые 31 равны `d`. Reader допускает только эти четыре
запроса: limit 23 для 22 known spans и limit 9 для 8 adversarial spans. Текущие C payloads,
их query limits 36/30, protobuf limit 65,536 B, response limit 1 MiB и vector limit 1,000
не меняются. Email JSON ограничен 262,144 B; каждый фактически сформированный body
проверяется до отправки. Независимый host wire-reader проверяет OTLP field numbers, все
span IDs/parents, атрибуты, counter и histogram. Это source-проверка кодека, не запуск storage.

Полная строка хранения проверяется до решения о pending. Неизвестные columns, attrs,
resource/scope metadata, события, links, private fields, duplicate IDs и противоречащие
causal edges дают закрытый отказ. Один incoming anchor сохраняется явно; внешний span
этого anchor корпус не доказывает. Missing `email.lane` подчиняется существующей generic
policy: его фиксированные synthetic UUID, retry 7 и batch 2 сохраняются и проверяются
полностью. Это не расширяет допустимые поля известных email-lane или SMTP spans.

Поле `_time` для обоих ingress форматов означает START: закреплённый Alloy v1.21.0
[по умолчанию экспортирует protobuf](https://github.com/grafana/alloy/blob/v1.21.0/internal/component/otelcol/exporter/otlphttp/otlphttp.go),
и в traces exporter нет override. Закреплённый VT v0.12.0
[декодирует protobuf с START timestamp](https://github.com/VictoriaMetrics/VictoriaTraces/blob/fdfa32fdc58188463a9b342741bf10a748e455ce/app/vtinsert/opentelemetry/pb.go).
Reader проверяет точные start/end/duration, sampled flags 1 и лишь нулевые dropped counts,
если они присутствуют. `_msg` равен `-`; `_stream` содержит ровно name и fixed service.
`_stream_id` имеет 48 lowercase hex, первые 16 соответствуют tenant 0; у exporter нет
AccountID/ProjectID headers. Это структурная проверка native stream ID и согласованности
его повторений, не независимое вычисление storage hash. Остальные scalar columns закрыты.

Known metric baseline содержит 22 пары на release. Шесть фиксированных ошибочных сочетаний
проверяются последовательно: один candidate на transport, затем полная проверка storage
перед следующим candidate. Marker 1…6 должен появиться во всех пяти series fallback-пары;
старый marker остаётся pending до исходного fact deadline, никогда PASS. Закреплённый
[VM v1.154.0 округляет OTLP timestamps до milliseconds](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/v1.154.0/lib/protoparser/opentelemetry/stream/streamparser.go).
Каждый следующий timestamp берётся из текущих часов и обязан попасть в более позднюю
storage millisecond. Совпадение, включая `+1ns`, даёт отказ без future dating или изменения
таймаутов. Metric scope version допускает только отсутствие, пустое значение и native
`unknown`: [VM decoder использует этот literal, когда protobuf version отсутствует](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/v1.154.0/lib/protoparser/opentelemetry/pb/pb.go). Ожидаемые 220 baseline / 230 final series и 44 / 46 email labelsets относятся
только к этому one-bound fixture, не к native SDK histogram с 15 границами.

Закреплённый VM v1.154.0 безусловно добавляет в успешный instant-query ответ
[`stats`](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/29c43cd2fee05409499a4d1b38e950e1b7f13bd4/app/vmselect/prometheus/query_response.qtpl):
`seriesFetched` как десятичную строку и `executionTimeMsec` как целое число.
Reader сохраняет прежний bare-fixture envelope и допускает только этот дополнительный
object с ровно двумя ключами. `seriesFetched` ограничен неотрицательным signed int64,
а milliseconds ограничены 9223372036854, максимумом положительного `time.Duration`
после деления nanoseconds на миллион. Bool, отрицательные, дробные, переполненные,
неизвестные и повторные поля дают отказ до pending. Metadata не заменяет проверку
полного vector, не задаёт его cardinality и не копируется в proof.
Native [formatter](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/29c43cd2fee05409499a4d1b38e950e1b7f13bd4/vendor/github.com/valyala/quicktemplate/writer.go)
использует plain decimal; numeric grammar samples не расширяется. `isPartial`, `trace`
и другие неподтверждённые дополнительные поля по-прежнему запрещены.

E-METRIC-01 зафиксирован после CI39391699476: четыре trace verdicts прошли, но первый
metric checkpoint завершился отказом после восьми uploads. Host replay доказал
несовместимость прежнего exact envelope с обязательным native `stats`. Raw failed
response не сохранялся, поэтому это не доказательство единственной причины CI failure.
Исправленный native collector/storage result требует нового exact-source evidence.

`pilot.email_catalog_corpus` выполняет конечные 20 uploads, четыре full trace reads и
13 full-vector metric checkpoints. Исходные query 10s / fact 60s сохраняются; отдельный
runtime controller и его общий бюджет согласуются до lease. На каждом checkpoint
неизменённый legacy reader и E reader получают один и тот же полный raw vector.
Legacy verdict сохраняется отдельно: глобальный итог series не зашит в E и должен
следовать точному источнику текущего L/C каталога. Результат `email-collector.json`
содержит лишь закрытые стадии и проверенные числовые verdicts. Отказ сохраняет только
достигнутые стадии; raw ответы, credentials и ошибки не сохраняются.

E-METRIC-02 зафиксирован после CI39400084517: baseline и JSON marker 1 прошли,
а marker 2 не стал полным за исходные 60s (230 чтений). Raw ответ не сохранялся,
поэтому точная причина этого CI неизвестна. Отдельный host replay выявил дефект
конечной схемы проверки: одноразовые legacy series могут выйти из стандартного
5m окна, пока 13 последовательных checkpoints ждут данные. Закреплённый VM
[по умолчанию сдвигает instant-query evaluation на 30s назад](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/29c43cd2fee05409499a4d1b38e950e1b7f13bd4/app/vmselect/prometheus/prometheus.go).

Только E checkpoints теперь отправляют фиксированный query
`last_over_time({__name__=~".+"}[10m])` и `nocache=1`. Окно 600s соответствует
существующему worker deadline; `nocache` убирает указанное смещение времени.
Query сохраняет все имена и labels серий, выбирая последний обычный sample в
`(evaluation time − 600s, evaluation time]`. Закреплённые
[rollup](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/29c43cd2fee05409499a4d1b38e950e1b7f13bd4/app/vmselect/promql/rollup.go)
и [evaluation](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/29c43cd2fee05409499a4d1b38e950e1b7f13bd4/app/vmselect/promql/eval.go)
сохраняют metric name, исключают нижнюю границу и игнорируют Prometheus stale markers
для `last_over_time`. Поэтому это проверка сохранённой истории fixture, а не
свежести, непрерывности или текущей доступности источника. E/C fixtures stale markers
не отправляют. Старые marker значения по-прежнему дают pending, пропущенные series
не становятся PASS, приватные и неизвестные поля дают отказ. Оба reader получают
один полный raw vector. Тайм-ауты, caps, timestamps uploads и остальные queries
сохранены. История старше окна не считается полной; время в будущем не запрашивается.

Host regression вызывает настоящий `email_catalog_corpus` с моделью закреплённых
правил query time и полный существующий corpus. Она проверяет 20 uploads и 13
checkpoints при начальном возрасте одноразового legacy 0s, 241s и 599s. Отдельный
случай проверяет отказ, когда на первом query legacy уже старше окна 600s: две
baseline uploads сдвигают часы с 600s до 600.004s. Точная открытая нижняя граница
окна описана выше по закреплённому исходнику VM, этот случай её не проверяет.
Это не native VM execution. Новый exact-source CI остаётся необходимым.
Внутренний caller не принимает произвольные query parameters; HTTP fixture проверяет
точно два отправленных параметра. Полномочия существующих vmauth/Caddy routes не меняются.

Даже будущий PASS этого внешнего corpus не доказывает actual SDK → pinned storage,
реальную HTTP/PG/Rabbit/SMTP causality в storage или ресурсную приёмку. Для текущего
source-кандидата collector runtime ещё не выполнялся.


## Наблюдение собственных обращений к T-Bank

`Tbank.call` наблюдает семь фиксированных операций: `Init`, `GetState`, `CheckOrder`,
`Charge`, `Cancel`, `AddCard`, `GetAddCardState`. Один допущенный вызов делает один POST,
без внутреннего повтора. Локальная проверка до `call`, приём notification и шифрование
привязки не являются HTTP-обращениями. Duration включает подготовку существующего запроса,
ожидание ответа и его существующее JSON-чтение, но исключает последующую проверку доменной
схемы, terminal/payment correlation и URL формы. Поэтому `completed` не доказывает успех
платежа или допустимость ответа для бизнеса. HTTP !ok, transport и JSON errors дают `failed`;
исходное исключение сохраняется. `BankResponse` не требует numeric status, и span его не добавляет.

Span содержит только `dependency.name=tbank`, фиксированную operation,
`dependency.outcome=completed|failed` и `http.request.method=POST`. Counter и histogram
используют только dependency/operation/outcome. Семь операций на два исхода дают 14 новых
сочетаний атрибутов на каждый инструмент и resource identity, всего 42 известных сочетания
с Kinescope, PostgreSQL, Logto и всем Telegram HTTP каталогом. Существующий SDK cap 128 ограничивает aggregation cardinality,
а не число хранимых histogram series; cap и overflow поведение не меняются. Для histogram
с B конечными границами counter, count, sum и B+1 buckets дают B+4 хранимых series на
сочетание, если приёмник публикует каждый bucket. Фактическое преобразование и число series
нужно проверять на точной версии collector/storage. Corpus использует одну конечную границу,
поэтому его пять series на сочетание не описывают production SDK histogram.

BankRequest, CA-specific Undici Agent, TLS/hostname trust, redirect error, 10 секунд AbortSignal,
подписанные bytes и authority sent/unknown до I/O сохраняются. Trace headers в банк не
добавляются. TerminalKey, Token, PaymentId, OrderId, RebillId, сумма, URL, receipt/email,
body и provider errors не передаются телеметрии. OFF подавляет сбор внутри включённого SDK;
счётчик обновляется независимо от trace sampling. Owned HTTP/OTLP loopback contracts проверяют
транспорт и безопасный экспорт; они не доказывают pinned collector/storage, representative
resource acceptance или реальные банковские операции. PostgreSQL purchase/reconcile contract
проверяется отдельно на выделенном runtime; до его фактического запуска это pending evidence.


## Наблюдение HTTP загрузки Logto JWKS

`createLogtoAccessTokenVerifier` использует public `customFetch` pinned JOSE 6.2.12.
Hook делегирует исходному native `fetch` те же URL, GET, Headers, AbortSignal и
`redirect=manual`. Возвращается тот же Response, без clone, чтения тела или добавления
traceparent/tracestate/baggage. Duration заканчивается на возврате response headers.
HTTP 200 даёт `completed`, другой status или native fetch rejection дают `failed`.
Последующее чтение/проверка JSON, JWKS и token claims принадлежит JOSE и находится вне span.
Поэтому HTTP `completed` совместим с отказом аутентификации или ошибкой чтения тела и не
доказывает успешную проверку token. Numeric status сохраняется только в допустимом диапазоне.

Fixed span `logto jwks` содержит dependency name/operation/outcome, GET и допустимый status.
Counter/histogram содержат только `logto`/`jwks`/`completed|failed`: два новых сочетания
атрибутов на инструмент и resource identity. Общее число известных SDK сочетаний равно 42,
существующий aggregation cardinality cap 128 не меняется. Это не количество stored series.
Полный внешний corpus ожидает 440 series, но новый результат должен подтвердить точный runtime.

Counter измеряет реальные customFetch обращения, не количество verifyAccount/verifyAccountSignIn.
Local JWKS, cache hit и дополнительные waiters общего pending fetch не создают обращения.
Общий fetch связан с контекстом вызвавшего его запроса, без ложного присвоения отдельного
CLIENT каждому waiter. Сохраняются 2 секунды timeout, 30 секунд cooldown, 10 минут cache,
ES384, issuer/audience/claim/scopes проверки, URL/TLS trust и исходное отображение ошибок.
Телеметрия не получает URL, JWT, claims, subject, email, scopes, JWKS/key IDs/key material,
headers или произвольные ошибки. OFF, отказ context manager и exporter failure не меняют auth.

Owned loopback contracts проверяют реальные запросы, cache/coalescing/reload, response headers
при ещё незавершённом body, timeout, redirect, malformed/truncated responses и восстановление.
Actual OTLP остаётся отдельной границей от pinned collector/storage. Genuine MCP scope проверяется
через настоящий HTTP adapter; подготовленные API cases используют production application,
реальный PostgreSQL и управляемый JWKS issuer. PostgreSQL cases до отдельного запуска pending.
Полная SDK-to-storage цепочка и representative resource acceptance из этих проверок не следуют.


## Наблюдение community entitlement set/status

`HttpCommunityEntitlementProvider` наблюдает только собственные `set` и `status` через
фиксированные `telegram` / `community.set|community.status`. Проверка версии в `set` и
предел сериализованного body 16KiB выполняются до наблюдения, без HTTP, span и счётчика.
Один допущенный POST создаёт один CLIENT span и одно измерение counter/histogram.
Duration включает существующее чтение JSON и проверку корреляции ответа. Принимаемый
коррелированный result и обработанный protocol denial дают `completed`; transport/JSON error,
неверный body/status/correlation и protocol `unavailable` дают `failed`. Это технический
исход обмена, не подтверждение применённого доступа. Все прежние результаты адаптера
возвращаются без изменений, неизвестный исход не вызывает повторного `set`.

Сохраняются request bytes, bearer/content-type, native redirect error и AbortSignal timeout
5 секунд. Response читается один раз прежним `json`, без clone/нового чтения. Operation
выбирается вызывающим entrypoint, не из приватного body. В telemetry разрешены только
фиксированные dependency/operation/outcome, POST и фактический допустимый HTTP status.
Account/Telegram/link/operation/correlation refs, revision/access, body, URL, secret и raw
provider errors не передаются observer. Trace headers не добавляются.

Четыре пары community operation/outcome вместе с остальным Telegram HTTP каталогом дают 42 известных SDK aggregation attribute sets на
инструмент и resource identity; существующий cap128 не меняется и не обозначает число
stored series. Независимая нормализация внешних labels имеет ceiling6×22×3=396 сочетаний.
Фиксированная core partition ожидает 35 spans (32 registered completions плюс три adversarial) и
440 stored series с communications и remaining Telegram HTTP partitions: два releases ×43 сочетания с fallback ×пять counter/histogram series,
плюс десять pool gauges. Пять series относятся к fixture с одной конечной histogram bound,
а не к production histogram. Это аналитические ожидания, не измеренный runtime результат.

Corpus сохраняет все прежние негативные поля и делится на две фиксированные непересекающиеся
порции по18 и17 spans/metric points. Это восемь core OTLP ingest requests: два signals ×две порции
×два transports JSON/protobuf. Отдельная communications partition добавляет четыре запроса,
а remaining Telegram HTTP partition ещё четыре, всего шестнадцать. Ни один protobuf request не достигает прежних65536B;
предел полного ответа1MiB, vector1000, query budget и resource caps не увеличиваются.
Полный storage query ограничен36 строками для35 ожидаемых spans, чтобы обнаруживать extras.
Host loopback/OTLP проверки, PostgreSQL caller proof и pinned collector runtime подтверждают
разные границы. Реальные provider calls, representative resources и full-spec acceptance
не следуют из этих source contracts.


### Communications HTTP observation

`HttpCommunicationsProvider.execute` records the configured Platform → Telegram POST and its
existing single JSON read as `telegram communications.execute`. It emits one CLIENT span and
one `inside.dependency.operations` increment plus `inside.dependency.duration` observation per
actual adapter request. Duration ends before schema, operation and bot-identity validation.
HTTP status ≥400 or a thrown transport/body error marks this request failed. A parsed HTTP-200
response can still be rejected by the unchanged domain validation after a completed request.
These technical outcomes do not prove whether a remote mutation committed.

Absent provider configuration or a local JSON serialization refusal makes no request and records
no dependency observation. The
existing 5-second abort, `redirect: "error"`, bearer and JSON bytes, result mapping and no automatic
resend rule remain authoritative. Telemetry adds no provider headers. Only fixed dependency,
operation, method, numeric status and completion outcome enter spans; metrics carry only fixed
dependency/operation/outcome. Request envelopes, author content, credentials, URLs, identifiers,
provider responses and raw errors never enter this observation. Trace sampling does not suppress
the completion counter. The separate community set/status observer retains its own duration/outcome contract.
Cross-application propagation remains a coverage gap.

The external JSON/protobuf catalog retains all Logto and community challenges in the two fixed
core batches. The separate two-span communications partition retains its parent bytes exactly.
Two additional fixed trace IDs (`ddddddddddddddddddddddddddddddd5` and
`ddddddddddddddddddddddddddddddd6`) carry the two communications outcomes in a separate finite
partition, with additional private Telegram-field challenges. Each read retains the existing
30-row limit and full stored-field validation, including rejection of extra rows and fields.
The new partition has no fallback cases; the original corpus retains unknown, nonstring and
missing-dimension challenges. Protobuf payloads retain the existing 65,536-byte ceiling, and
full query responses retain 1 MiB with at most 1,000 metric vector rows.

For the combined Logto and all Telegram HTTP catalog, expected storage is 440 metric series,
86 dependency label sets across two releases and 10 pool series. These are fixture expectations,
not measured production cardinality or resource acceptance. The combined catalog must
receive its own runtime source binding; encoded fixture sizes are checked separately. Host adapter/SDK and actual loopback
proofs do not replace the pinned collector, genuine API/worker + PostgreSQL, full stored-data
privacy or representative resource gates.

### Remaining Telegram HTTP adapters (#1566)

`HttpTelegramLinkProvider.register` and `confirm`, `HttpTelegramContactsProvider.read`, and
`HttpTelegramSignInProvider.bindAccount` record the fixed operations `link.register`, `link.confirm`,
`contacts.read`, and `signin.bindAccount`. Each observation begins immediately before the existing
native fetch invocation, after its URL and request options have been evaluated. Duration includes
the existing JSON read and protocol validation. Valid protocol denials (including conflict,
expired, pending, replayed and recovery-required) complete the observation. HTTP refusal, transport
or JSON failure, and invalid protocol shapes fail it. Contacts 404 preserves the optional projection
fallback and is technically failed. Sign-in retains its permissive conflict detection.

These are fetch invocation counts, not socket or business effect counts. Link requests retain native
default redirect following, so one invocation may make multiple wire requests. Contacts and sign-in
retain `redirect: "error"`. The existing 5-second deadlines, request evaluation order, authorization,
JSON bodies, public result mapping and caller-owned retry policies remain in their owning adapters.
No-secret contacts/sign-in and existing prefetch failures produce no dependency observation. No
trace headers, identifiers, URLs, contacts, token digests, bodies or raw errors are added to telemetry.

The separate eight-pair JSON/protobuf Telegram HTTP catalog uses fixed trace IDs
`eeeeeeeeeeeeeeeeeeeeeeeeeeeeee71` and `eeeeeeeeeeeeeeeeeeeeeeeeeeeeee72`. It preserves the previous
Logto and communications payload bytes and their limits. Its full stored-row read uses the existing
30-row limit; protobuf retains the 65,536-byte ceiling, and query responses retain 1 MiB and 1,000
metric rows. The combined fixture now expects 440 metric series, 86 dependency label sets and 10
pool series. These counts are fixture arithmetic, not a measured storage result. The prior
community and communications catalog without these eight pairs expected 360/70.

The Telegram-only full-row reader validates every observed row before allowing a partial/pending
result. Its literal scalar metadata follows the pinned
[VictoriaTraces v0.12.0 trace fields](https://github.com/VictoriaMetrics/VictoriaTraces/blob/fdfa32fdc58188463a9b342741bf10a748e455ce/lib/protoparser/opentelemetry/pb/trace_fields.go)
and protobuf storage path. The unchanged
[Alloy v1.21.0 exporter default](https://github.com/grafana/alloy/blob/v1.21.0/internal/component/otelcol/exporter/otlphttp/otlphttp.go)
is protobuf for both fixture ingress formats, so stored timestamps must match the fixture start.
The reader rejects unknown columns, duplicate native span IDs, invalid stream/tenant metadata and
private fields, including in partial responses. The Core hosted source manifest binds this
reader's bytes. Umami binds the shared, eagerly imported collector privacy module; this
Telegram-only reader is not used by its runtime. Legacy Logto and communications row checks remain unchanged.

Owned native HTTP/OTLP tests cover these adapter outcomes, unchanged redirect behavior, actual
five-second aborts, context isolation, OFF and exporter 503. They do not prove genuine API/PostgreSQL
caller behavior, pinned collector storage, cross-application causality or representative resource
acceptance. Those remain delivery evidence gaps until exact-source runtime verification succeeds.

### S3 headers attempts and full object reads

The S3 candidate decorates each already resolved public `S3Client.config.requestHandler.handle`
instance. It forwards the original receiver, request and options. The original handler still
owns agents, configuration, destruction, timeouts and retry providers. No request headers or
provider trace propagation are added. The configured production retry count is not measured here.

Fixed dependency `s3` has three CLIENT operations, `http.GET`, `http.PUT` and `http.DELETE`.
Each actual handler invocation ends at headers settlement, including unsuccessful HTTP statuses.
Its body remains untouched. `getObject.read` is a separate INTERNAL operation around the existing
GetObject loader, metadata validation and its one `transformToByteArray` call. A body failure
can therefore follow a completed HTTP attempt. A mapped 404 is a failed HTTP attempt and a
completed loader returning `null`. Neither outcome promises delivery of bytes to the caller.

Public image cache hits and coalesced waiters add no operations. Protected and quarantine reads
still load each time. Both delete invalidations, conditional PUT 409/412 mappings, error identity,
local signed GET generation and bootstrap destruction retain their original owners. Bootstrap
without a technical scope has no observation; this remains an explicit coverage gap.

Spans retain only dependency name, fixed operation and completed/failed outcome. HTTP attempts
also permit the fixed method and actual integer status 100..599. Full reads carry no HTTP fields.
Metrics retain only dependency/operation/outcome. Bucket, key, endpoint, credentials, signatures,
metadata, checksum, body, provider identifiers and raw AWS errors are excluded. The collector's
S3 operation branch is separate from its existing dependency operation catalog; unknown S3
operations fall back to `_OTHER`. Existing L/C/E synthetic payloads and legacy metric readers
are unchanged. Existing manifest entries already bind the modified policy, generator and Alloy
configuration; no new pilot runtime import or input is introduced.

Four operations and two outcomes permit eight label sets per resource identity. The pinned SDK's
15 finite histogram bounds produce 16 bucket series plus count, sum and counter, so the analytical
upper bound is `8 × 19 = 152` new series per identity. The existing synthetic fixture's one-bound
histogram instead uses five series per pair, so an equivalent isolated eight-pair seed would add
40. Neither number is measured stored cardinality or a whole-vector verdict. No S3 storage seed
is added by this source unit.

Host tests use the pinned native AWS SDK against owned HTTP loopback listeners. The explicit
three-attempt setting belongs only to that test client. Tests cover success/exhaustion, incomplete
body, invalid metadata, cache coalescing/deletion, refusal mappings, bootstrap, OFF, exporter503,
context isolation, sampling-independent counters and private wire fields. These tests do not
replace genuine RustFS/PostgreSQL, SDK-to-pinned-storage, external corpus or resource acceptance.

## Pilot scrape source-status query

The semantic query view reads the two existing genuine pilot scrape sources, Alloy
(`platform-collector`) and VictoriaTraces (`platform-trace-store`), with `instance="pilot"`.
It does not start services or change scrape configuration. Run it against an already owned pilot
output, whose private `auth.json` contains its disposable read token. Supply the canonical absolute
output path, without symlink components or `..`. The output directory must belong to the current
user with mode `0700`; its single-link regular `auth.json` must belong to that user with mode
`0600`. Directory components and the file are opened relative to anchored descriptors without
following symlinks. Inode, ownership, mode and canonical-path checks finish before either HTTP
query; refusal prints no token, path or raw filesystem error:

```sh
python3 scripts/observability-pilot/source_status_query.py --output <canonical-owned-pilot-output>
```

The optional numeric `--port` selects the owned loopback query ingress (default `18427`). It does
not accept a URL or an expression. Two fixed read queries share one explicit whole-second
evaluation time and a single 10-second deadline, including response reads and parsing. Each
query requests the existing two-second server query limit. There are no retries or redirects;
environment proxy settings are bypassed for this loopback read. Each response is limited to
1 MiB and 1,000 vector rows. The reconstructed JSON report is limited to 128 KiB. The synchronous
Mac/Linux command uses its main thread and temporarily owns `SIGALRM`; it refuses an already
active real-time timer and restores the prior handler. Timeout and interruption close the HTTP
reader; the command creates no reader thread or child process.

Публичный `evaluate` сохраняет bare envelope `{status,data}` и допускает только одно
дополнительное поле `stats` с двумя обязательными полями. `seriesFetched` содержит
каноническую неотрицательную ASCII decimal string от `0` до `9223372036854775807`.
`executionTimeMsec` содержит JSON integer от `0` до `9223372036854`, исключая boolean
и дробные значения. Это границы pinned VM1.154: signed int64 counter и signed int64
nanosecond duration после преобразования в milliseconds. См.
[query response](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/29c43cd2fee05409499a4d1b38e950e1b7f13bd4/app/vmselect/prometheus/query_response.qtpl)
и [duration conversion](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/29c43cd2fee05409499a4d1b38e950e1b7f13bd4/app/vmselect/prometheus/prometheus.go).
Metadata проверяется и отбрасывается для текущих и предыдущих values/timestamp acquisitions.
Она не определяет sample age, полноту или число рядов и не попадает в публичный отчёт.
Неизвестные поля, дубликаты и некорректная metadata дают `malformed`, включая позднюю
ошибку после корректного ряда. Это совместимость source-контракта, а не native runtime proof.

Оба фиксированных запроса передают `nocache=1`. В закреплённом VM1.154
[QueryHandler](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/29c43cd2fee05409499a4d1b38e950e1b7f13bd4/app/vmselect/prometheus/prometheus.go)
без этого параметра сдвигает evaluation около текущего времени на стандартные 30s назад.
Позже он восстанавливает внешние timestamps точек, но не значения `timestamp(...)`.
Поэтому внешний timestamp не исправляет возраст исходного sample: результат мог бы
оставаться `stale` при действующем источнике и пределе свежести 10s. FRESH-SPEC-01
устраняет этот сдвиг для двух текущих чтений. Параметр задан литералом, без новой
настройки, изменения selectors, хранения истории или применения E history window.
Host regression через публичный `evaluate` и частный loopback reader с настоящим
чтением credentials моделирует исходный сдвиг: прежний запрос даёт age31/`stale`,
исправленный age1/`fresh_up`. Это проверка адаптера и source-контракта, а не запуск
native VM или доказательство семи фаз. Проверки исходного sample timestamp, возраста,
deadline и закрытых labels сохраняются.

The view pairs values with the original source timestamps returned by a second fixed query.
An instant query's outer evaluation timestamp alone does not establish scrape freshness.
The timestamp query applies `timestamp_with_name` separately to each raw source metric
selector, before combining the two vectors with `or`. Only then does `label_replace` copy
its preserved metric name into `source_metric`, so both complete responses join by exact
catalog identity. No stored metric label is added. The value query, fixed selectors, evaluation
time, `nocache=1`, query timeout and response validation remain unchanged.

FRESH-STAMP-01 records a source-pattern defect exposed after CI39412486312 passed native MCP
and the baseline freshness observation, then failed with `malformed` during `vt_down`.
The earlier `timestamp(label_replace(...))` applies a rollup to an expression. In pinned
[VM evaluation](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/29c43cd2fee05409499a4d1b38e950e1b7f13bd4/app/vmselect/promql/eval.go),
that expression becomes a subquery aligned to the default 300s step. Its timestamp can
therefore describe the subquery grid instead of the original scrape. A disappeared counter
can remain in that timestamp vector after leaving the current value vector. More seriously,
a stopped source's old sample can appear fresh when the grid point is newer than the scrape.
Pinned [rollups](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/29c43cd2fee05409499a4d1b38e950e1b7f13bd4/app/vmselect/promql/rollup.go)
map `timestamp_with_name` to the last input timestamp and preserve the metric name. Applying
it directly to each raw selector avoids the implicit subquery.

FRESH-STAMP-02 сохраняет эту обработку исходных timestamps и согласует состав двух
векторов при stale marker. Уже вычисленные raw timestamps пересекаются с текущими
значениями через `and on(__name__,job,instance,receiver,exporter,data_type,format,path,type,reason)`
и `keep_metric_names`. В pinned VM обычный `and` сбрасывает имя при сопоставлении,
поэтому одного `on(__name__,...)` недостаточно. Итоговый `label_replace` выполняется
после пересечения. Закрытый decoder и точная проверка одинакового состава векторов не меняются.
Проверка через локальный HTTP-макет воспроизводит stale-marker расхождение до исправления,
но не заменяет отдельный native прогон семи переходов.

Основание для pinned VM `29c43cd2fee05409499a4d1b38e950e1b7f13bd4`:
[instant Exec и удаление пустых NaN series](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/29c43cd2fee05409499a4d1b38e950e1b7f13bd4/app/vmselect/promql/exec.go#L65-L74),
[set intersection и сопоставление имён](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/29c43cd2fee05409499a4d1b38e950e1b7f13bd4/app/vmselect/promql/binary_op.go#L725-L748).


Owned HTTP tests exercise the actual private reader, credentials and full validators with
a model of those pinned rules. The old plan reproduces malformed down-state acquisition
and falsely reports an actual 105.2s sample as fresh with age 5.2s. The ungated raw-timestamp
plan still fails the stale-marker identity join. The current gated direct-selector plan
reports `fresh_down` and the correct `stale` age. Private, unknown and mismatched rows still
fail closed. These models do not execute native VM. The failed CI did not archive its raw
query responses, so the unique runtime cause remains unknown. All seven native outage phases
and their fit within the unchanged worker budget still require separate exact-source CI.

Source state is `fresh_up`, `fresh_down`, `stale`, `missing`, `query_unavailable` or `malformed`.
Fresh means sample age after bounded response decode and validation is at most 10 seconds, reusing the existing
VictoriaTraces health rule of two five-second scrape intervals. A retained old `up=1` is stale,
or missing once it leaves the query's lookback, and cannot establish current health. A fresh
`up=0` is an observed scrape failure. Missing data and failed queries do not establish that the
source itself is down. Future timestamps, backwards observer time, unknown labels, duplicates,
partial responses and invalid numbers fail closed. Exit zero requires both sources to be
`fresh_up`; every other outcome exits nonzero with a bounded closed report. Raw response/error
bodies and credentials are not printed.

Each observed series has its own timestamp and age. Fresh `up` cannot make a stale exporter
counter fresh. Missing metric families, including the lazily created VT index-error counter,
remain missing with a null value rather than becoming zero. A family being present does not
prove every possible dimension is present. The pure read model can also compare one validated
prior acquisition: it reports endpoint progress, no change, an observed decrease/reset or
unknown comparison, with an incomplete interval after a gap longer than 10 seconds. Gauge
values are not counters. A prior successful up observation retains its age and cannot imply
current recovery. No persisted history is created by this command.

This source age is separate from the accepted ingestion-lag limit of 60 seconds. Collector
accepted/sent counters and VT ingest attempts do not prove persisted delivery or quantify
end-to-end loss. The report explicitly leaves continuous host/container, RabbitMQ, Logto,
Caddy and backup/WAL/restore monitoring uncovered. It is a pilot query view, not a production
rollout, operational alert or acceptance of the representative resource workload.


### Core CI source-freshness scenario

После существующего `smoke`, включая restart и rotation query key, Core pilot выполняет
`source_status_scenario.py` в том же частном Compose project. Каждое чтение получает текущий
ключ из `auth.json` через публичный `read_report`. Семь фаз проверяют: исходные свежие
источники, остановленный VT и его восстановление, устаревшие или отсутствующие samples
после остановки Alloy и его восстановление, недоступный query store и его восстановление.
Переходы требуют состояний и более новых исходных timestamps. Сохранённый старый `up=1`
не подтверждает восстановление. Остановка Alloy проверяет потерю scrape-наблюдений,
а не остановку обоих наблюдаемых процессов. Недоступность query store не означает,
что наблюдаемые источники остановлены.

Перед каждой остановкой и запуском сверяются frozen daemon identity, текущий и сохранённый
CID, Compose project/service/config source, pinned image, mounts и network IDs.
Изменять состояние разрешено только для `traces`, `alloy` и `metrics`. Сохранённый частный
witness содержит точные identities семи контейнеров, четырёх volumes и двух networks.
После обычного `down` cleanup дополнительно требует их типизированного отсутствия.
Ошибка daemon или неоднозначный ответ не доказывают очистку.

У всех фаз один бюджет 180 секунд внутри прежнего worker cap 600 секунд. Бюджет включает
чтения, проверки владения, stop/start и polling; допускается не более 720 acquisitions.
Ни deadline, ни провал проверки не превращаются в skip. `source-freshness.json` ограничен
1 MiB, содержит закрытое состояние, не более семи terminal reports, число попыток и время
каждой завершённой фазы. Незавершённый запуск сохраняет `incomplete` или `failed`.
`worker-outcome.json` дополнительно записывает фактическое время worker вместе с shutdown
до начала cleanup. Частный witness не входит в публичные artifacts. Существующий supervisor
по-прежнему завершает и собирает всю группу worker при успехе, ошибке, timeout и interruption.

Core `source.json` добавляет `source_status.py`, `source_status_query.py` и
`source_status_scenario.py` к 20 hashed inputs объединённого Core, всего 23. В набор входят также
`email_privacy.py` и `telegram_http_storage.py`.
`source_status.py` использует уже включённый `collector_privacy.py`; остальные импорты
нового сценария принадлежат стандартной библиотеке и этим трём файлам.
После объединения независимых изменений число inputs определяется фактическим набором.
Локальные Docker/query/clock doubles проверяют управление сценарием. Совместимость запросов
с pinned engines, семь реальных переходов и длительность hosted worker остаются непроверенными
до отдельного успешного Core CI на точном source. Прежние corpus/privacy gates сохраняются.
Эта проверка не доказывает ingestion lag, persisted delivery или end-to-end loss accounting.

### Tracking hit delivery context, prepared source for #1566

The API registers its existing technical SDK with `TrackingHitPump` before bootstrap.
`TrackingVisits.resolve` persists only the current owned W3C v00 traceparent with the durable hit.
Each successfully claimed row starts one INTERNAL `tracking deliver` attempt from that original
carrier. Missing or invalid historical carriers create independent roots. Empty polls and lost
claims do not create delivery spans. This HTTP outbox has no RabbitMQ destination or messaging labels.

`inside.tracking.operations` and `inside.tracking.duration` use only `operation=deliver` and
`outcome=completed|failed`. A negative provider result marks that attempt failed; it does not
change the existing event ID, operation ID, payload, claim, retry or ambiguous-ACK handling.
The API stops the pump and drains every started row callback, including pending claims after a sibling failure, before shutting down its SDK. The normal batch remains fail-fast and retains its existing polling cadence. Telemetry remains optional, and the
existing five-second polling and provider timeout stay authoritative.

Apply append-only `0112_communications_tracking_trace_context` before the new application binary.
It is the 115th entry after canonical main0102 and adds one nullable `varchar(55)` column
without changing that canonical114-entry prefix. Historical branch114 is a separate frozen
fixture; matching legacy replay is tested separately and cannot repair a divergent ledger.
An old binary can ignore the column, but rollback must retain the compatible full registry. Historical NULL is supported; an absent
column means migrations have not been applied and is not treated as NULL.

The genuine API/timer/PostgreSQL tests are prepared for CI. Host SDK tests alone do not prove
PostgreSQL, timer delivery, restart, shutdown or migration behavior. The existing pinned collector
policy does not yet retain these tracking fields and metrics; direct owned OTLP export is not
pinned-storage proof. This source does not activate production tracking or add user permissions.


## Первый срез production SDK S3 через хранилища

Отдельный workflow `.github/workflows/observability-sdk-storage.yml` подготавливает один
cold read через `technicalTelemetryFromEnvironment` и `createS3ObjectStorage`, с настоящими
Smithy HTTP handler и чтением body. Его HTTP scope принадлежит тесту. Это композиция SDK,
Alloy, VictoriaMetrics и VictoriaTraces, а не настоящий запрос API. Проверка API с PostgreSQL
и S3 остаётся отдельным доказательством.

Workflow использует pinned setup-platform, frozen lockfile, сборку workspace packages и backend.
Emitter направляет штатные OTLP exporters прямо в pinned Alloy. Он не подменяет `send`,
подписание, exporters или handler. Собственный HTTP fixture использует закрытые sentinel
значения для bucket, key, credentials, body и metadata. Наружу выходят только закрытые результаты,
числа и хеши исходников и загруженных модулей. Сырые OTLP и ответы хранилищ не сохраняются.

В отдельном disposable project используется весь неизменённый `pilot.SERVICES`, сейчас семь
сервисов. План, лимиты, pinned images, private auth, закрытый gateway и `logging: none` у Alloy
и VictoriaTraces берутся из существующего pilot. Перед передачей sentinel значений проверяются
Docker daemon, CID, project, service, image, Compose config, mounts и networks. Публичный
supervisor сохраняет общий бюджет worker в 600 секунд и завершает группу процессов, затем
проверяет удаление своих контейнеров, volumes и networks. Отдельный Node child владеет native
HTTP listener и закрывается при успехе, ошибке, timeout и interruption. Всегда выполняется
точное восстановление только зарегистрированного project. Core23 и его бюджет не меняются.

VM читается целиком фиксированным `last_over_time({__name__=~".+"}[10m])` с `nocache=1`.
Это ограниченное чтение сохранённой истории, оно не доказывает свежесть или задержку доставки.
Oracle проверяет каждый полученный ряд до состояния pending. Для успешных `getObject.read`
и `http.GET` ожидаются 38 dependency series: для каждой операции counter, histogram count,
sum и 16 buckets, включая `+Inf`. Независимые границы соответствуют SDK 2.12. Отдельный
закрытый владелец проверяет 29 других SDK series. Дополнительные collector и trace-store
self-scrapes имеют свой закрытый набор имён и меток и учитываются отдельно. Число 38 не
описывает полный вектор. Неизвестные, повторные и приватные поля отклоняются.

VT читается полными строками только для trace, полученного от emitter. Проверяются три span,
их поля, kind, outcome и связи test-owned root → INTERNAL `getObject.read` → CLIENT `http.GET`.
Missing строки дают pending только после проверки всех уже наблюдаемых строк. В artifact нет
trace ID, объектов, signed URLs или необработанных ошибок. Локальные sampled spans этого SDK
обязаны иметь OTLP flags `257` (`0x101`): sampled bit и признак известного parent context.
JSON и protobuf serializer проверяются на реальном pinned SDK. Простое значение `1`,
отсутствующие flags, remote-parent `769` и неизвестные bits в этом локальном сценарии
отклоняются. Это не расширяет набор допустимых remote spans и не меняет collector policy.

`source.json` связывает checkout и tree с provider run, attempt, PR head/base и хешами реальных
входов: весь production backend source, packages, package manifests, lockfile, patches,
toolchain, build inputs, emitter, supervisor, закрытые oracles и pinned конфигурацию. Файл
`runtime-modules.json` содержит хеши действительно загруженных compiled production modules
и зависимостей. Синтетический Core23 manifest не заменяет эту связь.

Первый срез включает только enabled success. Ошибки S3, retries, OFF, collector 503, другие
SDK producers, причинность настоящего API до хранилища, полный ресурсный опыт и production
остаются отдельными проверками. Наличие workflow и локальные loopback tests не означают,
что native hosted прогон или полная спецификация уже прошли.


Private IPC между Node emitter и Python supervisor использует `schema: 2`. Поле
`runtime_modules` содержит массив отсортированных записей с ровно двумя полями `path` и `sha256`.
Пути передаются как строковые значения, поэтому они не становятся JSON keys. Общий decoder
сохраняет предел длины key в 128 символов. Путь допускает до 512 символов, число уникальных модулей ограничено 1000,
как и общий предел элементов JSON array. Это сужает прежний диагностический предел в 2000 модулей;
предел stdout в 512 KiB действует независимо и может отклонить слишком большой суммарный witness.

Python проверяет схему, типы, пути, digests, четыре обязательных production modules и отсутствие
повторных путей, включая одинаковые digests, до построения map. Только после этого публикуется
прежний `runtime-modules.json` с `schema: 1` и нормализованным `sha256` map. Пределы общего
JSON decoder, credential reader, metric/trace oracles, privacy и supervisor не расширяются.
Реальный обмен между CLI и Python сначала проверяется через собственный OTLP receiver, который
принимает chunked transfer с ограничением размера. Успех отдельного Node function test не доказывает этот
обмен. Успешный локальный receiver также не доказывает приём pinned Alloy или запись VM/VT.

Проверка SDK также допускает compiled modules из `docs/contracts/dist/`. Этот runtime
package использует production-код очистки диагностических сообщений. Его отслеживаемые
исходники `docs/contracts/`, package manifest и настройки компилятора входят в полный
набор входных файлов SDK. Остальные пути `docs/` не допускаются в module witness.
Пределы private protocol и схема public artifact не меняются.

The owning SDK workflow routes every selected source input, including the exact
`apps/backend/prisma/schema.prisma` path. Its contract checks the full selection and refuses the
same paths list when that exact entry is removed; contract-source/compiler assertions remain.


Tracking and waitlist module witnesses additionally admit exactly
`docs/contracts/notifications-v1/schema.json`, imported directly by the production notification
transport. Neighbouring JSON files and path suffixes remain refused. The existing path, digest,
duplicate, required-module and privacy checks still run before publishing the map. A real Node
JSON import exercises the owning load hook in the contract tests. This source correction does not
identify the withheld leaf of an earlier native failure or prove stored runtime acceptance.

### Closed SDK, tracking and waitlist failure diagnostics (#1566)

The SDK and tracking workers publish a separate `storage-diagnostic.json` (schema1, at most2048bytes).
Its fixed scope, phase, outcome and reason distinguish query transport/decode, full raw oracle refusal
and visibility expiry, plus capture deadline/native exit/protocol decoding, witness, module projection
and module write boundaries. Attempts are retained on failure, bounded at1024 with an explicit
saturation flag. Existing30/60/600-second budgets and all byte, row, role, flags and metric gates remain.
A pending observation is recorded only after the complete unchanged raw oracle accepts the response.
No role-presence projection bypasses that gate. No raw native stderr or exception message is collected.

Tracking witness refusals retain the original `ValueError` messages and expose only the fixed
`witness_header`, `witness_group`, `witness_row`, `witness_path`, `witness_digest`,
`witness_duplicate` or `witness_required` category. The owning exception sets its read-only reason
at construction. Classification accepts only that exact known type and a valid finite reason;
foreign or malformed exceptions retain the legacy `witness_refusal` fallback. It never parses
exception text, arguments, row values, paths or hashes to form metadata. All witness predicates,
validation order, required modules and caps remain unchanged. The new categories belong only to
tracking scope, not SDK or waitlist.

The waitlist scope keeps the same bounded capture owner and its default signatures. After capture,
full witness admission and module-map publication succeed, a separate observer covers the existing
stored metrics/traces loop. It distinguishes entered query and validation boundaries, reconciliation
and visibility expiry. A capture failure is terminal and never starts that storage observer. A passed
capture or trace observation cannot infer a later failure's phase. The first actual failure remains
terminal. Diagnostic persistence refuses successful collection when invalid, and cannot replace an
active primary exception or its traceback. The worker's existing result-writer behavior is unchanged.
Before public copying, collectors strictly read present metadata, exclude its raw files from generic
collection and write only canonical projections. Invalid present metadata refuses collection.

SDK and tracking additionally prepare separate `sdk-emitter-phase.json` and
`tracking-producer-phase.json` observations. Each closed record is at most512bytes and contains
only schema1, fixed scope, captured source SHA, state, phase and reason. The child writes a private
atomic marker through an owned directory descriptor; the parent reads it only after the unchanged
capture owner has reaped the child. These source-specific owners never inspect error text, args,
properties or stack traces. `emit` and `produce` keep their default null observer and unchanged
capture APIs. The first observed operation or cleanup failure is retained even if later original
cleanup replaces the thrown exception. `completed` is written only after all original cleanup;
a later stdout/IPC failure can therefore coexist with a completed marker. Missing markers remain
unknown, abrupt exit may retain running, and malformed present markers refuse collection.

Collection now intentionally tightens the internal evidence contract: both SDK and tracking require
the complete bounded11-key `source.json` receipt before creating a public destination, even for
legacy output with no phase marker. Its checkout SHA must equal the provider execution SHA;
tracking also requires the current checkout to match that receipt. Valid existing admission receipts in canonical, owned0700 metadata directories
remain supported. Relative or symlinked metadata paths also refuse under the explicit canonical
path contract; the hosted workflows already pass canonical absolute paths. Admission can create
a relative metadata directory, but collection requires its explicit canonical absolute path. Direct calls with
arbitrary, null-provider or absent metadata, formerly accepted
by generic artifact copying, now refuse. The existing admission CLI already required
`HEAD == GITHUB_SHA` before writing its receipt; no local environment fallback is introduced.
Temporary-file writers keep a separate owned descriptor to the original inode until all named
cleanup decisions finish. The writing descriptor still closes before atomic commit. This prevents
cleanup from treating a recycled inode number as proof that a recreated foreign temp is owned.
Every acquired descriptor gets a close attempt; original failures and tracebacks survive later
cleanup errors. This source repair still requires a corrected Linux source gate; local file controls
do not prove native SDK transport or pinned storage acceptance.

The SDK collector derives authority only from that receipt. Raw phase files are excluded from
generic copying and rewritten as canonical validated records.

Local library fixtures exercise insertion, first-failure and cleanup semantics using controlled
module ports and owned loopback listeners. On Mac, unsupported directory-FD path anchoring disables
the genuine child writer; an explicitly test-owned FD-path shim does not prove OS anchoring or
native SDK/API behavior. The existing Linux source routes execute the genuine anchored writer and
actual entrypoint controls without that shim. Fresh hosted Linux results, compiled native modules,
genuine PostgreSQL and pinned storage remain separate acceptance evidence. No phase observation
establishes the cause of an earlier run or completes the whole specification.

Trace validation in SDK, tracking and waitlist admits only a constructor-owned fixed reason:
`trace_decode` at the whole-row decode-contract boundary, or `trace_gate_01` through `trace_gate_20`
for the original semantic refusal sites. SDK admits only01–12. The checked-in
`trace-predicates.json` binds each scope+gate to its permanent semantic predicate and preserves the
original predicate order. The test-only AST serialization copies each predicate and omits only
exactly empty list fields, preserving the compact fixture format across Python versions without
changing the parsed source or fixture hashes. Moving source lines never renumbers or repurposes a gate. Compound
predicates remain compound; the code does not identify their failing operand, field, value or row.
Malformed JSON keeps `response_decode`; unexpected errors keep the aggregate fallback. Only exact
owning types and valid scope/gate fields are classified, without foreign getters or formatting.
Original fixed RuntimeError-compatible messages, from-None suppression, pending results, full-row
privacy checks and every cap/query/poll/deadline remain unchanged. No SQLSTATE, raw trace, stderr,
exception text, ID, URL or inferred SQL/provider cause is published. The artifact still has seven
fields, schema1 and its2048-byte cap. These feedback refinements do not reproduce or explain the
withheld666 native trace refusals, or attribute later92e outcomes to another source change.

The actual tracking and waitlist API producers also have a separate optional private milestone channel.
Its canonical `api-producer-phase.json` is at most512bytes and contains only schema1, exact caller
scope, checkout SHA, observed/unknown/refused state and a fixed completed milestone. Milestones identify
producer start, imports, migration, provider/API listeners, checked HTTP response, persisted carrier,
waitlist relay restart, confirmed delivery, SDK shutdown and constructed native module map. They never
replace the complete producer witness or raw stored-data validation. An owned0700 directory stays alive
until capture reaps the child, then the parent strictly validates and projects the last atomic marker.
Missing legacy markers remain unknown; invalid markers are refused without copying their bytes or
replacing the primary capture failure. Collectors reject wrong source/scope and malformed present
projections before public copying. All native capture budgets and single stdout IPC remain unchanged.

The first failure remains separate from cleanup/recovery outcomes. A failure after a completed business
observation remains failed or interrupted, including at the completion boundary; it is not acceptance.
Collectors reject duplicate/nonfinite/unknown/cross-scope or oversized present diagnostic records before
creating the public destination, then atomically write only the canonical closed projection. An absent
legacy record produces an explicit unknown result. No raw response, body, URL, ID, SQL, runtime error
path, arbitrary exception class, or diagnostic output enters this artifact. These additions do not
retrospectively identify either99b failure. New source-bound hosted evidence is still required.

### Genuine tracking success storage candidate (#1566)

`.github/workflows/observability-tracking-storage.yml` prepares a separate Linux hosted vertical.
It sends one real HTTP `POST /communications/tracking/resolve` through the compiled production API,
observes the persisted carrier, waits for the production five-second timer and atomic claim, and
closes the API normally before querying pinned Alloy/VM/VT. Its private provider handles exactly
one resolve and one recordHit command. No trace headers are sent to that provider.

The disposable project owns eight containers, five volumes and two networks, including PostgreSQL.
The original Core7 ownership/absence proof remains unchanged; an additional exact PG container and
volume proof produces the combined typed count. Host API/provider listeners live inside one bounded
Node child owned by the unchanged 600-second external worker supervisor. API/pump shutdown and SDK
flush precede collector shutdown. No local shared stand or Testcontainers/Ryuk resource participates.

The separate tracking collector owner admits `deliver` with `completed|failed`, two metric families,
and only operation/outcome metric labels. The success oracle checks the complete raw metric vector
before projection, all stored rows in the privately derived trace, both provider edges and SQL counts.
A genuine test-mode API has release `test`; the existing collector maps it to `_OTHER`. Source/build
identity comes from the complete input manifest and every actual loaded module hash, rather than an
injected SDK release. Private IPC uses at most eight groups of 512 path/hash rows (4096 total), at most
1MiB, with duplicate/path/digest checks before the public map. This API fixture has its own grouped protocol; the separate SDK fixture's 1000-row cap and
decoder remain unchanged.

The isolated producer reserves stdout for its single JSON witness. Production `writeLog` still
uses its existing global Console; only this child redirects Console output to a private diagnostic
stream, which Python discards. Nest's `logger: false` does not suppress that production logger.
A separate regression makes a real HTTP request through freshly compiled production request hooks
and `writeLog`, then checks the strict Python IPC, including restoration after rejected work.
SQL spans may be children only of the original HTTP SERVER or tracking delivery INTERNAL span.
Visible provider/SQL parents are rejected even while other required rows are still pending.
Pinned OTLP flags are required canonical strings: `769` only on tracking delivery, whose immediate
parent was restored by the official W3C carrier extractor, and `257` on HTTP SERVER, provider CLIENT
and SQL CLIENT spans. The new delivery span has a local context, so its provider/SQL children do not
inherit the remote-parent bit. The compiled public TechnicalTelemetry context/serialization contract
checks actual pinned JSON and protobuf encoders, then feeds both flag results into the full-row oracle.
That focused contract does not execute the genuine API, PostgreSQL or pinned storage vertical.
The Node contract launcher owns a separate Python process group with bounded TERM/KILL cleanup.
Its Python entry point unwinds on TERM so native-child cleanup can finish before escalation.
Real outer-launcher tests acquire a native HTTP listener before timeout or interruption and verify
child/Python absence and port release, alongside successful and failed execution. Nested test owners
handle forwarded signals for their own groups; producer children never create detached sessions.

Run the isolated workflow for native acceptance. Pure contract tests and prepared source do not prove
this storage composition has executed. Even a successful hosted result covers only this one success;
retry, failed/rootless delivery, process-crash recovery, OFF/503, resource/cost acceptance, production
and seven actual days remain separate requirements. The fixed storage visibility budget is 60 seconds;
the existing native query/supervisor caps are retained.

### Isolated hosted short resource proof (#1566)

`observability-resource.yml` runs separately from the main application gate on disposable
Ubuntu 24.04. It admits a clean provider checkout with PR head/base, execution SHA/tree,
run ID and attempt, and hashes the conservative tracked backend/build/helper closure.
`hosted.py prepare` builds only `backend-production` from `apps/backend/Dockerfile` with
`INSIDE_RELEASE_VERSION=v1` and the actual checkout SHA, plus the unchanged foundation
Dockerfile using `infra/production/database` as its context. Unique run/attempt tags resolve
to two distinct immutable image IDs in a private five-field manifest. Seven digest-pinned
services are pulled before the runtime, whose Compose services retain `pull_policy: never`.
Builds and pulls have finite individual deadlines. No backup or restore is run.

The shared heavy-check guard surrounds preparation and the existing resource runner.
Its external worker budget remains 600 seconds. Recovery runs on every outcome for only the
registered random project. Collection retains actual admission metadata and the fixed
resource artifact whitelist. Compose/env, JWTs, query keys, TLS private material and raw
Engine bodies are never uploaded. Missing project acquisition makes collection fail and
records `no_registered_project`, without manufacturing a measurement. Missing or changed
source metadata is refused. Failed recovery and worker outcomes remain separate artifacts.

A green workflow is not resource acceptance. Inspect `resource-proof.json.state`, mode
validity, counter availability, lifecycle, worker outcome, cleanup and recovery together.
`partial` stays partial; even `completed_short_profile` retains `acceptance: pending`.
The proposed short synthetic SDK-only workload cannot size the Timeweb server or establish
representative production load, full retention, whole-host reserve or seven actual days.
The workflow adds no mandatory release gate. Native image builds and runtime compatibility
must be observed in a source-bound hosted attempt before claiming they work.

Backend and Web development roles keep the same complete dependency install ancestry. Their
`dependency-inputs` stages copy the same manifests and lifecycle sources; `dependencies` retains
the original full-workspace frozen install and shared BuildKit cache mount. The shared development
image also runs Web, so it still includes Web dependencies and root tooling. The former global
backend-only install filter broke that image and remains removed from the shared branch.

Backend production now derives `production-build` directly from `dependency-inputs`, with the
filtered source copied before installation. One `RUN` installs the backend transitive workspace
selection and root tooling, removes its fresh private `/tmp/inside-backend-pnpm.XXXXXX` install
store, compiles, deploys, then removes only the seven fixed root/selected-workspace `node_modules`
roots. Frozen-lock, initial package-import `copy`, lifecycle and the existing deploy selectors/runtime
flags are preserved. An install
failure retains its original status even if its store cleanup fails; later failure stops the build.
The complete `.production` parent must be absent before installation and is constructed by this
RUN. Physical ownership and same-RUN device/inode captures protect its ancestry and deployed output;
all seven dependency roots are checked before any removal. These checks assume a private, synchronous
RUN; they do not provide atomic protection against a concurrent writer with the same user identity.
The isolated production payload, dist,
CA and source artifacts remain. Deploy now uses the fresh literal private store
`/tmp/inside-backend-deploy-store`, constructed exclusively with mode 0700 after refusing any
existing file, directory or link. It keeps the existing package import policy. Same-RUN physical
parent/root ownership checks precede deploy and store removal; deploy settles before cleanup.
A deploy failure remains primary if cleanup also fails. A successful deploy with failed or unsafe
store cleanup fails the RUN before the seven dependency roots can be removed. Default stores,
cache/state directories and unrelated paths are not pruned. Store unlinking preserves hardlinked
payload files; hardlinks or clones can make the actual reclaimed bytes much smaller than apparent
store size. This does not remove source/toolchain layers or prove lower peak consumption.

Pinned pnpm records the resolved store path in deployed `node_modules/.modules.yaml`. Its new
fixed storeDir (`/tmp/inside-backend-deploy-store/v11`) is an intentional payload metadata difference
from the previous default-store location. The fixed path adds no random constructor suffix;
existing pnpm `prunedAt` can still vary between fresh installs. Full old/new payload byte equality
has not been established. The identity-only exclusion in the earlier native comparison plan does
not silently exclude or normalize this metadata; comparison needs an explicit reviewed disposition.
No pnpm-owned payload metadata is rewritten by this cleanup.

The original `production-dependencies` and `production-source` targets retain their direct-use
contents, but neither is a FROM/COPY ancestor of the selected production payload or late identity.
`release-identity` derives from the completed `production-build`; its arguments remain late. It
re-admits physical output ownership with fresh stage-local device/inode captures, without claiming
inode equality across Docker layers. Only that stage creates the fixed root `node_modules` link
to the deployed dependency closure for the unchanged identity writer and its existing zod import.
Final runtime COPY/commands and Web/development ancestry remain unchanged. These filesystem/source
contracts do not establish actual deployed ESM/native closure, cold/cache image equivalence,
cache reuse, savings, resource fit or production capacity. Exact-source hosted reference/candidate,
shared-development and complete resource checks remain required under the unchanged cumulative 4 GiB
policy and original baseline/floor. Peak allocation may still trigger the guard before cleanup;
no pruning, larger allowance, new baseline or deployment follows from this preparation.

For acquisition failures, `resource-acquisition.json` records a closed stage and boundary
(identity probe, child wait, inspection or publication), bounded outcome/counters/elapsed
values, and a separate cleanup outcome. It is written atomically in the checked metadata
directory before a runtime project exists. Public collection rejects duplicate JSON keys,
including escaped equivalents, unknown fields, nonfinite values and records over 4096 bytes;
it publishes a canonical verified projection. Commands, output, error text, registry references,
paths and credentials do not enter this record. A first command failure remains first when
cleanup also fails. `storage_guard_floor`, `storage_guard_growth` and
`storage_guard_floor_growth` distinguish the existing inclusive free-space and growth
boundaries using the same monitor sample. `storage_guard_read_failure` reports a storage-read
failure. `storage_guard_stop` remains the legacy or unknown-cause fallback. These records
contain no extra disk reads or raw errors. Filesystem growth does not measure image growth
or attribute storage consumption to one process. The optional observer preserves the existing
stop even if observation fails. Existing acquisition deadlines, identity checks, disk thresholds
and 600-second worker budget remain unchanged. These diagnostics cannot retrospectively
establish the cause of runs 39433543633 or 39441411789.

The resource-only `observe_samples=True` guard option retains the same already-read free-byte
values in a read-only memory view. Default callers still receive `None`. The source-bound
`resource-disk-samples.json` contains only a baseline, latest safe observation, stopping observation
and the last observation copied before the first pull command. Baseline sequence 0 is not safe.
The first-pull observation may be stale; it is copied once before command identity/start work and
does not measure a pull or image. The closed nine-field record is limited to 4096 bytes, validates
before public copying and is written canonically. Missing legacy metadata means unavailable;
invalid present metadata refuses collection. Numeric observation or persistence refusal blocks an
otherwise successful image manifest, while the original command/guard failure stays primary.

The final snapshot is sealed after the existing bounded monitor join returns. This cutoff does not
prove monitor termination, all reads or absence of a later signal. Late metadata cannot change the
sealed snapshot; the inherited late-monitor/SIGUSR1 hazard is unchanged. No extra disk or clock
read, monitor callback, threshold, poll, timeout or cleanup change is introduced. These facts do not
attribute filesystem growth to an image/process or establish savings, production sizing or resource
acceptance. Exact-source hosted feedback remains required; the previous numeric history is unknown.

### Platform waitlist receipt causality (prepared, before deployment)

The opt-in API records one nullable technical `traceparent` only when its existing transaction
creates a new waitlist confirmation. Replaying a join never replaces that carrier. The ordinary
five-second relay reconstructs each admitted row from its own validated carrier and ROOT_CONTEXT;
legacy NULL or invalid values remain rootless. Missing communications configuration performs no I/O.
A `waitlist deliver` observation contains only operation `deliver` and outcome `completed` or
`failed`. The single existing receipt POST is `telegram waitlist.confirm`. An accepted receipt
means queued acceptance, not Telegram message delivery. No business payload or trace headers change,
and no claim, retry or message-authority policy is introduced.

`.github/workflows/observability-waitlist-storage.yml` prepares a separate Linux-only proof:
compiled production API, genuine signed HTTP/JWKS, real PostgreSQL, committed carrier, API restart,
normal timer, owned receipt HTTP, API-owned SDK and pinned Alloy/VictoriaMetrics/VictoriaTraces.
The first API uses existing missing-provider configuration, so zero relay I/O follows from admission,
not a race against its timer. Only the restarted API enables the owned receipt provider.
It reuses the tracking proof's strict disposable PostgreSQL composition and typed cleanup ledger
(eight containers, five volumes, two networks), child owner and private diagnostics channel.
The API drains both pumps before closing their shared SDK, including a rejected sibling drain;
lifecycle failures stay in one aggregate after SDK cleanup.
Its own whole-vector metrics and complete raw trace oracle admit only the waitlist success roles,
including the genuine identity lookup. SDK serializer tests check mandatory role flags for JSON
and protobuf. This source route is not a completed native run or a capacity measurement.

Focused API integration tests cover restart/replay and ON, OFF and exporter503 business continuity.
Migration0113 appends a nullable field without backfill as entry116 after the canonical115-entry
prefix. The independent historical114 fixture, matching legacy replay, nullable row, old
named-column writer and no-op migration are checked separately. Native PostgreSQL and storage
checks require their hosted CI evidence. Failure/retry/rootless/OFF/503 through pinned storage,
Telegram receipt/worker/reverse authorization/BotAPI causal continuation, production and seven
actual days remain outside this success proof. No deployment is authorized for this work.


### Telegram runtime collector partition (prepared, before deployment)

`inside-telegram` has a separate finite collector catalog for receipt, authorization, committed
attempt and `sendMessage`, its HTTP routes, and nine metric families. Backend span and datapoint
instructions retain their previous order outside this partition. The existing B waitlist
`authorize` operation extends the backend enum alongside `deliver`; this is a separate explicit
delta from accepted ROOT, not byte equivalence to that baseline. Non-Telegram services, including
missing or unknown service names, retain the old metric catalog. Only `inside-telegram` admits
the Telegram catalog. Telegram spans
retain only their technical operation/outcome or finite HTTP attributes. Events, links, tracestate,
private status messages, metric exemplars and unrelated attributes are removed. Authorization alone
may retain a numeric HTTP status between 100 and 599. No user, chat, message or provider identifiers
are permitted.

The existing pilot smoke prepares an external unsafe JSON and independently encoded protobuf corpus.
Before uploading either, it observes the actual `none` logging driver on the same owned, running
VictoriaTraces and Alloy containers. Frozen daemon identity, Compose project and fixed service labels
are checked; missing, ambiguous, foreign, stopped or retaining containers prevent every upload.
It never reads container logs. `trace-store-logging.json` and `collector-logging.json` contain separate
closed verdicts. `telegram-runtime-collector.json` contains only bounded transport/count verdicts.
Raw OTLP and stored rows are not public artifacts.

The closed reader queries three fixed trace IDs per transport with an eleven-row limit, including
one duplicate-detection slot. Its independent oracle validates every observed column, all ten spans,
root and parent relationships, timestamps, resource/scope attributes and private-field absence before
accepting completeness. The metrics oracle validates the complete service/release vector, including
all fifty expected counter, gauge and histogram series; it never hides unknown metrics with a positive
metric-name selector. The synthetic corpus versions identify fixtures, not application image releases.

Source contracts exercise these boundaries with controlled Docker/HTTP adapters and worked stored
examples. They do not execute Docker, the pinned Alloy parser or native storage. A hosted exact-source
run must establish JSON/protobuf ingestion and stored verdicts. This external corpus does not prove
actual Telegram SDK serialization through storage, genuine PostgreSQL/RabbitMQ lifecycle behavior,
receipt-to-worker-to-authorization-to-BotAPI causality, server capacity or production readiness.
The prepared native database and lifecycle scenarios remain separate. No deployment is authorized.

`apps/telegram/test/integration/managed-main-lifecycle.integration.test.ts` also prepares real built
`main` cases for SIGTERM after readiness and during a genuine PostgreSQL migration-lock wait.
The existing Telegram `check:full` builds before running integration tests. These cases use the
managed factory, explicit disabled provider modes, an owned loopback OTLP receiver and supervised
pinned Node children. They check clean process exit and released PostgreSQL sessions. Periodic SDK
exports are allowed, so observed traffic does not establish SDK shutdown ordering. Original test
errors stay local; public failures contain only the first fixed observation stage and cleanup counts.
The separate benign-child source tests prove only the test harness's PID, signal, acquisition-failure
and cleanup observations. Native PostgreSQL execution, every business lane, RabbitMQ and the complete
shutdown failure-order matrix still require exact-source hosted evidence.

During terminal shutdown, an admitted receive rejection records its original error and waits only
for the snapshot of cancellation RPCs already started before closing its consumer channel. This
prevents closing over an outstanding `BasicCancel` reply. Later cancellations remain drain-owned;
genuine cancellation and close errors remain private failures in the drain report.

The Core named source manifest preserves its original 24 entries and adds the executed
`telegram_runtime_privacy.py` and `telegram_runtime_oracle.py` modules. The provider checkout/tree
and dirty-checkout gates still apply; old 24-entry receipts do not enumerate these two modules.

The genuine RabbitMQ suite prepares two terminal-receive cases: held work commits through the real
PostgreSQL provider and is acknowledged, or fails before commit and is re-delivered by RabbitMQ.
They inspect actual queue consumers and retrieve a new confirmed message after terminal `open`,
without a duration-based absence claim. These cases are not locally executed native evidence.
The separate prepared opening and publication scenarios are described below.

A further genuine RabbitMQ case prepares terminal stop while native TCP admission is held before
the AMQP handshake completes. Its test-only opening gate forwards through native sockets after
release and captures no payloads. Owned echo-peer tests verify only that TCP gate and its cleanup.
The genuine broker case must complete against hosted RabbitMQ, leave both queues without consumers
and refuse another connection after terminal drain. The broker's existing connection timeout stays
unchanged. Native AMQP execution is not established by the echo-peer results.

Two further RabbitMQ cases prepare an actual queued-result witness while the original publish
confirmation is held by native inbound socket forwarding. They then release confirmation or drop
only the owned TCP gate to exercise a genuine transport failure after publication. Terminal drain
must settle that original promise and retain its original private rejection. The native publisher
deadline and product retry/outbox policy stay unchanged. Additional echo-peer controls cover holding
inbound forwarding before and after connection establishment. They remain TCP harness evidence;
the genuine RabbitMQ publication cases require hosted execution.

`native-waitlist-factory.integration.test.ts` prepares five genuine PostgreSQL cases through the
actual managed Nest/Fastify factory. Its raw HTTP corpus distinguishes Node-normalized surrounding
OWS from whitespace remaining in parsed values, duplicate/coalesced headers, malformed parents,
strict-body rejection and failed bearer authentication. First receipt parents, including NULL,
remain immutable on replay; conflicts retain 409. Actual SDK JSON must continue only admitted
receipt parents while generic HTTP spans remain local roots. The pure parsed-header protocol has
one owner, `@inside/contracts/internal-waitlist-parent`; app adapters retain authentication and
strict-body admission timing. Its single corpus compares the exact nonzero-ID semantics with the
pinned official parser without adding an SDK dependency to the shared package. OFF and ratio zero cannot be forced
by a remote sampled flag; ratio zero keeps the independent operation counter with finite
`operation`/`outcome` labels.

The remaining two factory cases disconnect an actual request held on a genuine PostgreSQL advisory
lock. SDK, database and framework cleanup must not start before that handler settles. One case
injects fixed failures after each real cleanup completes and checks the original private error
order. These are prepared native cases, not local execution results. Their bounded SDK JSON
observation rejects private markers but is not the independent full stored-row collector oracle.
The separate receipt-037 PostgreSQL case uses actual owned callback HTTP and native fetch to
acquire the same row lock after preparation rollback. It retains a controlled send port, so it
does not establish native BotAPI delivery.

The first hosted execution path is `.github/workflows/ci.yml`, job `telegram`, on the reviewed
exact source. Its owned PostgreSQL and non-guest RabbitMQ serve
`pnpm --filter @inside/telegram check:full`, which builds the actual `main` before running all
integration files serially. This includes the two built-main, five RabbitMQ terminal-lifetime and
five native factory cases above, plus the receipt persistence/rollback cases. The coverage planner
selects `telegram` for Telegram application changes; shared collector, workflow, package and pilot
changes require the full shared coverage selection as well. Source-bound check output must record
the exact selected paths and checkout. No historical CI result accepts this new source.

Remaining acceptance gaps are explicit: a complete passing exact-source hosted rerun of these
PostgreSQL/RabbitMQ cases; every concurrently active production lane and activation-timeout descendant through the
full factory, including the complete startup/drain/cleanup fault matrix; the actual SDK through
pinned Alloy and both stores; and the cross-application receipt, worker, reverse authorization and
owned BotAPI HTTP stored graph with source/image witnesses. Existing actual Grammy loopback tests
exercise its pinned transport separately. Synthetic collector corpora, controlled send ports,
periodic exports and benign child/TCP controls cannot close those gaps. Native execution and
independent HIGH-risk review remain pending; production capacity has not been measured and this
preparation authorizes no deployment.

## Isolated native Caddy observation

[The Caddy pilot](observability-caddy-pilot.md) adds an opt-in native registry, fixed partition,
strict canonical/VM MCP readers and a separate hosted observation/cleanup matrix over Core7.
Core defaults and production Caddy are unchanged. Source and protocol checks do not establish
Linux/native acceptance; the bound hosted matrix is required. This scope adds no production,
server-sizing, resource-saving or #1579 acceptance.


### Prepared bounded feedback after the 288 source run

Resource numeric schema2 adds `after_backend_build` from the same guard-owned memory view,
after the original backend build returns and before foundation build. The first-pull checkpoint
stays separate. Schema1 remains strictly readable and is never upgraded with an invented point;
missing legacy metadata stays unavailable. Both versions retain the4096B cap and source binding.
The checkpoints can be stale and do not attribute image/cache/filesystem consumption. The guard,
its cutoffs and the inherited late-monitor signal limitation are unchanged.

Core `core-stage-timing.json` records23 fixed original call boundaries, cumulative elapsed and
completed durations. A stage becomes active before its original work. The closed source-bound
record has a16384B cap and capped integer milliseconds; it neither drives nor extends deadlines.
Default direct smoke callers allocate no timing owner. Invalid present timing refuses before
public copying; missing legacy timing means unavailable. Worker outcome and cleanup remain
necessary. An interrupted last active stage is not proof that its service caused the timeout.

Tracking gate06 retains its permanent semantic reason and whole-row predicate. Four closed
tracking-only failure refinements distinguish missing mandatory, unexpected key, expected value
and optional value mismatches, in original order. No field names, values, roles or IDs enter the
seven-field2048B diagnostic. These refinements reject the same rows and do not establish a native
cause. All three owners preserve the original failure and traceback even when persistence throws
the same exception object. New exact-source hosted feedback remains required; no capacity,
production deployment or #1579 acceptance follows from these source contracts.

### Tracking unexpected-key facts

The tracking worker prepares a separate `tracking-unexpected-keys.json` after its original storage
cleanup, result and diagnostic finalizers. This diagnostic-only record has exactly eight fields
(`schema`, `scope`, `source`, `state`, `gate`, `role`, `known_keys`, `other`) and a512-byte limit.
The first unexpected-key refusal can retain one of five fixed causal roles and sorted IDs
`a01` through `a21` from the existing non-Telegram collector span catalog. An arbitrary additional
key is represented only by `other: true`. Raw keys, values, hashes, row IDs and error details are
never recorded. The mapping is owned by `scripts/observability-tracking-storage/unexpected_keys.py`.

The observer binds the existing producer Git read once; direct oracle/producer/storage callers
with the default `observation=None` allocate no observer and perform no additional observation IO.
The observation channel itself leaves the row predicates, their order, original refusal and polling
budget unchanged. Only an actual first `trace_gate_06_unexpected_key` refusal produces `observed`; an earlier different
refusal or no observation stays `unknown`. An internal observer fault yields `refused`, and an
unbound observer writes nothing. Observation persistence never replaces an already active error
or its traceback. With no active error, a persistence failure refuses the diagnostic operation.

Collection admits the complete record and existing source receipt before creating the public
copy. `observed` additionally requires the original validated diagnostic to report
`trace_validation`, `failed`, `trace_gate_06_unexpected_key`. A missing legacy record becomes
canonical `unknown`; an invalid present record refuses. The collector rewrites canonical JSON
through the tracking-owned pinned-inode writer and never copies raw record bytes. This adds no
new receipt input-map, tree or scope-text equality requirement. Only the new record reader opts
into preserving first acquisition/read errors across secondary close failures; legacy read and
source-receipt defaults retain their previous behavior.

These source controls do not identify the unexpected key from a prior hosted failure. A fresh,
source-bound hosted tracking result is required to identify any catalog ID and role. `other: true`
cannot identify a key outside that catalog. This feature changes no collector acceptance rule,
production setting or deployment status.

### Tracking provider HTTP success evidence

Tracking provider spans now require the existing three dependency attributes plus exact
`http.request.method=POST` and `http.response.status_code=200`. Both original-HTTP and delivery
provider edges must carry these fields. The production communications observer emits the method
and records the actual response status; the owned success provider returns200 for both operations.
The existing backend collector retains these fields under its method enum and integer-status
filter. The Tracking oracle owns this success expectation; collector and producer behavior are
unchanged.

This corrects an admission mismatch. The previous oracle rejected the legitimate provider HTTP
fields and admitted synthetic provider rows that omitted them. Those missing rows now refuse;
other methods/statuses, nonstring raw fields, wrong roles and unsafe extras still refuse. The
permanent gate identifiers and predicate syntax/order remain fixed, while the provider's required
attribute set intentionally changes. The closed unexpected-key observation remains diagnostic only.

The bound680d failure reported provider catalog IDs `a02` and `a04`, with `other=false` at attempt40.
It measured key presence, not their raw values. `POST/200` comes from the checked source contract;
no raw native value measurement is inferred. The actual compiled factory source contract is
prepared to pass its strictly validated provider HTTP pair into the full oracle alongside the
existing JSON/protobuf flag witness. Source tests do not establish native API/PG/Alloy/storage
success. A fresh source-bound hosted Tracking run and cleanup are still required, and a later
refusal remains a failure requiring its own diagnosis.

### Dependency corpus scheduling

`dependency_catalog_corpus` first uploads the same sixteen JSON/protobuf trace and metric bodies
for the dependency, communications and Telegram HTTP pairs. It then runs the same six full stored
trace oracles, in pair order, followed by the existing whole metric-vector oracle. Each pair keeps
its original captured timestamp. Logging admission and each upload's daemon-identity check still
precede unsafe ingress. Sent bodies are released; the scheduling records contain only the six
fixed partition/transport/timestamp tuples. Polling, query limits and worker deadlines are unchanged.

Failure prefixes differ from the earlier interleaved schedule. A later upload failure leaves no
successful read cases. A trace refusal happens after all sixteen uploads, so later unsafe fixtures
can already be present; only earlier successful reads enter the proof. A metric refusal retains
six successful trace cases. Every refusal still fails the corpus and prevents the next corpus.
HTTP200 and a completed upload never substitute for a full storage verdict.

The deterministic visibility model uses the real builders, full oracles and existing poll loop.
With zero upload/read cost and fixed four-second visibility after each pair's final upload, the
old schedule took24 virtual seconds and the prepared schedule takes4. With an additional0.5-second
cost for every trace read, the same model takes25.5 and6.75 seconds respectively. These figures
model shared waiting only. They do not measure native latency, command overhead, VT flush behavior
or production capacity. Exact-source hosted Core completion, freshness and cleanup remain required.

### Resource source-test progress

The Resource stdlib wrapper keeps its existing 30-second process deadline and
process owner. Its private captured stderr adds fixed start/completed markers for
the exact source-test inventory. The parent validates the complete ordered prefix
and byte bounds before reporting only the last started/completed method and count.
Missing, malformed or truncated markers report `unknown`. Output-limit failures
report constant `unknown` without reading the captured stderr.

Both original exit-reason and exit-code assertions remain required. Completed means
that a test stopped, not that it passed. The first HTTP/identity group and third
real backend corpus group remain unchanged. These source diagnostics do not explain
earlier hosted timeouts, increase a budget, or establish native capacity acceptance.

### Prepared ordinary-role PostgreSQL server source

The independent `postgres-source` job in `observability-tracking-storage.yml` prepares an opt-in,
disposable source under `scripts/observability-postgres-storage/`. Existing Core and application
startup do not launch it. It reuses the tracking owner's pinned PG18.4 container and strict
ownership without the tracking API, migrations or timer. The fixture administrator creates its
synthetic role/table and actors only in that disposable database. The sampler uses a separate
ordinary read-only login with one connection, no monitoring memberships and only CONNECT.

One fixed thirteen-column query supplies seven server gauges: connected backends, waiting locks,
deadlocks since reset, postmaster start time, statistics reset time, sample time and availability.
These are separate from the existing application pool gauges and SQL dependency spans. The whole
private row and both complete stored service vectors are validated before projection. Reset,
restart, stale data and failed acquisitions do not create complete healthy counting intervals.
The collector admits these seven names only for `inside-postgresql-source`; its traces/logs are
dropped, and point attributes/exemplars are cleared. Existing backend/Telegram programs retain
their catalogs. Exact pinned Linux adaptation and actual database visibility remain NOTRUN.

The fixture uses150 seconds of work plus30 seconds for actor/client settlement after acquisition.
That180-second envelope excludes Compose startup and existing container cleanup. The existing
outer600-second worker, up240-second limit, process shutdown and down90-second command remain
unchanged. Each sampler has at most4 seconds of work plus2 seconds TERM and2 seconds final
settlement. A successful child exit alone is insufficient: client end, reaping, current ownership
and backend absence must also be observed within the work boundary. The private failure exit2
means only that public client end fulfilled; the parent still requires reaping, current ownership
and backend absence under the same work deadline. There are exactly two admitted zero origins:
a verified failed acquisition, or the controlled graceful stop proof described below. Both publish
only current availability0, without refreshing the six facts or advancing the continuity ledger.
Unproved settlement/ownership exports nothing. The first failure survives verification or emission
failures. Exhaustion fails without expanding grants or deadlines. Native role visibility, eight-second feasibility, lock/deadlock,
reset/restart, stale recovery and typed cleanup remain NOTRUN.

The controlled stop closes/reaps fixture clients first, checks the current frozen PostgreSQL
owner, stops that exact CID with the existing two-second grace, checks daemon identity and fully
re-inspects the same frozen target. It then performs only this fixed daemon-side projection:

```text
docker inspect --format '{{if and (eq .State.Status "exited") (not .State.Running) (not .State.Restarting) (not .State.Dead) (not .State.Paused) (not .State.OOMKilled) (eq .State.Pid 0) (eq .State.ExitCode 0) (eq .State.Error "")}}stopped{{end}}' <frozen PostgreSQL CID>
```

The stop response must be the exact frozen CID (logical cap65UTF8 bytes). The state response must
be exactly `stopped` with an optional newline (logical cap16UTF8 bytes). These are checks of fixed
CLI projections, not subprocess allocation bounds. Deadline checks and zero emission use the same
decreasing remaining phase allowance inside150 seconds. The stop passes its frozen absolute
deadline into `upload`; only `upload` owns the HTTP alarm. Its pre/post ownership checks and HTTP
transport consume that same remaining time, without a new ten-second allowance or nested alarm.
Ordinary uploads retain their existing maximum ten seconds. The shared alarm guard still refuses
an already active timer. Unknown state, nonzero exit, malformed
response, identity drift, active/unsettled client or exhausted time refuses before emission. A
failed sampler call is never a substitute for this stopped-owned proof. The ordinary successful
acquisition path, read-only query and its eight-second accounting remain unchanged.

All present retained identity values and their raw timestamp cohort are validated before zero,
missing or ownership projection. Current singleton0 is admitted; a newer availability0 may coexist
with six valid older facts. Their sample timestamp is not refreshed. Future/mixed/inconsistent
retained identities are refused, and an old availability0 observation is stale rather than current.

Privacy challenges additionally read the exact anchored union of the seven server families across
all services. Every returned row passes the same full raw gate; foreign or extra rows are refused,
never filtered before validation. The normal two service reads remain unchanged. The combined
protocol-only three reads share one ten-second deadline and evaluation time. Fresh source values,
HTTP200 and a single metric edge do not prove that every surviving series from the same request
has completed processing and insertion. That pinned end-to-end proof is an explicit prerequisite.
The source now implements the current-request export/flush barrier described in
[PostgreSQL completion](#postgresql-завершение-текущей-проверки-приватности). Native verification
remains pending. The latest pre-barrier native run stopped in baseline/query_refused with no
completed cases; its exact failing step and cause are unknown. A successful native privacy verdict
is not established by the source controls or this documentation.

Baseline failures retain the existing reason projection and eight-field, schema1,4096-byte
`postgres-source.json`. Its top-level phase now identifies the last entered fixed boundary:
`baseline_actor_start`, `baseline_setup`, `baseline_waiting_locks`, or one of
`baseline_first_acquire`, `baseline_first_upload`, `baseline_first_stored_read`,
`baseline_first_stored_oracle`, `baseline_first_stored_pending`, `baseline_first_ledger`,
`baseline_second_acquire`, `baseline_second_upload`, `baseline_second_stored_read`,
`baseline_second_stored_oracle`, `baseline_second_stored_pending`, `baseline_second_ledger`.
First and second are the two existing baseline observations. Entry does not prove completion
or identify the underlying cause. Successful cases keep phase `baseline`; these technical phases
are refused in case entries. The markers add no query, clock, IO, retry or time allowance. The
latest retained native failure remains baseline/query_refused with empty cases and an unknown
failing boundary; privacy was not reached. A future source-bound run can distinguish that boundary,
while diagnosis of its internal cause and native completion acceptance remain separate.

Перед первым клиентом PostgreSQL и после перезапуска проверяется TCP `127.0.0.1:5432`
внутри уже проверенного контейнера, а не временный Unix socket инициализации.
PG и Tracking используют один фиксированный `pg_isready -h 127.0.0.1 -p 5432 -t 1`
с прежними пользователем и базой. Общие сроки, ограничения команды и существующий цикл
ожидания сохраняются; успешная проверка слушателя не подтверждает SQL или приватность.
Последний измеренный отказ `baseline_setup_connect/query_refused` занял 39,522 с с учётом
подготовки. Исправление устраняет неверный критерий готовности; связь с конкретным
native-отказом ещё не подтверждена новым прогоном.

Внутри `baseline_setup` последний вход в операцию можно уточнить до
`baseline_setup_connect`, `baseline_setup_identity`, `baseline_setup_reader`,
`baseline_setup_grant_connect`, `baseline_setup_read_only`, `baseline_setup_schema`,
`baseline_setup_table`, `baseline_setup_rows` или `baseline_setup_reset`.
Только отказ уже проверенной команды setup получает код завершения 101..109.
Node сохраняет фиксированный этап до прежней очистки и повторно выбрасывает исходную ошибку.
Текст и свойства ошибки не читаются; успешный stdout, SQL, права и порядок запросов прежние.
Python принимает этап только после отправки setup, полного отсутствия stdout до EOF
и завершения того же дочернего процесса в пределах исходного общего срока команды.
Уже завершившийся до команды процесс, посторонний или неполный вывод, сигнал,
неизвестный код, ошибка чтения или истечение срока оставляют прежний общий отказ.
Код никогда не превращает отказ в успех и не добавляет времени ожидания.
В `postgres-source.json` остаются восемь полей и лимит 4096 байт; технический этап
не допускается в успешных case-записях. Это измерение места отказа, а не исправление SQL.
До уточнения этапа native-прогон остановился в `baseline_setup/query_refused` за 39,710 с
с учётом подготовки. Причина пока неизвестна; приватность не проверена.

Public curation validates the owned source receipt and closed `postgres-source.json` before
creating the destination. Raw SQL rows, query responses, credentials and identities stay private.
Для отказа `baseline_first_stored_oracle` или `baseline_second_stored_oracle` существующее
поле `reason` также допускает закрытые `oracle_*` причины первого локального отказа.
Они различают stale/unavailable, группы JSON/envelope/row/labels/number для значений
и timestamps, затем join, identity, cohort и сравнение ожидаемого frame. Это категории
проверок, а не доказательство причины SQL или сервера. Неизвестная ошибка остаётся
`oracle_malformed_unknown` либо прежним общим отказом. Старый `query_refused` по-прежнему
читается без приписывания ему новых фактов. Восемь полей, schema 1, лимит 4096 байт,
все проверки допуска и порядок отказов сохраняются. Причина не переносится между попытками
и не превращает failed или pending в passed. Последний ec47 отказ остаётся неизвестным
до нового отдельно допущенного source-bound прогона; raw vectors для него не сохранены.
Final success additionally requires both the original Core7/4/2 and complete PG8/5/2 typed absence
proofs; generic Compose down/residue is insufficient. This source preparation does not authorize
production rollout, server changes, capacity conclusions, provider messages or #1579 actions.

### PostgreSQL: завершение текущей проверки приватности

Изолированный PostgreSQL-прогон создаёт собственную копию конфигурации Alloy.
Только в этой копии у экспортёра метрик выключены очередь и повторные отправки,
а HTTP timeout равен двум секундам. Общая конфигурация Core и обычный tracking-прогон
используют прежние настройки. Состав контейнеров, образы, порты, маршруты vmauth/MCP,
ресурсные ограничения и проверки очистки не меняются.

Каждая из шести фиксированных проверок приватности отправляет текущий SQL-снимок
и свой контрольный пакет одним JSON-запросом размером не более 4096 байт.
До чтения хранилища нужны два последовательных подтверждения: полный успешный ответ
на этот запрос от синхронного конвейера Alloy, затем пустой успешный ответ на
аутентифицированный `/internal/force_flush` того же принадлежащего стенду VictoriaMetrics.
После этого полностью проверяются три исходных вектора S, T и G. G охватывает семь
фиксированных семейств метрик без ограничения по service. Свежие положительные строки
сами по себе не подтверждают отсутствие запрещённых строк.

Вся последовательность, включая проверки принадлежности ресурсов, укладывается в один
убывающий срок 10 секунд и оставшееся время работы сценария 150 секунд. Отправка получает
не более четырёх секунд, flush не более двух. Дополнительные попытки и увеличение сроков
не предусмотрены. Ответ с partial success, перенаправление, неизвестное содержимое,
несовпадение ресурсов, неуспешное закрытие транспорта или превышение срока останавливают
проверку. Таймаут не означает отмену операции внутри VictoriaMetrics. Перед продолжением
нужна существующая полная очистка принадлежащего прогону стенда.

Если однократное отключение собственного таймера завершилось ошибкой, его уже
установленный обработчик становится инертным до освобождения ресурсов. Предыдущий
обработчик сигнала восстанавливается только после подтверждённого отключения таймера.
При неизвестном результате отключения новые проверки в этом процессе запрещены;
существующий внешний владелец завершает процесс. Это отказ проверки и неподтверждённое
освобождение таймера, а не успешная очистка или разрешение продолжить работу.

Flush доступен только из этого Linux-прогона по точному частному IPv4 принадлежащего
стенду metrics-контейнера. Проверяются исходный локальный Docker daemon, контейнер,
сеть и локальный bridge. Другой daemon, Docker Desktop, неоднозначный адрес или
недоступный bridge означают отказ без перехода на другой маршрут. Новый порт хоста,
утилита внутри образа или маршрут доступа через MCP не добавляются. Случайный ключ
передаётся контейнеру только через фиксированную переменную окружения; у metrics
выключен Docker logging. Для Alloy явно задан UID:GID владельца существующего частного
файла учётных данных; такой же владелец требуется у копии конфигурации с правами 0600.
Проверяются фактический пользователь контейнера, прежняя команда, read-only root filesystem
и cap_drop ALL. Образы, остальные параметры Core и tracking не меняются. Совместимость
точного образа и локального Linux user namespace с этим пользователем требует native-проверки.
Ключ, конфигурация Compose, адреса и необработанные ответы
остаются в частном каталоге и не входят в публичные артефакты.

Проверки исходного кода подтверждают порядок запросов, строгую обработку ответов,
полную проверку векторов и освобождение принадлежащих тестам ресурсов. Они не заменяют
Linux-прогон на закреплённых образах. Доступность bridge, фактическая настройка ключа,
порядок обработки настоящего экспортёра, видимость после flush, отказ при пропущенных
чужих строках и соблюдение временных границ требуют отдельного подтверждения в CI.
Эта подготовка не подтверждает готовность production или размер необходимого сервера.

### Passive Core source-test feedback

The fixed source runner is selected only on Linux with `INSIDE_CORE_SOURCE_PROGRESS=1`.
Default callers and every non-Linux caller, including a Mac with that flag, retain the original
registration, synchronous `python3 -m unittest discover` call, arguments, options and assertions.
The opt-in uses `source_runner.py` with the same original synchronous `spawnSync` lifetime and
30-second timeout. `maxBuffer` remains omitted, preserving the inherited Node default. No new
combined or per-pipe capture allowance, process owner, signal handling, rescue or process-tree
cleanup guarantee is introduced.

Normal unittest discovery still owns the original 274 methods, order, warnings, result and exit
semantics. The progress owner validates the entire fixed inventory before running the original
suite. Fixed start/completed lines share captured stderr with normal unittest output. `completed`
means the original `stopTest` callback was reached; it does not establish success. Marker write
`OSError` can lose optional metadata. An active original exception and its built-in traceback
remain primary; an otherwise unhandled interrupt or exit is not swallowed.

The Linux assertion validates the whole ordered marker prefix before showing only fixed source
IDs and a completed count. Missing, malformed, oversized or foreign metadata yields `unknown`.
`ENOBUFS` selects `unknown` before inspecting stderr. The independent parser bounds are 1 MiB of
UTF-8 stderr and 131072 marker bytes; they do not change the omitted `spawnSync.maxBuffer` default.
Native exit status, spawn error and signal remain authoritative. Even a complete marker stream
cannot turn a failed native outcome into a pass, while missing markers do not reject a successful
native outcome. Raw captured unittest text is not the opt-in Linux assertion message.

Three separate synthetic Python protocol controls live outside `test_*.py`; they do not add or
replace any of the original 274 methods. Synthetic dispatch/parity checks do not establish an
actual admitted Linux run or explain an earlier source timeout. Their separate assertion can
identify a failed protocol method and the fixed category `failure` or `error` from one optional
failure-only footer. It reads no traceback text. The three fixed positions do not report start,
completion or success. Missing, foreign, truncated or oversized metadata stays `unknown`; native
status, spawn error and signal remain authoritative. This feedback does not fix or explain a
Python-version-specific failure. Hosted exact-source verification
is still required. The stronger withdrawn owner/guardian proposals and their open
`CORE-PROG-SEC-01`, `CPROG-PRE-01` and `CPROG-PRE-02` findings are neither fixed nor waived here.
Application CI activation is a separate reviewed change to the existing tooling step only; it
must not opt in the direct functional workflow or widen any source or native gate.

## Confirmed active Membership Accounts

Platform MCP registers `active_participant_diagnostics` for a trusted delegated Account. Each call
checks current `platform:admin` before reading private activity. Input is exactly `from` and `to`,
ISO instants with UTC or an explicit offset, describing `[from,to)` with a maximum length of 31 days.
The report returns normalized UTC instants and names `Europe/Moscow` as the calendar. To query a
Moscow calendar day, supply its midnight boundaries with `+03:00`. No actor override or new permission
is accepted.

Membership is the distinct union of Account IDs from the existing ReadingActivity, Bookmarks and
Product Tasks confirmed-activity capabilities. Learning starts, manual reading transitions, bookmark
changes and submitted tasks count; repeated receipts do not create another Account. No browser
observation, checkout, historical first/last open or background review is synthesized. Only aggregate
counts and fixed source provenance are returned, never Account IDs or event rows.

Each owner enforces its own read-only snapshot, 365-day event-time horizon and Account/kind group
budget. The report sends the same normalized interval to all three owners but does not claim an atomic
cross-owner snapshot. Each source exposes its own `asOf` and `retentionFrom`. Historical coverage stays
`partial`, `collectionStartedAt` is unknown and continuity is `not_proven`. A successful empty query is
observed zero under that incomplete coverage. Any failed or overflowing owner makes the Membership
count `null`/`unknown`, even if another owner returned rows. The output does not publish a partial sum.

Telegram, combined cross-surface Accounts and unlinked Telegram contacts are explicitly
`not_collected` with `count:null`. They are not zero and the combined count is not copied from
Membership. This report therefore does not complete the cross-surface active-participant criterion.
It also does not implement physical deletion of activity history. Existing domain records remain
owned by their capabilities; the read horizon is not evidence of physical retention cleanup.

## Membership analytics-copy retention

`ReadingActivityRetention` and `BookmarkActivityRetention` clean only
`reading_activity.learning_started_events` and `bookmarks.activity_events`. Primary learning starts,
reading transition events, command receipts, states/visits, current bookmarks and saved submissions
remain source records and are not swept. Their existing 365-day report horizon is not physical TTL.
Expired analytics copies are not reconstructed from first/last opens or current state after deletion.

Each owner uses its PostgreSQL transaction timestamp minus the existing 365-day duration. Selection,
DELETE recheck and oldest-expired query use the same exact database arithmetic. UTC timestamps are
serialized as text with six fractional digits; no JavaScript Date round trip changes the cutoff.
Equality is retained. Each pass locks at most 1000 expired event IDs in `(occurred_at,event_id)` order
with `SKIP LOCKED`, deletes only those still expired, then reads at most one remaining oldest expired
row. A pass never drains in a loop or counts the entire backlog. Statement timeout is 2 seconds,
transaction timeout 5 seconds, acquisition bound 1 second. ReadCommitted transactions expose the oldest
remaining row at that query; `asOf` is their database transaction clock, not a common cross-owner
snapshot. A concurrently locked expired row can conservatively remain visible in the lag result.

The existing billing-worker registers `membership-activity.retention`, a tenth fixed pg-boss queue.
It schedules one pass per minute in UTC and sends one startup job, with no immediate retry. Each job
attempts both owners once. An earlier committed batch remains committed if the other owner fails;
the job fails and a later pass continues. Original nine queue policies and the separate daily
web-telemetry 30-day cleanup stay in place. Existing billing bootstrap validation can prevent this
worker from starting; this change does not remove that guard or promise cleanup during an outage.

Read `activity_retention_diagnostics` through existing Platform MCP with a trusted delegated Account
holding current `platform:admin`. Input is exactly `{}`. The tool exposes each fixed owner's known
or unknown status, database `asOf`/cutoff, `hasMore`, oldestExpiredAt and lagSeconds beyond cutoff.
It never deletes data or returns event/Account IDs, raw errors or a complete backlog count. A known
empty result has `hasMore:false` and null oldest/lag. Failed queries remain unknown. The separate
status tool preserves the existing active-participant query budget. Application logs alone do not
prove agent-visible lag because the pilot collector redacts their bodies.

Precommit failure rolls back one batch. A postcommit crash before job acknowledgement can leave a
failed receipt followed by an idempotent next pass. Deleted expired copies cannot be restored by a
command replay; recovery of historical copies, if required, uses the existing compatible database
backup/restore procedure. Restored expired copies become eligible again. Primary product behavior
and durable replay authority are retained. Row deletion does not measure PostgreSQL page/disk
reclamation, backup retention or Umami cleanup/restore.

Current preparation requires genuine PostgreSQL boundary, concurrency, rollback and primary-state
invariance evidence plus actual worker scheduling in hosted CI. Source/adapter checks do not prove
next-day cleanup under backlog or ingestion, worker availability, production capacity or runtime
privacy. No production cleanup, deployment or server change is authorized by these source changes.

### Partial retention passes and registration failure

A failed cleanup job retains a closed, validated `activityRetention` report on its fixed Error.
The pinned pg-boss failure path serializes this enumerable field into the failed receipt. It contains
only the two fixed source outcomes and safe aggregate count/cutoff/lag fields, at most 4096 UTF-8
bytes. An earlier committed owner batch is therefore distinguishable from a failed other owner;
no original exception, Account/event ID or payload is attached to that report. Successful receipts
use the same owned field. Serializer unit evidence is not a real failed-receipt persistence proof.

`activity_retention_diagnostics` returns `lastPass` separately from the current two owner statuses.
The infrastructure reads only this queue's owned report projection. It materializes at most 2001
primary-key-ordered retained job headers. More than 2000 candidates yields unknown rather than a
latest result from a truncated set. Otherwise it selects the latest completed/failed receipt from
that complete bounded set. Missing, oversized or invalid latest reports remain unknown; an earlier
success is never substituted. Neither job IDs, payloads, full outputs, messages nor stacks are
returned. Terminal state and closed report outcome must agree. The original general queue report
continues to read no payload/output columns.

The last retained receipt includes database clock, completion time and age. Age over 600 seconds is
`stale`, otherwise `recent`; neither proves worker health or next-day cleanup. Expired receipt
retention, no terminal receipt, schema failure and budget overflow remain explicit unknown states.
After one current admin check, the three independent reads start concurrently. Each retains the
existing one-second acquisition/five-second transaction allowance, so their composition has a
six-second allowance plus the existing authorization check, with no retry or caller budget control.
Actual end-to-end compliance with the ten-second query requirement still needs hosted evidence.

Only registration of the new retention queue is caught locally. Its sanitized failure is reported
while registration of the original nine queues proceeds; their own failures and existing bootstrap
validation still propagate. A billing-worker ready record does not certify retention registration.
Missing queue, backlog, current lag and missing/stale/unknown pass evidence must be checked together.
Owned database-trigger registration refusal and actual partial-job continuation fixtures are prepared
for hosted verification. Local source checks do not establish their native result. A process kill
precisely after one owner commit and recovery after that crash remain unverified.
