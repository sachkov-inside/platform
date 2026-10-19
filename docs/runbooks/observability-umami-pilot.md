# Изолированный пилот Umami

Это подготовленный компонент #1566 к спецификации #1565. Он не включает tracker в Platform,
не меняет legal-редакции и не означает готовность production. Runtime-проверка на Linux,
полный каталог аналитики, native MCP по stdio на Mac, очистка/restore и измерения ресурсов
ещё требуют фактического доказательства. Локальные Python contracts не заменяют эти проверки.

## Закреплённый комплект и проверенные defaults

[inputs.lock.json](../../infra/observability/umami/inputs.lock.json) закрепляет Umami 3.4.0,
PostgreSQL 16.13 и Python 3.13.12 OCI index digest. Там же находятся URL и SHA256 прочитанных
файлов upstream commit `ec0ff50388c264ed8ce46f00967e92f7e71476ae`. Image pull/execution на Mac
не выполнялись. Digest подтверждён registry manifest, совместимость доказывается запуском.

В закреплённом [send handler](https://github.com/umami-software/umami/blob/ec0ff50388c264ed8ce46f00967e92f7e71476ae/src/app/api/send/route.ts)
по умолчанию сохраняются query/hash URL, title, referrer path/query, UTM, click IDs и свойства.
Cookie-free не означает очистку этих значений. Пилот не загружает стандартный browser tracker:
`fixture.capture` строит synthetic payload только из закрытого каталога route/event codes.
Произвольные входные URL, title, referrer, properties и Account ID отбрасываются. Это fixture,
а не готовая интеграция пользовательского выбора, авторизованной identity или доменных событий.

Native session UUID зависит от сайта, IP, User-Agent, месячного salt и optional distinct ID.
Visit ID использует session и salt начала часа. Cache хранит visit/iat; без явного timestamp
handler обновляет visit при возрасте iat больше 1800 секунд, при session drift — сразу.
Это поведение закреплённого кода; собственные сессии поверх него не вводятся. Приблизительный
visitor не равен человеку. Переход часа сам по себе не обязательно меняет cached visit.

`PRIVATE_MODE`, `DISABLE_TELEMETRY`, `DISABLE_UPDATES`, `NEXT_TELEMETRY_DISABLED` установлены.
Первые три значения дополнительно проверяются через native `/api/config`. Проверены
[config](https://github.com/umami-software/umami/blob/ec0ff50388c264ed8ce46f00967e92f7e71476ae/src/app/api/config/route.ts)
и [telemetry handler](https://github.com/umami-software/umami/blob/ec0ff50388c264ed8ce46f00967e92f7e71476ae/src/app/api/scripts/telemetry/route.ts).
Umami/PostgreSQL подключены только к internal network; query gateway дополнительно имеет
ingress bridge, чтобы loopback published port работал с Docker internal networks. У gateway
поэтому есть сетевой egress: это не обещание его сетевой изоляции. Upstream остаётся фиксированным,
redirect и proxy environment в HTTP-клиентах запрещены. У Umami/PostgreSQL нет published ports.
Проверка фактического сетевого поведения входит в runtime. Replay/heatmap не вызываются.

## Граница чтения

Native API key наследует полномочия пользователя. `view-only` сам по себе недостаточен:
[website permissions](https://github.com/umami-software/umami/blob/ec0ff50388c264ed8ce46f00967e92f7e71476ae/src/permissions/website.ts)
разрешают изменение/удаление владельцу личного сайта без проверки этой роли. Fixture создаёт
отдельного `view-only` пользователя и членство `team-view-only` в команде; сайт принадлежит
команде. Кроме того, `/api/send` вообще не требует аутентификации.

Поэтому наружу публикуется только `127.0.0.1:13301` query gateway. Umami и PostgreSQL не имеют
published ports. Gateway допускает только GET `/api/websites` и GET
`/api/websites/{uuid}/stats|events`. Нет generic proxy, redirect, произвольного upstream,
передачи Host или query credentials. Ключ должен совпасть с локальным reader key и затем
каждый раз проверяется native API: кеша авторизации нет. Отзыв проверяется настоящим
удалением ключа через сессию его владельца.

Окно запроса ограничено 31 сутками, история — 365 сутками по event time. Для stats учитывается
также implicit previous-period comparison; если она вышла бы за историю, запрос отклоняется.
Events сохраняют native pagination, pageSize ≤100, page ≤1000. Неизвестные query-параметры,
дубликаты, методы и пути запрещены. Ответ ограничен 1 MiB. На принятый запрос даётся 10 секунд целиком: чтение client headers,
DNS/connect, upstream headers/body и запись ответа. Отдельный процесс-владелец принимает
соединения и по monotonic deadline завершает запрос; проверка выполняется каждые 20 ms.
Одновременно работают не более четырёх request processes, backlog — 8; при заполнении
новое соединение закрывается. Медленная передача байтов не продлевает срок. При shutdown
владелец завершает и reap-ит только собственные процессы; child alarm ограничивает их
жизнь также при потере владельца. Это Unix/Linux boundary; resource measurements ещё pending.
Обычный сбой источника становится HTTP 502; исчерпание абсолютного срока закрывает
соединение. Недоступный локальный ключ даёт 503, отзыв — 401;
это не нулевые показатели. URL, ключи, body и provider exceptions не журналируются gateway.

В этом срезе gateway намеренно не пропускает embedded `/mcp`: тот вызывает внутренний API и
обошёл бы ограничения gateway. Official `@umami/mcp` существует в upstream, версия 0.2.0;
его stdio adapter использует этот query API. В `infra/observability/umami/mcp` закреплён полный
пятикомпонентный dependency graph с sha512 integrity каждого npm artifact. Acquisition использует
`npm ci --ignore-scripts --omit=dev --no-audit --no-fund` в private output, не workspace install.
Host Node должен совпасть с `.node-version`. CLI получает только фиксированные origin/token,
без inherited `UMAMI_API_URL`, Cloud key, proxy или Node options. Ни `npx latest`, ни обход
gateway не являются рецептом. Discovery и известный pageview проверяет prepared runner;
фактическое выполнение, полный каталог инструментов и isolated MCP CPU proof пока pending.

## Подготовка и протокол runtime

Локальные contracts без Docker и внешних запросов:

```sh
bash scripts/heavy-check.sh node --test scripts/observability-umami.test.mjs scripts/observability-umami-process.test.mjs
python3 scripts/observability-umami/prepare.py /absolute/task-owned/new-private-directory
```

Python contracts запускаются отдельной POSIX process group. Внешний Node owner находится
вне этой группы и сразу регистрирует очистку. При завершении worker, ошибке, deadline 30 секунд
или SIGTERM/SIGINT владельца он останавливает всю группу: SIGTERM, через 250 ms — SIGKILL,
проверка исчезновения группы ограничена тремя секундами. Output ограничен 1 MiB; ожидание
worker exit и закрытия inherited descriptors также ограничено. Убийство только Python worker
сигналом SIGKILL не обходит этот внешний cleanup. Process fixtures отдельно проверяют
success/failure/timeout, SIGTERM/SIGKILL worker и SIGTERM owner: acceptor/request descendants
исчезают вместе с process group, listener действительно закрывается.

SIGKILL самого Node owner, уничтожение всего supervisor tree или потеря хоста требуют ручного
восстановления: автоматическая гарантия не продолжается бесконечной цепочкой supervisors.
При таком аварийном завершении перед повтором необходимо проверить принадлежность оставшейся
test process group текущей задаче, остановить её и подтвердить закрытие её listener. Этот
контракт касается локальных contracts; Docker runtime использует отдельный общий pilot supervisor.

`prepare.py` сначала валидирует bounded JSON lock целиком: schema/revisions, exact image
repositories с digest, даты и source proofs. Дубликаты JSON keys запрещены. При отказе выходной
каталог не создаётся. Затем требуется несуществующий каталог: mode 0700, файлы mode 0600.
Ответы fixture API проверяют используемые UUID и bounded non-control credentials до передачи
в URL/headers; это относится также к private state и локальному reader key.
Compose plan содержит случайные fixture secrets: **не публиковать весь каталог**. Он создаёт
отдельную базу/роль `umami`, server-side connection limit 8, statement timeout 5 секунд и
idle-in-transaction timeout 10 секунд. Это отдельный disposable PostgreSQL, не production
и не доказательство включения существующего PostgreSQL в pgBackRest.

Подготовлены `runtime.py`, `hosted.py` и отдельный no-secrets workflow
`.github/workflows/observability-umami.yml`. Полный запуск разрешается после проверки immutable
runner: Standards, Spec, security и classification. До этого image pull/runtime не выполняются.
После принятия runner используется публичная команда, а не ручной Compose:

```sh
bash scripts/heavy-check.sh python3 scripts/observability-umami/runtime.py run --output /absolute/task-owned/new-private-directory
```

Сначала соблюдается [singleton ownership](local-development.md#parallel-worktrees-and-singleton-ownership).
Runtime использует тот же внешний supervisor и policy, что technical pilot: 16 GiB admission,
неизменённые floor/growth/headroom, host+VM checks на OrbStack и Linux storage monitor,
отдельная worker process group, 600 секунд worker deadline, обязательные down/volumes/residue
после success/failure/timeout/interruption. Linux фиксирует context/socket inode/daemon/storage;
OrbStack — также backing identity. Изменение identity запрещает mutation и автоматический
cleanup на другом daemon; требуется ручная проверка владельцем. Подробности storage guard
находятся в [общем runbook](observability-pilot.md), их отдельная копия здесь не вводится.

`inputs.lock.json` содержит проверенные amd64/arm64 OCI config digests Postgres 16.13: image
создаёт postgres UID/GID 70 и PGDATA/socket directories с owner postgres. Сервис запускается
как `70:70`, с `cap_drop: ALL`, без privilege escalation. Fresh named-volume copy-up permissions
ещё подтверждаются actual runtime. SQL не монтируется из host mode-0600 файла в entrypoint:
после bounded `pg_isready` внешний worker передаёт его `psql` по stdin, без паролей в argv.
Query gateway работает с numeric UID/GID владельца private reader key, чтобы читать mode 0600
без DAC override. Эти значения не являются production credentials.

Последовательность runtime:

1. Записать private source-bound ownership и случайный project; запустить только PostgreSQL,
   дождаться readiness, создать отдельную role/database по private stdin, затем Umami/query.
2. Выполнить internal synthetic seed; его stdout с key/session остаётся только в памяти worker,
   не echo/tee/upload. Default admin password заменяется случайным до создания данных.
3. Записать key в существующий inode mode 0600. Через native stdio проверить discovery и
   `get_website_stats`: ожидается правильный website и ровно один fixture pageview.
4. Запустить API privacy/read-only corpus и отзыв ключа. Опубликовать только проверенную
   закрытую форму `umami-proof.json`, без дополнительных provider fields.
5. Source metadata связывает checkout SHA/tree, provider execution/PR head/base, run/attempt
   и hashes shared supervisor/guards, собственного runner/config, npm locks и workflow.
6. При любом исходе остановить собственный project и volumes, проверить residue. Recovery
   допускается только для зарегистрированного random prefix и той же daemon identity,
   после исчезновения worker и его process group.

`hosted.py collect` публикует только явный whitelist bounded JSON. Private compose, SQL,
reader key, npm installation, seed output и raw provider errors исключены. Proof Linux CI
не становится Timeweb capacity, PostgreSQL restore, browser consent или семью сутками production.

`fixture.py` сообщает только тип исключения и фазу. Raw provider error и чувствительный
ответ не становятся диагностикой. Для различения startup причин runner может сохранять
разрешённые stage/status/container state поля по общему pilot contract.

## Очистка и восстановление: подготовленный SQL

[retention.sql](../../scripts/observability-umami/retention.sql) — owned deployment adapter
именно к закреплённой схеме Umami, не cross-schema чтение доменных таблиц Platform.
Native website reset удаляет всю историю, поэтому не подходит для rolling retention.
Один запуск SQL удаляет не более 500 строк каждой таблицы за transaction, с lock/statement
budgets. Сначала удаляются expired/orphan event properties и revenue, затем события;
отдельно — session properties, identity links, replay/heatmap и неиспользуемые старые sessions.
Свежая session, всё ещё нужная сохранённому событию, не удаляется по одному её created_at.
NULL event times считаются недействительными и подлежат удалению.

Этот SQL **ещё не проверен на реальном PostgreSQL**. До принятия нужны fixed corpus
на границе 365 суток, повторные batches, orphan properties/sessions/identifiers, concurrent
insert, измеренная cleanup lag и проверка ограничений схемы/индексов. Планировщик и proof
физической очистки в следующие сутки пока не реализованы. Query gateway уже ограничивает
разрешённое чтение, но это не заменяет физическое удаление.

Restore проверяется в отдельной закрытой базе: восстановить backup, применить актуальные
удаления и drain cleanup, проверить corpus и только затем разрешить подключения читателям.
Нельзя сначала поднять открытый Umami на старой копии. pgBackRest wiring, isolated restore
и source-bound runtime evidence остаются частью #1566; этот срез не объявляет их готовыми.
