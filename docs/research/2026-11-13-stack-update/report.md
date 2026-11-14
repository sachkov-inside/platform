# Обновление стека Inside Platform, #2117

Работа продолжается. В production изменения этой сессии не применены.
BASE_SHA: `e514406f9ec774b6ede2524b9638480617c44a24`, актуальный origin/main при начале работы.
Worktree `2117-update-entire-stack`, ветка `chore/2117-update-stack`, основной PR #2136.

Основной PR слит 14.11.2026 в `07ed26b7b67693cc475b2202208ab1c6639ae8dc`.
Владелец разрешил merge, публикацию и production, операция ведётся в [production lock #2144](https://github.com/sachkov-inside/platform/issues/2144).
Публикация Platform обнаружила несовместимость Compose на runner; отдельное исправление и
фактические версии описаны в [Compose toolchain](compose-toolchain.md).

## Зависимости и источники

[inputs.json](inputs.json) перечисляет Docker/Compose/CI inputs до и после по файлам.
[packages.json](packages.json) перечисляет все отслеживаемые package.json, включая приложения,
общие пакеты и учебный fixture. `before` прочитан из BASE_SHA, `candidate` из рабочего дерева.
Источники выбранных версий: npm registry dist-tags, даты публикации, полный рекурсивный
`pnpm outdated`, audit и разрешённый граф lockfile. Корневой outdated отдельно не использовался
как полный список приложений. После обновления прямых зависимостей обновлён транзитивный граф.

| Компонент | До | Кандидат |
|---|---|---|
| Node | 26.10.0 | 26.13.1 |
| pnpm workspace | 11.27.1 | 12.18.0 |
| Corepack | 0.36.0 | 0.36.0, актуальный стабильный |
| npm в сборочных образах | из базового образа | 12.2.2 |
| Vitest | 4.1.11 | 5.1.0 |
| Storybook | 10.6.1 | 10.6.7 |
| Prisma | 7.10.0 | 7.10.1 |
| Учебный Codex CLI | 0.163.0 | 0.169.0 |

Prisma latest указывает на 8.0.0-rc.33, поэтому выбран стабильный 7.10.1.
Частные патчи Storybook, Vitest и Testcontainers перенесены на новые версии.
Строгие peer dependencies, quarantine 1440 минут и политика build scripts сохранены.
Сборочные npm и esbuild не остаются в соответствующих финальных слоях, где они не нужны.
Новые axe-проверки выявили несовпадения видимых подписей и имён для экранного диктора.
Исправлены подписи и связанные проверки без отключения правил доступности.

## Безопасность

| Аудит pnpm | critical | high | moderate | low |
|---|---|---|---|---|
| Исходный граф | 6 | 14 | 21 | 5 |
| Кандидат, все зависимости | 0 | 0 | 0 | 1 |
| Кандидат, production-зависимости | 0 | 0 | 0 | 0 |

`deepmerge@4.3.1` остаётся в отчёте по версии. Опубликованного исправления
[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) нет.
Добавлен частный патч, который исключает `__proto__` из клонирования target и слияния source.
Регрессионная проверка сначала воспроизвела подмену прототипа, затем прошла с патчем.
Это исправление проверяется отдельно от метаданных audit, исходная версия не переименована.

Logto имеет собственный граф. Обновлены доступные исправленные версии его зависимостей,
пересобираются core, account, console и experience. Частные исправления Router 6, Zod 3 и
deepmerge, их источники, ограничения и условия удаления записаны в
[Logto security maintenance](../../../infra/identity/logto/security/README.md).
Принудительный переход CLI на Zod 4 нарушил peer-контракт `@withtyped/server` и совместимость
типов схем. Вместо обхода этого ограничения перенесено официальное исправление ограниченных
коллекций. Неограниченные коллекции этим патчем не получают нового общего лимита.

Trivy образа PostgreSQL 18.7/pgBackRest 2.60.0 после пересборки Gosu не нашёл известных
уязвимостей. Это результат сканирования конкретного локального образа, не обещание отсутствия
всех уязвимостей. Финальные локальные образы backend, web и Telegram пересобраны после среза
registry 14.11.2026 и проверены Trivy в 06:59 UTC: в каждом ноль находок. Сборка началась на
`dcd467fe4`, последующая дельта содержит типы проверок и документацию. Это локальные кандидаты, они не опубликованы
как релизы. RustFS 1.0.5 также дал ноль находок. Trivy официального RabbitMQ 4.4.0 сообщает
CVE-2026-4738 по zlib 1.3.2-r1. Для точного amd64 child index проверены APK checksum,
ELF SHA-256, символы и исходники Alpine: уязвимый contrib/infback9 не входит в стандартную
libz, соответствующих символов и файлов нет. Находка остаётся в сыром отчёте, статус
`not_affected` ограничен этим артефактом, не перенесён на arm64. Источники и доказательства:
[rabbitmq-zlib-evidence.json](rabbitmq-zlib-evidence.json), [OpenVEX](rabbitmq-zlib.openvex.json).
Финальный Logto после удаления сборочных кешей и глобальных npm/pnpm содержит две Router medium:
проверенный частный патч и неиспользуемый путь manual SSR/hydration. Проверка официального
Caddy .deb 2.11.9 отдельно подтвердила 7 findings (2 high, 3 medium, 2 unknown),
[состав и checksum](caddy-security.json). В нём Go 1.27.3 и x/net 0.60.0. Приписывать ему
нулевой результат сканирования контейнера или считать все эти пути достижимыми нельзя. Caddy требует решения по оставшимся upstream findings до применения на host.

## Production baseline, только чтение

13.11.2026, около 16:28 UTC: Ubuntu 26.04.1 LTS, ядро 7.0.0-43-generic,
`dpkg --audit` без вывода, 12 контейнеров healthy, sachkov.dev HTTP 200.
Platform v79, source `915e265e487e597dad753a9e267ab206ac35dafe`.
Telegram v54, source `c064917cd2aaa4089f511861ea0a00499c26ef1e`.
PostgreSQL 18.4, pgBackRest 2.59.3, RabbitMQ 4.2.4, Logto 1.44.0-inside.15.
Последний проверенный плановый incr backup завершён в 12:02:42 UTC,
label `20261108-010858F_20261113-120227I`, 315.4 MB. Восстановление этой копии ещё не проверено.

Полный read-only verify не был зелёным: Platform сообщил RestartCount=1 у notifications-worker
после перезагрузки, Telegram сообщил сетевые ошибки в startup logs. Контейнеры при этом healthy.
Смежные исправления принадлежат #2130/#2134 и PR #2135, эта работа их не дублирует.

Повторная проверка владельцев пакетов в 17:43 UTC:

| Пакет | Установлен | Кандидат из настроенного apt |
|---|---|---|
| docker.io | 29.1.3-0ubuntu4.1 | тот же |
| containerd | 2.2.2-0ubuntu1.2 | тот же |
| runc | 1.4.0-0ubuntu1 | тот же |
| caddy | 2.11.4 | подготовлен официальный 2.11.9 |

Docker runtime принадлежит пакетам Ubuntu, docker-ce не установлен. Другой канал поставки
не подменяет фактического владельца пакета. По кешу apt доступны distro-info и python3-distro-info.
`qemu-guest-agent` находится на hold; его доступное обновление не разрешает снять hold.
`reboot-required` отсутствует. Память при baseline: 3910 MB всего, 1570 MB available, без swap.

Эта сессия не выполняла записей на production, включая apt refresh, backup и restart.
Предыдущая сессия обновила 28 пакетов ОС и перезагрузила сервер без production lock.
Это процессная ошибка, задним числом lock ей не приписывается. Перед каждой новой записью
обязателен production lock и соответствующее разрешение владельца.

Повтор baseline в 18:56 UTC подтвердил 12 healthy-контейнеров, чистый `dpkg --audit`,
ядро 7.0.0-43 и отсутствие `reboot-required`. Свежий плановый incr backup завершён в
18:09:04 UTC, `20261108-010858F_20261113-180847I`, 325.4 MB, 3793 файла.
Проверка actual Caddy admin config только чтением показала единственное приложение `http`,
handlers reverse_proxy/headers/rewrite/static_response и служебные. `pki`, acme_server,
templates и лимиты request_body отсутствуют, admin слушает 127.0.0.1:2019. Это подтверждает
ограничения применимости находок по текущей конфигурации, а не исправление upstream пакетов.

## Образы и инфраструктура

[image-targets.json](image-targets.json) сохраняет прочитанные OCI indexes и платформы.
[mirror-packet.json](mirror-packet.json) фиксирует пять новых официальных inputs подготовительного
PR #2137. Он прошёл CI Gate на head `062de70910aa3ef2da0d658411b5dbaacd85fe6b` и независимые
Standards, Spec, security reviews. Владелец разрешил merge и публикацию по SHA-256
`d1e510e6c72308401e59e36ebfdb2b9f50a7033dcd92cac9842f038a780eaffb`.
PR смержен 13.11.2026 в 19:01:10 UTC, commit
`f07e731e3ead7df35ca1621597968299a4785c64`. Merge-queue CI и оба trusted-main workflows
[официальных Node/PostgreSQL](https://github.com/sachkov-inside/platform/actions/runs/43488171871)
и [RabbitMQ](https://github.com/sachkov-inside/platform/actions/runs/43488172101) прошли.
Все пять новых indexes и каждый child manifest дополнительно сравнены анонимно с upstream.
Три прежних RabbitMQ inputs повторно проверены workflow. Результат записан отдельно в
[mirror-publication-result.json](mirror-publication-result.json), исходный пакет разрешения сохранён побайтно. Это разрешение
не распространяется на релизы приложений или production.

| Компонент | До | Кандидат и совместимость |
|---|---|---|
| PostgreSQL foundation | 18.4 | 18.7, тот же major и каталог данных |
| pgBackRest | 2.59.3 | 2.60.0, source/checksum закреплены, native restore proof обязателен |
| Gosu внутри PostgreSQL | 1.19 | 1.20, исходники закреплены, пересобран Go 1.27.4 и x/sys 0.44.0 |
| Logto | 1.44.0-inside.15 | 1.46.0-inside.16, все частные патчи сохранены |
| Изолированная БД Logto proof/стенда | PostgreSQL 17.6 | 17.12, сохраняется major существующего volume |
| RabbitMQ | 4.2.4 | 4.4.0, прямой переход с 4.2 поддержан upstream, нужны stable feature flags и проверка тома |
| Caddy host/smoke | 2.11.4 | 2.11.9, официальный .deb и checksum закреплены |
| Mailpit стенда | 1.30.6 | 1.33.1 |
| RustFS стенда | 1.0.0 | 1.0.5 |
| Учебные Docker bases | Debian 12 bookworm | Debian 13 trixie, текущий stable, apt upgrade при сборке |
| Telegram Node base | Debian bookworm | общий Alpine 3.24, проверка совместимости финального образа обязательна |
| pnpm/action-setup | прежний pinned commit | v6.1.1, release commit SHA |
| docker/login-action | прежний pinned commit | v4.8.0, release commit SHA |
| jactionlint / betterleaks | прежние quality pins | 2.6.0 / 1.10.1, release assets с checksum |

[PostgreSQL 19](https://www.postgresql.org/about/news/postgresql-187-1712-1616-1520-1425-and-19-rc-2-released-3442/)
на дату аудита ещё RC2, его не выбираем как стабильный выпуск. PostgreSQL 17.12 остаётся
поддерживаемым minor для отдельного существующего Logto volume. Перенос его major нельзя
выполнить сменой тега без dump/restore. Рабочий volume общего стенда не менялся.
[Таблица RabbitMQ 4.4](https://www.rabbitmq.com/docs/upgrade) разрешает прямой переход с 4.2.x.
Промежуточный 4.3 не является обязательным. Перед переходом должны быть включены stable
feature flags. RabbitMQ 4.4 меняет формат .sqs, поэтому возврат тега не считается безопасным rollback.

Источники: [Node security release](https://nodejs.org/en/blog/vulnerability/november-2026-security-releases),
[PostgreSQL 18.7](https://www.postgresql.org/docs/release/18.7/),
[Logto releases](https://github.com/logto-io/logto/releases),
[RabbitMQ 4.4.0](https://github.com/rabbitmq/rabbitmq-server/releases/tag/v4.4.0),
[pgBackRest 2.60.0](https://github.com/pgbackrest/pgbackrest/releases/tag/release/2.60.0).

## Проверки и доставка

`worktree:prepare --task 2117` выполнен. Тяжёлые проверки используют проектный heavy-check.
Общий локальный стенд не резервировался и не менялся. Исходные полные unit/contracts проверки
прошли; новые патчи и изменённые inputs получают повторные адресные проверки. Полная проверка интерфейса прошла: Storybook 1295/1295, Telegram widgets 269/269,
браузерные движки 92 passed и 1 штатный skip, Storybook build завершён. Основной E2E-набор
прошёл, 166 passed и 14 штатных skips. Полная навигация дала 439 passed, 23 skips и четыре ошибки устаревших селекторов.
Селекторы исправлены, повтор двух затронутых файлов прошёл, 14 passed. Финальные локальные
сборки завершены; новый CI должен проверить окончательный head ветки.

Для PostgreSQL добавлен native proof чтения текущих production backups (18.4/2.59.3) новым
writer/restore (18.7/2.60.0) на обеих архитектурах. Исторический proof 18.4/2.57 сохраняется.
Сам harness продолжает отказывать на общем локальном daemon. Backup/restore на production
без lock и разрешения не запускается. Полный account-email proof прошёл на каноническом обновлённом Logto, включая замороженный
security-граф и прямые Node команды. После явного сброса унаследованного npm entrypoint образ
пересобран, повтор account-email proof без entrypoint override также прошёл. Все 91 upstream SAML тестов
и 29 guard/offline тестов прошли в сборке.

RabbitMQ: локальный ARM proof подтвердил сохранность трёх persistent quorum сообщений, возврат
неподтверждённого сообщения, отсутствие подтверждённого, запись и перезапуск на 4.4, неизменность
исходного холодного тома и удаление собственных ресурсов. Дополнительный proof проверяет запуск холодной копии
на старой 4.2.4, не затрагивая исходный том. Native amd64/arm64 proof прошёл в
[CI 43512527877](https://github.com/sachkov-inside/platform/actions/runs/43512527877), как и оба
native PostgreSQL recovery jobs. [native-proof-results.json](native-proof-results.json) сохраняет
привязанные к `ba92f9e3a` receipts. Все PostgreSQL проверки используют синтетические backups
совместимых writer-версий. Фактический production backup ими не восстанавливался.
Root-owned host guard до исполнения любого старого или нового runtime bundle запрещает менять
образ брокера и неизвестный том через application deployment/rollback. Manifest выключает
автоматический откат при различии брокера в проверенных SHA-256 архивах. Само обновление
production-брокера требует отдельного обслуживания, холодной копии, проверки фактических данных,
lock и разрешения владельца. Синтетический proof этого разрешения не заменяет.

Пересекающиеся Dependabot PR #1544 (Node) и #1991 (Actions) оставлены без изменений.
Первый CI #2136 не является итоговым доказательством: он выявил неопубликованный Node mirror
и устаревшие эталоны pins. Merge, публикация, release и deployment сохраняют owner gates.

Учебные образы переносятся на [Debian 13 trixie](https://www.debian.org/releases/trixie/),
текущий стабильный выпуск, с обновлением доступных пакетов внутри сборки. Это проектные
одноразовые Docker fixtures, не обновление рабочей системы владельца.


## Исправления по CI после публикации mirrors

CI на `ba92f9e3a` прошёл integration, Telegram, оба production modes и четыре native
foundation jobs, но весь CI Gate остался красным. Найдены и исправлены следующие причины:

- pnpm 12 поставляет нативный CLI. Сценарии больше не передают ELF как JavaScript в Node;
  общая функция сохраняет поддержку JavaScript entrypoints и выбранного runtime.
- Linux pnpm 12 при выходе убивает группу своего сценария. Контроллер heavy-check теперь
  отделяет собственную сессию, чтобы сначала удалить detached children и только затем
  освободить слот. Воспроизведение на старом коде упало, после исправления все 14 Linux
  тестов и 62 адресных macOS теста прошли.
- Локальные S3 clients явно используют `us-east-1`, как RustFS. Production default
  `ru-central1` больше не попадает в location constraint локального bucket.
- Видимая подпись и доступное имя поиска разделяют подсказку сочетания одним пробелом.
  Все 10 историй каркаса и 127 выбранных историй, включая упавшие меню, прошли локально.
- Синтетический broker proof использует уже разрешённый тестовый пароль; правила распознавания
  секретов сохранены. Для уже записанного старого синтетического пароля используется один
  точный исторический fingerprint, описанный ниже. Новые Logto `.mjs` включены в строгие typecheck/lint.

Повторный полный audit workspace сохранил 0 critical/high/moderate и одну low по версии
исправленного частным патчем deepmerge. Production audit дал ноль. Проверка только pnpm
не покрывает перечисленные ниже системные пакеты и Go-инструменты.

## Оставшиеся находки сторонних артефактов

Официальный Mailpit 1.33.1 оставляет две unknown-находки. Для OpenPGP
[GO-2026-5932](https://pkg.go.dev/vuln/GO-2026-5932) фактическая auth-зависимость использует bcrypt;
вызовов OpenPGP в проверенных исходниках не найдено. Для CVE-2026-97054 Mailpit действительно
вызывает `MaxBytesReader`, но тело читает синхронно до ответа. Требуемая гонка с записью headers
не подтверждена. Это ограничения применимости, не исправление бинарного файла. Mailpit работает
только в локальном стенде и изолированных проверках с loopback портами.

Учебные образы обновляют доступные пакеты Debian 13 при сборке и внутренние glob/minimatch
npm до 14.0.3/11.0.1 во всём вложенном графе через npm overrides. Системный скан всё равно содержит находки без исправления в stable Debian.
В частности, Trivy оценивает CVE-2026-6653 в libxml2 как critical, а
[Debian tracker](https://security-tracker.debian.org/tracker/CVE-2026-6653) оставляет trixie
vulnerable/no-dsa (Minor issue), без исправленного stable-пакета. Пакеты из unstable не подмешиваются.

Нативный TypeScript 7.0.2 содержит Go 1.26.4 и x/text 0.38.0. В окончательном скане каждого учебного
образа осталось 27 Go-находок этого compiler binary. Для GO-2026-5970/CVE-2026-56852 уязвимые
`norm.Iter` действительно связаны в бинарном файле; путь от недоверенного исходника до них
и предварительная проверка UTF-8 не доказаны. Поэтому эти находки не объявляются `not_affected`.
Официальный стабильный TypeScript пока поставляет этот бинарный файл. Самостоятельная пересборка
из исходника с `+dirty` без полного происхождения и сравнения diagnostics/emit не считается
проверенным совместимым исправлением. Это оставшееся ограничение инструмента сборки.
Учебные контейнеры сохраняют ограничения CPU/memory/PID, read-only mount и watchdog.

Caddy, системные пакеты учебных образов и нативный TypeScript требуют отдельного решения
по остаточному риску или исправленных upstream артефактов. Нулевой pnpm audit не снимает эти находки.


Последний срез registry зафиксирован 14.11.2026 около 06:37 UTC в
[registry-cutoff.json](registry-cutoff.json). Семь новых стабильных версий уже прошли карантин
1440 минут: AWS SDK 3.1168.0, AI SDK openai 4.0.117, openai-compatible 3.0.92, ai 7.0.172,
Kysely 0.29.9, oxlint-tsgolint 7.0.2007. Они включены в manifests и lockfile.
Prisma 8.0.0-rc.33 исключён как prerelease. Сборки до этого среза сохраняются как промежуточные
доказательства, окончательный CI должен проверять новый согласованный граф.


14.11.2026 в 06:41 UTC повтор production baseline подтвердил 12 healthy-контейнеров,
HTTP 200, чистый `dpkg --audit`, ядро 7.0.0-43 и отсутствие reboot-required.
Свежий плановый incr backup завершился в 06:04:39 UTC, label
`20261108-010858F_20261114-060422I`, 306.7 MB, 3795 файлов, Result=success/ExecMainStatus=0.
Это чтение существующего расписания, новый backup или restore не запускались.


CI проверяет также историю ветки. `.betterleaksignore` содержит ровно один fingerprint:
commit `a029f4e631e63d5c02a1f5784f3289c8ebe1e81d`, файл broker-upgrade-proof.py, правило
`generic-credential-uri`, строка 24. Это прежний выдуманный пароль только для созданного harness
одноразового RabbitMQ, без опубликованных портов. В текущем коде его уже нет. Исключение
не охватывает файл, весь commit, другие значения или новые строки. Исторический scan сначала
воспроизвёл эту единственную находку; после исключения прошёл повторно вместе с
положительными и отрицательными проверками настоящих форматов provider credentials.

[lock-inventory.json](lock-inventory.json) перечисляет 1166 имён прямых и транзитивных пакетов
workspace с наборами версий до/после и SHA-256 обоих lockfiles. Новый замороженный Logto graph
записан отдельно. В BASE_SHA отдельного Logto lockfile не было; этот список не выдаётся за
полный diff внутреннего графа прежнего production-образа.

## Финальная локальная проверка 14.11.2026

`pnpm check:static` и `QUALITY_BASE_SHA=f07e731e3ead7df35ca1621597968299a4785c64 pnpm quality:security`
завершились с кодом 0. Все 104 проверки toolchain и владения процессами прошли. Standards,
Spec и отдельный security review на `5dabd267da9ad43fcee28dc9bb2e275a4e4100b6` не оставили замечаний.
CI `43567499545` на предыдущем head прошёл все четыре full-stack browser shards,
UI, desktop/mobile browser, integration, оба Compose modes и четыре native foundation jobs.
Его ошибки истории секретов, типов и эталона версии инструмента исправлены. Этот красный
запуск не считается итоговым CI.

[image-inventory.json](image-inventory.json) содержит версии всех распознанных пакетов десяти
образов, идентичность артефактов, время сканирования, SHA-256 сырых отчётов и все оставшиеся находки.
Backend, web, Telegram, PostgreSQL и RustFS дали ноль; Logto оставил две Router medium.
Учебный agent содержит 1408 Debian и 27 Go-находок, fixture содержит 1165 Debian и 27 Go-находок.
Node.js-находок после полного обновления вложенного npm graph в обоих учебных образах нет.
Наличие `fixedVersion` в базе сканера не означает доступность исправления в stable Debian
или в актуальном официальном TypeScript.

Оба учебных образа собрались. Изолированный fixture прошёл lint, typecheck, format, unit,
build, integration и Chromium browser checks; четыре watchdog lifecycle сценария прошли.
Собственные контейнеры и сети этих проверок удалены. Платные запросы Codex не выполнялись.
Канонический Logto повторно прошёл account-email proof без переопределения entrypoint.
Новый CI окончательного head и решение владельца по merge остаются следующими этапами.
