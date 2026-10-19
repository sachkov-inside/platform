# Пилот наблюдаемости Platform

Статус на 19.10.2026: подготовлен исполняемый **кандидат** первого технического smoke
для [#1566](https://github.com/sachkov-inside/platform/issues/1566) /
[принятой спецификации #1565](https://github.com/sachkov-inside/platform/issues/1565).
Совместимость комплекта в runtime ещё не проверена. Production не менялся; аналитика не включалась.
Этот smoke не является полным ресурсным пилотом или выполнением спецификации.

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
этого размера плюс один байт и требует точного размера и SHA256; дополнительный memory cap — 128MiB.
У VictoriaLogs datasource v0.33.1 опубликованный ZIP занимает 79,389,151B и превышает прежний
общий предел 64MiB. Проверенная по закреплённому digest центральная директория ZIP содержит
45 entries общим распакованным объёмом 224,056,733B; крупнейший entry — 28,246,176B.
Эта проверка 19.10.2026 читала архив в памяти, без распаковки или выполнения. Точный
`unpacked_size_bytes` закреплён отдельно; перед распаковкой требуется совпадение, в пределах 256MiB.
Сумма compressed/unpacked размеров этого plugin — 303,445,884B, внутри общего growth cap 4GiB;
расход images и всего workload по-прежнему проверяется самим пилотом.

## Изолированный запуск

Нужны Linux Engine с локально доступным `DockerRootDir`, Docker Compose, Git, Python 3.9+
и сеть только для получения pinned images/artifacts. Checkout должен быть чистым и
закоммиченным. Mac/OrbStack сейчас не поддержан runner: путь к его хранилищу не установлен,
и скрипт отказывает до получения images. Поддержка Mac как места запуска стека остаётся открытой.

```bash
bash scripts/heavy-check.sh python3 scripts/observability-pilot/pilot.py run
```

Запуск не использует production env, volumes, порты или Compose project. Проект получает имя
`inside-observability-pilot-<random>`; сеть internal. Занятые порты приводят к отказу.
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

Три native Victoria MCP скачиваются с проверкой SHA256 и запускаются по stdio на Linux:
initialize → tools/list → query известного fixture. Tools discovery и CPU seconds дочернего
процесса сохраняются; stderr не сохраняется. Выполнение на Mac и его отдельный расход CPU
остаются обязательной последующей проверкой. Umami MCP ещё не подготовлен.

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

После шага запуска `always()` выполняет best-effort recovery только зарегистрированного случайного
проекта. Значение project/cwd проверяется, команда Compose конструируется заново; argv из owner JSON
не исполняется. Если worker или его process group ещё существует либо регистрация неполна,
recovery отказывает, чтобы
не опережать продолжающийся `up`; после завершения job остаётся утилизация disposable VM провайдером.
Обычные выходы/timeout/signals по-прежнему обслуживает собственный supervisor.

Зелёный hosted smoke подтверждает только проверенный синтетический Linux сценарий этого source.
Он не доказывает запас Timeweb VPS, работу stdio/CPU на Mac, полный согласованный resource workload,
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
реальное удаление Docker resources пока не проверено. SIGKILL самого supervisor, уничтожение
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

- Mac stdio для Victoria MCP; Umami read-only MCP, ключ отдельного пользователя и отзыв.
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
