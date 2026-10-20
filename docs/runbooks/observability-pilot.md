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

После объединения с main `2f530002` registry сохраняет его первые 102 миграции,
включая `0101_waitlist_confirmations`, и добавляет прежние 11 миграций observability
без изменения их SQL или имён. Всего зарегистрированы 113 уникальных имён.
Порядок задаёт registry, а не числовая часть имени. Исторический неопубликованный
registry0108 расходится с текущим main на позиции102 и не поддерживает автоматический
upgrade в этот объединённый source. Проверка сохраняет его frozen digest и доказывает
отказ без изменения ledger; отдельный сценарий проверяет current main0101 →113.
Эта PostgreSQL-проверка требует CI или отдельной разрешённой базы данных.

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
It is the 114th registry entry and adds one nullable `varchar(55)` column without changing the
first 113 entries. An old binary can ignore the column, but a database with all 114 ledger entries
must retain the compatible registry during rollback. Historical NULL is supported; an absent
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
trace ID, объектов, signed URLs или необработанных ошибок.

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
