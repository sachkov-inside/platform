# Однократная диагностика acquisition #1324

Этот эксперимент запускает Root только после отдельного hosted grant и review подготовленного commit.
Он проверяет получение одного выбранного pinned RabbitMQ image через нормальный SDK image client, без integration cases.
Один successful retry не устанавливает provider cause и не закрывает #1324.

Baseline: `546518b02e48158f213524b19adc46aae7fd8e49`.
SDK patch и dependency inputs сверяются с reviewed Source и actual failure Source #855.
Перед новым grant Root повторяет сверку inputs на reviewed Source.
Guardian выбирает `ACQUISITION_DIAGNOSTIC_IMAGE=rabbitmq`; другой или отсутствующий выбор запрещён.
Fixture импортирует `NOTIFICATION_BROKER_IMAGE` из канонического `topology.ts`, без копии digest.
Он вызывает `image.pull(ImageName.fromString(image), { force: false, platform: undefined })` один раз.
Это acquisition boundary из pinned `GenericContainer.start`; `setup/broker.ts` не меняет pull policy или platform.
Fixture не запускает SQL prerequisite, PostgreSQL, Ryuk, broker или test cases.
После успеха или отказа supervisor закрывает owned процессы и весь ephemeral daemon.
Прежний PostgreSQL/global-setup/SQL путь сохранён в истории Source `f20db233501e6a03bf74dd9446ad79e2ed7be58d`.

Root использует отдельный свежий Linux runner с единоличным владением системными Docker/containerd services.
Runner имеет существующие frozen dependencies и тот же pinned Node/SDK, что Application CI.
Root сохраняет source SHA, workflow/job identity и runner image version отдельно.
Marker ниже означает явный grant на shutdown всего daemon этого ephemeral runner.
Он запрещён на shared stand, машине владельца и runner с чужими процессами или контейнерами.

Repository-owned entry: `.github/workflows/acquisition-diagnostic.yml`.
Он получает только `pull_request: labeled` для `main`, same-repository PR #1340 и attempt 1.
Label должен совпасть с `1324-acq-<полный head SHA>`.
Обычный push, другой label, новый head и rerun не допускают diagnostic job.
`workflow_dispatch` не подходит до появления workflow на default branch.
GitHub описывает [labeled events и head checkout](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request).

Root выполняет следующую последовательность после отдельного hosted grant:

1. Дождаться завершения обычного CI после source push.
2. Зафиксировать reviewed head PR #1340 и проверить отсутствие новых source commits и merge conflicts.
3. Создать label `1324-acq-<полный reviewed head SHA>` и добавить его к PR #1340 ровно один раз.
4. Наблюдать один run `Acquisition diagnostic 1324`; не использовать rerun или повторное добавление label.
5. Сохранить run/job identity, actual exits и artifact `acquisition-1324-<SHA>-<run_id>-1`.
6. Проверить `receipt.json` и независимый `native-closure.json`; принять cleanup только при `pending: 0`.
7. Удалить diagnostic label после сохранения результата.

Это действие Root выполняет под своей авторизованной GitHub identity, не через workflow `GITHUB_TOKEN`.
Skipped job, source review и зелёный prerequisite не доказывают выполнение acquisition или завершение #1324.
Если frozen head изменился, старый label запрещён; новый эксперимент требует решения Root.

Workflow использует `ubuntu-24.04`, `contents: read`, checkout точного head без сохранения credentials.
Shared `setup-platform` устанавливает frozen dependencies без browsers; prerequisite ограничен 10 минутами.
Guardian step ограничен 4 минутами, job — 18 минутами; acquisition budget остаётся 180 s.
Workflow не добавляет preload или provider changes.
`identity.json` содержит только source/workflow/job/run identity и runner image metadata.
После guardian workflow через существующий `owned-node` дожидается native выхода всего дерева.
Независимая Linux qualification проверяет process census workspace и inactive Docker/containerd units с MainPID 0.
Она сохраняет failed status при недоказанном shutdown; always-run upload сохраняет evidence после отказа.
Потеря VM или SIGKILL всех supervisors по-прежнему требует внешнего lifecycle владельца runner.

Workflow передаёт guardian тот же `github.event.pull_request.head.sha`, что использует checkout:

```bash
node scripts/owned-node.mjs --command python3 scripts/acquisition-diagnostic-guard.py \
  --source-sha "$SOURCE_SHA" --output "$RUNNER_TEMP/1324-acquisition"
```

