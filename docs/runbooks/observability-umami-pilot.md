# Изолированный пилот Umami

Это подготовленный компонент #1566 к спецификации #1565. Он не включает tracker в Platform,
не меняет legal-редакции и не означает готовность production. API/native MCP совместимость,
privacy/read-only/revocation подтверждены на Mac и Linux для указанного ниже source tree.
Supervised synthetic retention corpus прошёл на Mac `fe89f406` и Linux source `4da87e1d`.
Это не полный каталог аналитики, scheduler, restore или resource acceptance.

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
`c779b356c9b4bf7e99fd93947952d1119c464f11`, explicit Node 26.10.0, native
`get_website_stats`, один известный pageview, privacy, mutation denial и key revocation PASS.
Linux [run 39299627883](https://github.com/sachkov-inside/platform/actions/runs/39299627883),
checkout `36eb90bb`, имеет тот же tree и SUCCESS. Monitor не отказал; diagnostics/down/residue
PASS, собственных containers/volumes/networks после cleanup осталось 0. Это API/MCP compatibility,
не history TTL, capacity, resource acceptance или pgBackRest proof.

Текущий retention proof: Mac source `fe89f4062960178fcf3ddea45fb35fc861b3736b`, tree
`c86e6996f33f171d331c0f64c2ae5d8381911014`, curated SHA256
`d224e4fbd479c29fc72192dbb0b050678c0bbb2efbd61f2df4532385a10e2bf4`.
Linux [run 39315356798](https://github.com/sachkov-inside/platform/actions/runs/39315356798)
выполнил source `4da87e1d`, provider checkout `26cfd4e1`, с проверенным exact tree
`343da0e42496f3b587b4cd803eafa89de413b7c4`. Оба запуска прошли query boundary до удаления,
partial/full drain 502 expired events и idempotent retry; worker exit 0, monitor без отказа,
diagnostics/down/residue PASS. На Mac отдельно проверен нулевой остаток собственных Docker resources.
Это bounded pinned Umami 3.4 / PostgreSQL 16.13 proof; scheduler, существующая PostgreSQL 18
topology, pgBackRest/restore и replay актуальных удалений остаются открытыми.

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
handler обновляет visit при возрасте iat больше 1800 секунд, при session drift обновляет сразу.
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

Окно запроса ограничено 31 сутками, история ограничена 365 сутками по event time. Для stats учитывается
также implicit previous-period comparison; если она вышла бы за историю, запрос отклоняется.
Events сохраняют native pagination, pageSize ≤100, page ≤1000. Неизвестные query-параметры,
дубликаты, методы и пути запрещены. Ответ ограничен 1 MiB. На принятый запрос даётся 10 секунд целиком: чтение client headers,
DNS/connect, upstream headers/body и запись ответа. Отдельный процесс-владелец принимает
соединения и по monotonic deadline завершает запрос; проверка выполняется каждые 20 ms.
Одновременно работают не более четырёх request processes, backlog ограничен 8; при заполнении
новое соединение закрывается. Медленная передача байтов не продлевает срок. При shutdown
владелец завершает и reap-ит только собственные процессы; child alarm ограничивает их
жизнь также при потере владельца. Это Unix/Linux boundary; resource measurements ещё pending.
Обычный сбой источника становится HTTP 502; исчерпание абсолютного срока закрывает
соединение. Недоступный локальный ключ даёт 503, отзыв даёт 401;
это не нулевые показатели. URL, ключи, body и provider exceptions не журналируются gateway.

В этом срезе gateway намеренно не пропускает embedded `/mcp`: тот вызывает внутренний API и
обошёл бы ограничения gateway. Official `@umami/mcp` существует в upstream, версия 0.2.0;
его stdio adapter использует этот query API. В `infra/observability/umami/mcp` закреплён полный
пятикомпонентный dependency graph с sha512 integrity каждого npm artifact. Acquisition использует
`npm ci --ignore-scripts --omit=dev --no-audit --no-fund` в private output, не workspace install.
Host Node должен совпасть с `.node-version`. CLI получает только фиксированные origin/token,
без inherited `UMAMI_API_URL`, Cloud key, proxy или Node options. Ни `npx latest`, ни обход
gateway не являются рецептом. Discovery и известный pageview подтверждены указанными API/MCP запусками. Изолированный
Mac CPU record для native Umami MCP уже получен на `b708afe1` ([evidence](https://github.com/sachkov-inside/platform/issues/1566#issuecomment-6274516488));
это исторический отдельный source, не resource acceptance текущего retention runner.
Полный каталог аналитических сценариев остаётся pending.

## Подготовка и протокол runtime

Локальные contracts без Docker и внешних запросов:

```sh
bash scripts/heavy-check.sh node --test scripts/observability-umami.test.mjs scripts/observability-umami-process.test.mjs
python3 scripts/observability-umami/prepare.py /absolute/task-owned/new-private-directory
```

Python contracts запускаются отдельной POSIX process group. Внешний Node owner находится
вне этой группы и сразу регистрирует очистку. При завершении worker, ошибке, deadline 30 секунд
или SIGTERM/SIGINT владельца он останавливает всю группу: SIGTERM, через 250 ms отправляет SIGKILL,
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

Сначала соблюдается [singleton ownership](local-stand.md#parallel-worktrees-and-singleton-ownership).
Runtime использует тот же внешний supervisor и policy, что technical pilot: 16 GiB admission,
неизменённые floor/growth/headroom, host+VM checks на OrbStack и Linux storage monitor,
отдельная worker process group, 600 секунд worker deadline, обязательные down/volumes/residue
после success/failure/timeout/interruption. Linux фиксирует context/socket inode/daemon/storage;
OrbStack также требует backing identity. Изменение identity запрещает mutation и автоматический
cleanup на другом daemon; требуется ручная проверка владельцем. Подробности storage guard
находятся в [общем runbook](observability-pilot.md), их отдельная копия здесь не вводится.

`inputs.lock.json` содержит проверенные amd64/arm64 OCI config digests Postgres 16.13: image
создаёт postgres UID/GID 70 и PGDATA/socket directories с owner postgres. Сервис запускается
как `70:70`, с `cap_drop: ALL`, без privilege escalation. Fresh named-volume copy-up permissions
подтверждены указанными Mac/Linux supervised retention запусками. SQL не монтируется из host mode-0600 файла в entrypoint:
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
Metadata `snapshot_at` обозначает начало REPEATABLE READ transaction; `cutoff_age_seconds` показывает
отставание фиксированной границы от часов текущего batch. Это не календарный год.

Один batch выполняется как transaction с nonblocking advisory ownership, statement timeout 1 секунда,
lock timeout 250 ms, idle transaction timeout 2 секунды, не более 500 строк каждой из девяти
telemetry tables. Внешний transport deadline составляет 12 секунд, включая fresh-daemon preflight и SQL subprocess;
один drain ограничен 20 batches/30 секунд. Optional absolute deadline только ужесточает preflight: его
существующий command cap и проверки socket/context/daemon/storage не меняются.
При исчерпании бюджета возвращается `partial`, при отказе/недостоверном ответе возвращается `error`.
Повтор продолжает по предикатам, без cursor и изменения миграций. Counts относятся только к
acknowledged committed batches: потерянный ответ не доказывает отсутствие уже совершённых удалений.
Открытую транзакцию при обрыве соединения PostgreSQL откатывает; committed batches остаются.

Сначала удаляются expired/orphan event properties и revenue, затем события; отдельно удаляются
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
до физического удаления, partial/full drain и retry. Этот bounded corpus
прошёл в указанных Mac `fe89f406` / Linux source `4da87e1d` запусках. Schema-only PG и Python
doubles отдельно не подменяют source-bound API/cleanup proof. Scheduler и restore остаются pending.

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


### PostgreSQL startup readiness

Linux run `39303668904` остановился на `database_role`: `FixtureCommandFailed`, DB
`running / health starting`, monitor не отказал, cleanup прошёл. Точная причина этого
исторического запуска неизвестна: закрытая ошибка не содержит SQL stderr.

Отдельный реальный contract с закреплённым PostgreSQL `16.13-alpine` воспроизводит дефект
старой проверки: удерживает официальный entrypoint в init script, когда временный сервер
уже принимает Unix socket, но ещё не слушает TCP. Старый runner принимал это за готовность;
завершение init прерывает активный SQL connection. После запуска постоянного сервера исходный
private `init.sql` успешно создаёт отдельную базу и роль с ограниченными правами за один вызов.
Это доказательство класса startup race, а не установленная причина run `39303668904`.

Runner и Compose healthcheck теперь используют один фиксированный probe:
`pg_isready -h 127.0.0.1 -p 5432 -t 1 -U pilot_bootstrap -d postgres`.
Он отклоняет временный init server и принимает постоянный. Срок runner остаётся 60 секунд;
каждый вызов сохраняет fresh-daemon identity check и общий deadline, stdout/stderr закрыты.
Повторяется только readiness probe, не DDL. SQL и пароль передаются через private stdin;
при отказе готовности создание роли не начинается. Published ports и права не расширяются.

```sh
bash scripts/heavy-check.sh node --test scripts/observability-umami-startup.pg.test.mjs
```

Contract запускает только собственный disposable PostgreSQL через Testcontainers; Umami app
не запускается. Он проверяет init barrier, Unix/TCP различие, обрыв активного SQL при restart,
готовность persistent server, исходный role SQL и удаление owned container/volume.
После исправления supervised Umami retention запуски на Mac `fe89f406` и Linux source
`4da87e1d` прошли, как указано выше. Сам этот schema-only contract не доказывает runtime
retention или restore; доказательство bounded runtime retention относится к указанным supervised запускам.

### Изолированная проверка PG18 и закрытого SQL-восстановления

`scripts/observability-umami/recovery_runtime.py` является отдельным кандидатом на проверку
настоящего backup/restore. Обычный Umami pilot его не вызывает. Реальный запуск этого
кандидата пока не выполнен. Локальные Python-тесты проверяют подготовку, входные данные,
закрытый допуск и ошибки контроллера, без Docker и без доказательства SQL-восстановления.

Контроллер использует публичный pilot supervisor с прежним deadline 600 секунд,
проверкой daemon/storage и обязательным shutdown/residue check. Все ресурсы входят в один
собственный случайный Compose project. Host ports отсутствуют. Backup, restore и offline
PostgreSQL выделены в профиль `maintenance-only`, SQL-читатель и запись, в
`readers-after-replay`. Контроллер регистрирует оба профиля также для cleanup/recovery.
Нельзя запускать эти профили вручную вместо контроллера.

`infra/observability/umami/recovery-cache.lock.json` закрепляет существующий локальный ARM64
foundation cache и хеши Dockerfile/init/restore/config. Runtime требует точного image ID,
соответствия собственного cache tag и архитектуры. Нет fallback build или pull.

Этот cache record закреплён на историческом source `3a501dcafb83b83c8b126147b11f50e484037185`
с pgBackRest 2.57.0. Текущий production foundation использует 2.59.3, поэтому обычная
runtime-проверка отвергает старый record до подготовки ресурсов. Старые image ID, tag,
архитектура, хеши и проверка версии не переназначаются на текущие исходники.

Тесты исторической совместимости используют четыре неизменённых файла из этого commit
в `scripts/observability-umami/fixtures/foundation-2.57.0/` вместе с provenance. Тестовый
`historical_foundation_source()` проверяет происхождение и реальные байты до подмены
чтения. На время отдельного теста только четыре точных пути foundation читаются из
временных копий. Подготовка и повторная проверка читают одни и те же копии; остальные
файлы и проверки остаются текущими. Ошибки и изменения временных файлов доходят до
настоящего validator. Этот профиль проверяет исторический foundation с текущим
контроллером. Он не доказывает наличие пригодного текущего cache, image или успешного
восстановления 2.59.3. Отдельный тест без подмены подтверждает отказ старого record на
текущих исходниках. Запрет экспериментов после failed-RNG в #1579 сохраняется.

На Mac ожидаемый Compose hash заранее включает только точное добавление `storage-probe`
публичным supervisor. Оно вычисляется из frozen daemon identity, закреплённого probe lock
и того же владельца service/serializer. Worker сравнивает итоговые байты, не удаляет probe
из проверки и не нормализует неожиданные правки. Изменения другого service, mount,
параметров probe, private config или первоначального `init.sql` останавливают вход до
Docker I/O. Это исправление PG-BIND-1, обнаруженного до первого runtime-запуска кандидата.

Контроллер также проверяет фактические PostgreSQL 18.4 и pgBackRest 2.57.0. Несоответствие
версии останавливает проверку. Production Dockerfile, WAL и backup конфигурация не меняются.
Частная конфигурация использует собственный POSIX repository и новый случайный cipher pass.

В одном исходном кластере создаются синтетические Platform и Umami базы. Umami сохраняет
ограничения существующего pilot: connection limit 8, statement timeout 5s, idle transaction
timeout 10s и отсутствие административных прав. Собственный fixture запрещает Umami
CONNECT в Platform/Logto. Это не изменение production grants и не доказательство размера
Prisma pool. Схема Umami берётся из существующего точного fixture 26 закреплённых миграций.

Контроллер выполняет stanza-create/check/full backup с archiving, выбирает точный label
и требует обе базы в его manifest. Новый синтетический manifest удалений записывается
вне базы после backup. Исходный сервер останавливается. Перед очисткой PGDATA требуются
предварительное отсутствие recovery volume, его фактические Compose labels, local driver
без внешних options и правильный mount ещё не запущенного restore-контейнера. Одного
имени volume недостаточно. Исходный data volume не используется как назначение restore.

Восстановленная копия запускается без сети, с выключенным archiving и repository read-only.
Контроллер ждёт завершения recovery, сверяет lineage и обе базы. Настоящая ошибочная SQL
операция проверяет, что внешние SQL-акторы отсутствуют. Затем повторяются текущий синтетический
manifest и TTL с новым cutoff по времени БД. Ошибка или неполная очистка не вызывает допуск.
Перед запуском private `read-db` контроллер останавливает offline postmaster и требует
через inspect нулевой PID и отсутствие работающего процесса. После этого SQL-читатель
проверяет сохранённые свежие строки и отсутствие запрещённых, а запись создаёт только
синтетическое событие. Это SQL-акторы, не Umami HTTP-приложение или native MCP.

После immutable review, координации общего runtime и при наличии закреплённого cache
запуск из чистого checkout с новым private output directory:

```bash
bash scripts/heavy-check.sh python3 scripts/observability-umami/recovery_runtime.py run \
  --output .reports/umami-recovery-01
```

Для аварийного cleanup только этого зарегистрированного project, после завершения его
worker и process group:

```bash
bash scripts/heavy-check.sh python3 scripts/observability-umami/recovery_runtime.py recover \
  --output .reports/umami-recovery-01
```

В `recovery-proof.json` поле `operation` показывает последний one-shot этап:
`up`/`start`, `identity`, `inspect`, `state`, `wait`, `exit` или `comparison`. При отказе сохраняются
только фиксированная категория, проверенный числовой return code (иначе `null`) и форма
ID: количество (`none`/`one`/`multiple`), длина единственного значения и признак hex.
Диагностика одной операции занимает меньше 1 KiB и перезаписывается, не накапливается.
Она не содержит ID, raw stdout/stderr, SQL, config или текстов исключений. Она уточняет
место следующего отказа, но сама по себе не устанавливает причину исторического запуска,
в котором `repo-init` завершился с кодом 0, а проверка остановилась на `repository_initialize`.

После `up`/`start` контроллер проверяет полный 64-символьный ID и project/service labels,
затем вызывает Engine `docker wait` по этому ID с прежним пределом 90 секунд.
Числовой результат должен совпасть с exit code 0 при повторной проверке того же ID,
владельца и остановленного состояния. Смена ID, владельца, неизвестное состояние,
неправильный результат или timeout закрывают допуск к следующим этапам.

Только после подтверждённого exit 0 собственного `repo-init` выполняется read-only
сравнение Compose wait и Engine wait по тому же проверенному ID. На всё сравнение
выделено 10 секунд внутри общего лимита 600 секунд. Принимается только успех Compose
либо код 1 с точным ограниченным сообщением об отсутствии контейнеров собственного
project. Неизвестные ошибки останавливают проверку. Между вызовами повторно проверяются
ID, владелец и exit 0. `operation.compatibility` сохраняет только фиксированные исходы,
проверенные коды и признак неизменного собственного ID. Это диагностика после основного
допуска, она не повторяет операцию и не заменяет проверку успеха.

Успешное сравнение сохраняется отдельно в `repo_init_wait_comparison` и остаётся
доступным после backup, restore или последующего отказа. Последнее поле `operation`
по-прежнему перезаписывается следующей one-shot операцией.

До запуска restore поле `destination_operation` показывает последний подэтап:
`create`, `volume_inspect`, `container_identity`, `container_inspect`, `offline` или
`ownership_mounts`. Это одно перезаписываемое поле размером меньше 1 KiB. В нём только
schema, фиксированные step/outcome/error и проверенный числовой returncode либо `null`.
Оно не сохраняет ID, имена volumes, paths, inspect, stderr, SQL или тексты исключений.
Отказ сохраняет закрытый reader gate и запрещает запуск restore. Проверки владельца,
mounts и offline-состояния обязательны. Исторический точный отказ на `restore_destination`
остаётся неизвестным до получения нового доказательства.

После успешного restore поле `recovered_postmaster` показывает последний подэтап:
`create`, `container_identity`, `container_inspect`, `stopped`, `mount`, `offline`,
`start`, `sql_ready`, `recovery_ended`, `cluster`, `lineage`, `platform`, `role`,
`events` или `readers_absent`. `sql_ready` включает существующее ожидание SQL readiness
и окончания recovery с прежним deadline. Успех фиксируется только после всех проверок.
Поле содержит только schema, фиксированные step/outcome/error и проверенный числовой
returncode либо `null`, занимает меньше 1 KiB и перезаписывается без истории.
SQL, строки результатов, исключения, ID, paths и secrets туда не записываются.
Поле сохраняется после последующих maintenance-операций. Его отказ оставляет reader gate
закрытым; readers и ingest не создаются. Порядок команд, проверки и deadlines прежние.

Вложенное `recovered_postmaster.readiness` сохраняет последний проверенный числовой
код `pg_isready` либо `null`, последнее известное булево `recovery_ended` либо `null`,
фиксированные condition/error и schema. При истечении прежних 60 секунд error становится
`deadline_exceeded`, а condition сохраняет различие между `not_accepting`, `recovering`
и `query_failed`. Неправильный ответ отмечается как `invalid_response`, timeout команды
как `timeout`. Эти значения не содержат SQL, тела ответа или сообщения об ошибке.
Последнее известное `recovery_ended` описывает ранее прочитанный факт, а не текущую
готовность после последующего отказа. Callback необязателен; polling и deadlines прежние.

Если JSON metadata прочитан, но прежняя строгая проверка кластера не пройдена,
`recovered_postmaster.cluster_validation` содержит только `schema: 1` и
`invalid_field`: `shape`, `version_num`, `system_identifier`, `archive_mode` или
`archive_command`. Указывается первая непройденная проверка в этом порядке.
Значения полей, дополнительные ключи и сырой ответ не сохраняются. Неправильный JSON
по-прежнему отмечается `error: invalid_json` без `cluster_validation`. Проверки SQL,
версии, system identifier, archive command, lineage и reader gate не ослаблены.

В запуске `435a5806` restore завершился с кодом 0, postmaster принимал соединения,
recovery закончилось, затем строгая проверка metadata отказала на шаге `cluster`.
Конкретное поле не установлено, reader gate остался закрытым. Инициализация задаёт
archive command через `ALTER SYSTEM` в `init-production-databases.sh`.
[Исходник pgBackRest 2.57.0](https://github.com/pgbackrest/pgbackrest/blob/release/2.57.0/src/command/restore/restore.c#L1494-L1590)
сохраняет прежние настройки `postgresql.auto.conf`, исключая заменяемые recovery target
settings; `--archive-mode=off` добавляет `archive_mode=off`. Штатная очистка archive
command этим исходником не подтверждена. SHA-256 проверенного `restore.c`:
`b95cd8cb00c58fe0fa3eb7d9e4a912d13db128bb1f4586b54a48c9e9f153dc60`.
Новая диагностика различает поля следующего отказа, но не устанавливает историческую причину.

В запуске `9dd535a5` новая диагностика установила `invalid_field: archive_command`.
[PostgreSQL 18.4 `show_archive_command`](https://github.com/postgres/postgres/blob/REL_18_4/src/backend/access/transam/xlog.c#L4530-L4540)
возвращает `(disabled)` при `archive_mode=off`, даже когда настроенная команда сохранена.
[`current_setting`](https://github.com/postgres/postgres/blob/REL_18_4/src/include/catalog/pg_proc.dat#L6495-L6501)
вызывает [`show_config_by_name`](https://github.com/postgres/postgres/blob/REL_18_4/src/backend/utils/misc/guc_funcs.c#L752-L767),
затем [`GetConfigOptionByName` и string show hook](https://github.com/postgres/postgres/blob/REL_18_4/src/backend/utils/misc/guc.c#L5438-L5553).
[Регистрация archive command](https://github.com/postgres/postgres/blob/REL_18_4/src/backend/utils/misc/guc_tables.c#L4170-L4180)
использует этот hook; [`XLogArchivingActive`](https://github.com/postgres/postgres/blob/REL_18_4/src/include/access/xlog.h#L98-L103)
при отключённом archiving ложен. SHA-256 проверенных файлов: `xlog.c`
`cdd9ba6adc4e109d3a2581c94151104095f97c2d905142dbe3d857d8e35cf7ab`, `guc.c`
`3021d40bb4e920a56fbc5e9452e32903a7364d7ce0aece65be70aa3c34c1274e`.

Контроллер теперь различает строгие контракты: исходная база требует `archive_mode=on`
и точную команду `pgbackrest --stanza=production archive-push %p`, offline-база требует
`archive_mode=off` и точное отображение `(disabled)`. Пустая строка, произвольная команда
или значение другого режима отклоняются. Offline-отображение не доказывает исходное
значение команды в конфигурации. Активная команда проверяется до backup. Версия,
system identifier, lineage, offline mounts, read-only repository, отсутствие readers
до replay и TTL-проверок остаются обязательными. Исправление следует pinned source;
прохождение реального restore с этим контрактом требует нового отдельного запуска.

В запуске `4ff1c1b2` destination и restore прошли, `recovered` к моменту cleanup работал,
reader gate остался закрытым. Точный подэтап отказа после restore и успешные SQL-проверки
не установлены. Новая диагностика нужна для следующего доказательства и сама по себе
не определяет историческую причину.

Создание контейнеров `restore`, `recovered` и `read-db` использует только
`docker compose create SERVICE`. Generated plan не объявляет `depends_on`; скрытых
зависимостей у этих сервисов нет. `create` не запускает контейнеры. Проверки offline,
владельца, mounts и reader gate выполняются перед соответствующим `start`.
`--no-deps` остаётся только у поддерживающего его `up`: [Compose create](https://docs.docker.com/reference/cli/docker/compose/create/)
и установленный `v2.40.3-desktop.1 create --help` такой флаг не поддерживают.
В запуске `3b065615` закрытая диагностика показала отказ `create` с кодом 1;
отдельный read-only parser probe воспроизвёл `unknown flag: --no-deps` до чтения
несуществующего compose-файла. Этот вывод относится к текущей команде, он не устанавливает
исключительную причину более ранних запусков `16839f7e` или `50b0daba`.

В среде неуспешного запуска установлен Compose `v2.40.3-desktop.1` (read-only metadata).
В upstream [Compose v2.40.3 wait.go](https://github.com/docker/compose/blob/v2.40.3/pkg/compose/wait.go)
выбор контейнеров передаёт `all=false`; [containers.go](https://github.com/docker/compose/blob/v2.40.3/pkg/compose/containers.go)
передаёт это значение Engine ContainerList. Быстро завершившийся контейнер поэтому может
не попасть в выборку. [Engine wait](https://docs.docker.com/reference/cli/docker/container/wait/)
поддерживает уже остановленный контейнер. Это подтверждает гипотезу совместимости,
но не устанавливает исключительную причину исторического отказа: исходный код именно
Desktop-сборки и фактическое сравнение в новом публичном запуске пока не подтверждены.

Проверяются `recovery-proof.json`, `recovery-inputs.json`, `evidence.json`,
`worker-outcome.json`, `cleanup.json` и storage evidence. Успешный SQL-result без успешного
cleanup не является успешным запуском. `compose.json` содержит credentials, остаётся
mode 0600 в private mode 0700 directory и нужен для cleanup. Его нельзя публиковать,
как и весь private output directory. Копировать можно только перечисленные curated artifacts.

Источник актуальных production-удалений остаётся неизвестным. Синтетический manifest
доказывает лишь механизм повтора и порядок допуска. Плановая очистка в следующие сутки,
Umami HTTP/native MCP restore, production S3 recovery, ресурсные критерии и семь суток
наблюдений остаются отдельными непроверенными требованиями #1565/#1566.

Production encryption отдельно блокирует #1579. [Официальное сообщение pgBackRest
от 4 октября 2026](https://pgbackrest.org/news.html) указывает: до 2.59.3 ошибка получения
случайных данных OpenSSL могла остаться незамеченной и ослабить subkeys/salts. В этом
срезе 2.57 сохранён только для синтетической совместимости. Его запуск не доказывает
пригодность production-шифрования. Обновление binary само по себе не заменяет старые
stanza subkeys. Дальнейшая работа с foundation и существующим repository относится к #1579.
