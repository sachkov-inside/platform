# Изолированный пилот Umami

Это подготовленный компонент #1566 к спецификации #1565. Он не включает tracker в Platform,
не меняет legal-редакции и не означает готовность production. API/native MCP совместимость,
privacy/read-only/revocation подтверждены на Mac и Linux для указанного ниже source tree.
Retention runner подготовлен; его новый полный supervised corpus, полный каталог аналитики,
restore и resource acceptance ещё требуют отдельного доказательства.

Общий с core stdlib helper записывает отдельный kernel CPU record для единственного native
Umami MCP. Он включает native child и kernel-accounted/reaped descendants, исключая параллельные
verification команды. Неизвестные или незавершённые измерения не становятся нулём и не заменяют
полный resource corpus; правила закрытого канала и cleanup описаны в [core runbook](observability-pilot.md).

## Закреплённый комплект и проверенные defaults

[inputs.lock.json](../../infra/observability/umami/inputs.lock.json) закрепляет Umami 3.4.0,
PostgreSQL 16.13 и Python 3.13.12 OCI index digest. Там же находятся URL и SHA256 прочитанных
файлов upstream commit `ec0ff50388c264ed8ce46f00967e92f7e71476ae`. Digest подтверждён registry
manifest. [Compatibility evidence #1566](https://github.com/sachkov-inside/platform/issues/1566#issuecomment-6274005423):
Mac source `fbb1a9c970edef6648e76496885a551cf4bcca21`, tree
`c779b356c9b4bf7e99fd93947952d1119c464f11`, explicit Node 26.10.0 — native
`get_website_stats`, один известный pageview, privacy, mutation denial и key revocation PASS.
Linux [run 39299627883](https://github.com/sachkov-inside/platform/actions/runs/39299627883),
checkout `36eb90bb`, имеет тот же tree и SUCCESS. Monitor не отказал; diagnostics/down/residue
PASS, собственных containers/volumes/networks после cleanup — 0. Это API/MCP compatibility,
не history TTL, capacity, resource acceptance или pgBackRest proof.

Источник закреплённого [POST /api/teams](https://github.com/umami-software/umami/blob/ec0ff50388c264ed8ce46f00967e92f7e71476ae/src/app/api/teams/route.ts)
возвращает результат [createTeam](https://github.com/umami-software/umami/blob/ec0ff50388c264ed8ce46f00967e92f7e71476ae/src/queries/prisma/team.ts)
как tuple `[Team, TeamUser]`. Прежний seed ошибочно требовал объект. Регрессия воспроизводит
этот отказ по форме ответа; отдельный adapter проверяет UUID, связь teamId и owner role до
использования идентификатора. Исторические Mac `9d38522d` и Linux `39297716250` завершились
на seed; их закрытые отчёты не определяли substage. Последующие успешные compatibility proofs
выше заменяют этот отказ как текущий статус. Первая попытка `fbb1a9c9` отказала на host Node
25.2.1; повтор с явным pinned Node 26.10.0 прошёл без ослабления version guard.

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
4. После native baseline, до отзыва ключа выполнить synthetic retention corpus: проверить
   gateway при физически ещё сохранённых старых событиях, partial/full drain и idempotent retry.
   Публиковать закрытый `umami-retention.json`, затем выполнить API privacy/read-only corpus,
   отзыв ключа и сохранить `umami-proof.json`, без произвольных provider fields.
5. Source metadata связывает checkout SHA/tree, provider execution/PR head/base, run/attempt
   и hashes shared supervisor/guards, собственного runner/config, npm locks и workflow.
6. При любом исходе остановить собственный project и volumes, проверить residue. Recovery
   допускается только для зарегистрированного random prefix и той же daemon identity,
   после исчезновения worker и его process group.

`hosted.py collect` публикует только явный whitelist bounded JSON. Private compose, SQL,
reader key, npm installation, seed output и raw provider errors исключены. Proof Linux CI
не становится Timeweb capacity, PostgreSQL restore, browser consent или семью сутками production.

При ошибке seed `fixture.py` передаёт закрытую форму `phase/step/error/http_status`:
фиксированные имена шага и категории, числовой HTTP status либо null. Runner принимает её
только для seed, в пределах 1024 bytes, с точным набором полей и разрешённых значений; иначе
сохраняет только общий отказ команды. В `readiness.json` не попадают URL, Account/team/site ID,
credentials, response body, exception text или произвольный stderr. Ошибки других команд
остаются без provider diagnostics. Stage/status/container state следуют общему pilot contract.

## Очистка истории: bounded drainer и proof foundation

[retention.py](../../scripts/observability-umami/retention.py) управляет
[retention.sql](../../scripts/observability-umami/retention.sql) только в отдельной базе `umami`
от роли `umami`. Platform/Telegram migrations, доменные таблицы и общие TTL не меняются.
Cutoff берётся из DB clock в UTC: `transaction_timestamp() - INTERVAL '365 days'` и фиксируется
между batches; точная граница сохраняется (`created_at >= cutoff`). NULL event times удаляются.
Metadata `snapshot_at` — начало REPEATABLE READ transaction; `cutoff_age_seconds` показывает
отставание фиксированной границы от часов текущего batch. Это не календарный год.

Один batch — transaction с nonblocking advisory ownership, statement timeout 1 секунда,
lock timeout 250 ms, idle transaction timeout 2 секунды, не более 500 строк каждой из девяти
telemetry tables. Внешний transport deadline — 12 секунд, включая fresh-daemon preflight и SQL subprocess;
один drain — до 20 batches/30 секунд. Optional absolute deadline только ужесточает preflight: его
существующий command cap и проверки socket/context/daemon/storage не меняются.
При исчерпании бюджета возвращается `partial`, при отказе/недостоверном ответе — `error`.
Повтор продолжает по предикатам, без cursor и изменения миграций. Counts относятся только к
acknowledged committed batches: потерянный ответ не доказывает отсутствие уже совершённых удалений.
Открытую транзакцию при обрыве соединения PostgreSQL откатывает; committed batches остаются.

Сначала удаляются expired/orphan event properties и revenue, затем события; отдельно —
session properties/identity links по собственному времени или отсутствию parent session.
Старые/NULL sessions удаляются только без оставшихся references. Old session metadata,
нужная retained событию, сохраняется; fresh orphan session не удаляется мгновенно, чтобы не
соревноваться с ingest. Replay/heatmap collection остаётся OFF: fixture очищает только
искусственные historical/restore remnants, включая replay chunk, пересекающий cutoff.

`complete` требует пустого delete pass всех девяти предикатов в одном REPEATABLE READ snapshot
и нулевого числа expired events при данном cutoff. `remaining_expired_events`,
`event_cleanup_lag_seconds` и `unknown_event_times` измеряются на этом snapshot. Lag относится
к известным временам событий; NULL учитываются отдельно. Отдельные orphan rows не получают
выдуманного event time. Это не hard quota, моментальное освобождение файла БД или обещание
пустого будущего snapshot. Native Prisma relations для telemetry не создают database FK:
поздняя запись может потребовать следующего прохода. Полноценный scheduler, проверка очистки
в следующие сутки и поведение при неограниченном backlog остаются pending.

Отдельный реальный PostgreSQL 16.13 Testcontainers contract прошёл с точными 26 миграциями
закреплённого upstream; [schema-fixture.sql](../../infra/observability/umami/schema-fixture.sql)
сохраняет MIT notice, исходные bytes и hashes. Это schema-only proof, без запуска Umami app/API.
Проверены >500 expired rows, NULL/exact boundary/recent data, orphan properties/identifiers,
referenced old/fresh orphan sessions, UTC при другом connection timezone, concurrent recent
insert, rollback при row lock, advisory contention, future-cutoff/foreign database rejection
и idempotent retry. Команда требует существующих зависимостей repository test environment:

```sh
bash scripts/heavy-check.sh node --test scripts/observability-umami-retention.pg.test.mjs
```

Полный supervised runner дополнен corpus после native baseline и до revocation. SQL добавляет
только synthetic custom events (pageview baseline остаётся 1), затем проверяет query boundary
до физического удаления, partial/full drain и retry. Новый полный Umami retention run **pending**
до immutable review и фактического запуска координатором. Schema-only PG и Python doubles
не подменяют этот source-bound API/cleanup proof.

Разрешённые reads: `/api/websites` возвращает metadata без event history; `/stats` и `/events`
требуют start/end в пределах 365×24 часов и окна 31 день. Для stats дополнительно ограничен
неявный previous comparison; upstream [getCompareDate](https://github.com/umami-software/umami/blob/ec0ff50388c264ed8ce46f00967e92f7e71476ae/src/lib/date.ts)
сдвигает окно на целое число минут, gateway проверяет более строгую полную длительность.
[Events query](https://github.com/umami-software/umami/blob/ec0ff50388c264ed8ce46f00967e92f7e71476ae/src/queries/sql/events/getWebsiteEvents.ts)
фильтрует event time перед paging/join. Windowless history, session/detail/property/metric,
replay/heatmap endpoints не поддержаны и отклоняются до обращения к upstream. Сохранение
old session metadata не открывает session detail route. Это начальное coverage, не полный
каталог аналитики. Browser tracker/согласия/production остаются выключены.

Restore проверяется в отдельной закрытой базе: восстановить backup, применить актуальные
удаления и drain cleanup, проверить corpus и только затем разрешить подключения читателям.
Нельзя сначала поднять открытый Umami на старой копии. pgBackRest wiring, isolated restore
и source-bound runtime evidence остаются частью #1566; этот срез не объявляет их готовыми.