Marker `ACQUISITION_DIAGNOSTIC_EPHEMERAL=1` задаёт только отдельно допущенный diagnostic step.
Output directory должен отсутствовать. Guardian сверяет HEAD и чистоту tracked files.
Admission требует 20 GiB свободного места. Floor составляет 15 GiB плюс margin 256 MiB.
Docker data, containerd data, output и временный backend cache должны находиться на одном filesystem.
Guardian сохраняет один `statvfs` snapshot для baseline и admission; recursive `du` в guardian отсутствует.
Used bytes равны `(f_blocks - f_bfree) * f_frsize`; available bytes равны `f_bavail * f_frsize`.
Поля определены [Python os.statvfs](https://docs.python.org/3/library/os.html#os.statvfs).
Receipt сохраняет device, исходные blocks, block size, extrema witnesses и final snapshot.
Growth означает изменение net used bytes всего filesystem относительно baseline.
Чужой рост также уменьшает бюджет. Одновременное удаление может скрыть часть роста owned paths.
Поэтому runner должен оставаться disposable, idle и с одним владельцем записи; prune во время acquisition запрещён.
Этот способ не измеряет сумму directory allocations и не доказывает отсутствие краткого пика между samples.
Growth ceiling: 2 GiB; ранняя остановка с margin 256 MiB.
Diagnostics ceiling: суммарно 1 MiB для stdout и stderr, включая SDK DEBUG.
Guardian принимает оба потока через pipe и сохраняет только байты внутри лимита.
Периодическая проверка ресурсов не задерживает и не повторяет registry requests.
Guardian резервирует время на shutdown внутри общего runtime budget 180 s.

Существующий guardian ceiling остаётся три logical image acquisitions; выбранный SDK call только один.
Нормальный SDK cache check может завершить этот call без Engine pull при наличии image.
References, digests, platform defaults, pull arguments и SDK auth lookup сохраняются.
Новых retries/preload, image/provider/version, credentials и mirror нет.
Внутренняя HTTP политика Docker daemon сохраняется; один logical pull может содержать несколько HTTP requests.

### Актуальный отказ RabbitMQ в обычном CI

Run [38075627035](https://github.com/sachkov-inside/platform/actions/runs/38075627035/job/114281873703)
для PR #1342 проверял Source `71866db1cd12e88915ed44dbc660b78a9f051950`.
В Integration serial `notifications-acceptance.test.ts` отказал в `beforeAll`, внутри `startNotificationBroker`.
Первичный pull error в 18:25:14.512Z: `toomanyrequests: Rate exceeded`.
Image: `public.ecr.aws/docker/library/rabbitmq:4.2.4-management-alpine@sha256:adac51a4a14a200b8eb928a12787564ed56e93fc55e789a73ec13e1e2eac7aef`.
Cleanup #1309 сохранил первичную ошибку без вторичного `undefined.stop`.
Job сохраняет failure; позднейший успех другого broker suite не устанавливает причину отказа.

Выбранный probe получает этот RabbitMQ через ту же SDK image acquisition seam и сохраняет его digest.
Он не запускает `beforeAll` или broker и не доказывает устранение blocker.
Обычный f20 CI [38079799570](https://github.com/sachkov-inside/platform/actions/runs/38079799570/job/114294182536)
отказал в root globalSetup с `Rate exceeded` после успешного native SQL prerequisite.
Image, auth presence и concurrency этого отказа не записаны; image остаётся UNOBSERVED.
RabbitMQ probe не воспроизводит PostgreSQL/Ryuk/SQL контекст f20 и не закрывает этот пробел.
До отдельного Root grant acquisition не повторяется; pins, auth, provider, budgets и retries не меняются.
Сам error не устанавливает auth mode, quota dimension, shared egress или причину throttling.

`DEBUG=testcontainers:pull` сохраняет supported stream diagnostics.
Перед печатью stream records проходят allowlist: произвольный текст, headers и URLs исключены.
Тонкие observations добавляют actual SDK pull start/end, arguments, SDK exists result и auth lookup start/end/presence.
Они также наблюдают настоящий `dockerode.pull` transport внутри pinned DockerImageClient.
Этот transport проверяется до acquisition; другая SDK layout не допускает молчаливой потери request evidence.
`request-start/returned/failed` отмечают вызов Docker Engine ImageCreate и получение stream либо отказ.
`returned` не означает завершение загрузки: его завершение определяет SDK `pull-complete/failed`.
Каждая boundary имеет свои call identity, monotonic timestamps и счётчик активных logical calls.
Auth result presence и outgoing authconfig presence — только booleans; они не доказывают валидность token или quota mode.
SDK cache result наблюдается без дополнительного inspect, preload или запроса.
Они возвращают исходный Promise, result и error; auth values не сериализуются.
Runtime record содержит architecture, OS, Docker Engine version, provider, process PID и presence Docker environment locators.
Host/socket paths, environment values, auth headers и signed URLs не печатаются.
Engine call concurrency не измеряет внутренние registry HTTP requests daemon или shared egress/IP quota.
Сохранённый исторический failure нельзя дополнить отсутствовавшими auth/runtime/concurrency фактами нового probe.
`nativeExit` в `receipt.json` относится ко всему диагностическому процессу.
Неизвестный primary получает failure exit и безопасную классификацию, без произвольного error text.

Успех означает успешный setup и нормальный teardown только этого запуска.
Ошибка сохраняет failed status; она не преобразуется в success.
После процесса guardian останавливает системные Docker/containerd services этого ephemeral runner.
`receipt.json` сохраняет native exits, resource samples и результат shutdown.
До попытки запуска SDK receipt содержит `acquisitionStarted: false`.
Перед `Popen` guardian ставит `true`; failed spawn не превращается в утверждение об отсутствии child.
Qualifier принимает explicit `false` только без `supervisorPid`/`supervisorExit` и при чистом native census.
После start отсутствующий supervisor exit оставляет closure недоказанным.
Legacy receipt с integer supervisor exit остаётся допустимым; invalid state и boolean exit не допускаются.
`pending: 0` требует успешного daemon shutdown; Root также проверяет native process census своего runner.
Если guardian не доказал cleanup, Root не принимает результат и завершает ephemeral runner.
Этот протокол требует внешнего lifecycle владельца runner при SIGKILL самого guardian или потере VM.

Подготовительные проверки используют только существующие dependencies:

```bash
node --test scripts/acquisition-diagnostic.test.mjs scripts/acquisition-workflow-contract.test.mjs
node scripts/owned-node.mjs --command python3 -m unittest discover -s scripts -p "test_acquisition_diagnostic_*.py"
node scripts/check-agent-documentation.mjs
```

Эти проверки доказывают propagation, secret omission и вызов teardown через диагностический адаптер.
Python regressions проверяют intake, поздний cache, итоговый resource sample, deadline и ошибки cleanup.
Repository entry использует внешний `owned-node` supervisor, который закрывает дерево также после SIGKILL unittest owner.
Без ownership marker guard contracts отказывают до запуска child.
Они запускают только собственные Python subprocesses; git, Docker и shutdown заменены doubles.
Workflow contracts проверяют actual job expression на неверных events, SHA, PR, fork и attempt.
Native qualification contracts используют supplied process/daemon doubles и сохраняют отказ при pending resources.
Они не доказывают реальный Docker teardown, доступность registry, causal red/green или current-head CI.
Hosted experiment, whole check, CI queue и rerun принадлежат Root и требуют отдельных grants.


### Privileged clients и отдельный native proof

Hosted run [38071159784](https://github.com/sachkov-inside/platform/actions/runs/38071159784)
на Source `9a4e2591682144d902cf3e02ec785e0dfb54b90d` отказал до SDK.
Primary был recursive `du` с timeout 10 s; UID0/PID2641/birth8007 и отсутствие meter descendants сохранены.
Daemon shutdown завершился native0. Qualifier отказал из-за отсутствующего `supervisorExit` до SDK.
Это не объясняет исторический Rate exceeded; failure сохраняется как failure.

Guardian больше не вызывает meter для filesystem samples.
Meter остаётся владельцем двух fixed privileged transports и native root-leaf regression.
`systemd-run` регистрирует independent cgroup cleaner до запуска root leaf:
`KillMode=control-group`, `RuntimeMaxSec` и bounded stop reserve.
Private FIFO и caller PID/birth/UID привязывают root worker к владельцу.
Root worker проверяет fingerprint, сигналит только свои группы и проверяет native отсутствие.

Оба privileged clients запускаются как `sudo -n timeout --signal=TERM --kill-after=… … <client>`.
GNU timer работает как root, без `--foreground`, и закрывает собственную группу.
TERM window, KILL reserve и outer reap входят в прежний timeout: 10 s для launch и максимум 30 s для shutdown.
Ordinary exit не заменяется success; 124/137 сами по себе не доказывают отсутствие процессов.
Поведение групп и сигналов описывает [GNU timeout](https://www.gnu.org/software/coreutils/manual/html_node/timeout-invocation.html).
Python `subprocess` сохраняет signal termination как negative returncode,
например `-9` для SIGKILL: [CompletedProcess.returncode](https://docs.python.org/3/library/subprocess.html#subprocess.CompletedProcess.returncode).
Native fixture сохраняет этот status в receipt, а CLI caller кодирует его как `128 + signal`.
`TimeoutExpired` внешнего transport оставляет native exit неизвестным; он не превращается в GNU status 124.

Перед bounded unprivileged commands `command-stage.json` сохраняет stage, command и deadline.
`primary-failure.json` сохраняет первый native failure до cleanup, включая bounded partial stdout/stderr.
Command и SDK output используют прежний общий cap 1 MiB.
Shared `owned-process.py`, `heavy-check/lock.py`, EPERM policy, provider/pull/auth и zero retries сохраняются.

Native entry `scripts/acquisition-diagnostic-meter-native.py` проверяет real root worker timeout и owner SIGKILL.
Для каждого client, `systemd-run` и `systemctl`, он проверяет timeout, caller SIGKILL, sudo SIGKILL и ordinary exit29.
Только service executable заменён TERM/HUP-resistant fixture; production transport, sudo и GNU timer остаются настоящими.
Fixture создаёт root client и root child; record сохраняет client/child/monitor PID, UID, PGID и birth.
Parent сверяет их live kernel identities; fixture ждёт acknowledgement до ordinary exit.
Qualification отвергает missing/wrong identities, foreign client/group/session, missing case и pending resources.
Для TERM-resistant timeout fixture нужен actual transport elapsed после TERM plus KILL, внутри прежнего budget.
Native `-9` или shell `137` не заменяют kernel absence; qualification сохраняет отдельный census каждого identity.
Native proof требует их kernel absence; unprivileged parent принимает и reaps orphan children.
Bounded cleanup сигналит только сохранённые identities и отказывает при foreign group member.
Proof budget — 55 s внутри прежнего workflow step 1 min; каждый client case использует 3 s и bounded reap.
Proof не вызывает Docker, не останавливает daemon и не запускает SDK.
Подготовленный entry и local doubles не являются исполненным Linux proof.

Native-only [run38078689293](https://github.com/sachkov-inside/platform/actions/runs/38078689293/job/114290928101)
на exact `e67fe5b683fc76d130c419535517fdad657900eb` завершился failure.
Primary: первый `systemd-run` timeout вернул native `-9`, а proof ошибочно ожидал shell 124/137.
Caller получил 247 при прежнем Python `exit(-9)`; сохранённый run остаётся failed и closure unproven.
Acquisition job был skipped. Исправленный representation contract требует нового exact-SHA review и нового native grant.

Отдельный native-only job того же workflow требует новый grant и label `1337-p2-<полный reviewed SHA>`.
Label длиной 48 characters допускается только для same-repository PR #1340, event `labeled`, `main` и attempt1.
Job получает exact checkout и pinned Node без workspace dependency install; job budget — 3 min.
`acquisition` job при этом label skipped. Artifact: `native-closure-1337-<SHA>-<run_id>-1`.
Root добавляет label ровно один раз после grant, сохраняет exits/artifacts, затем удаляет label.
Этот grant не разрешает acquisition label или rerun.

Exact native command на disposable Ubuntu с pinned Node:

```bash
ACQUISITION_DIAGNOSTIC_NATIVE_EPHEMERAL=1 \
node scripts/owned-node.mjs --command python3 scripts/acquisition-diagnostic-meter-native.py \
  --source-sha "$SOURCE_SHA" --output "$RUNNER_TEMP/1337-native"
```

Source должен быть clean и совпадать с reviewed SHA; output directory не должен содержать предыдущий `meter-native`.
До второго acquisition нужны новый exact SHA, independent review, guards, native proof и отдельное решение Root.
Обычный CI завершается до acquisition label. Старый run не является проверкой нового HEAD.
