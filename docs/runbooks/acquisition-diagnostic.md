# Однократная диагностика acquisition #1324

Этот эксперимент запускает Root только после отдельного hosted grant и review подготовленного commit.
Он проверяет получение images на реальной SDK/global-setup seam, не выполняя integration cases.
Эксперимент не устанавливает provider cause и не закрывает #1324.

Baseline: `546518b02e48158f213524b19adc46aae7fd8e49`.
SDK patch, PostgreSQL setup, SQL prerequisite и их dependency inputs совпадают с `af1cab0488a01707daeac64f83b5521076ac4b71`.
Поэтому freshness merge не нужен. SQL prerequisite выполняется первым, как в Integration job.
Затем выполняется тот же `postgres.global.ts`; после успеха сразу вызывается его нормальный teardown.
Если setup отказал до возврата teardown, supervisor закрывает процессы и весь ephemeral daemon.

Root использует отдельный свежий Linux runner с единоличным владением системными Docker/containerd services.
Runner имеет существующие frozen dependencies и тот же pinned Node/SDK, что Application CI.
Root сохраняет source SHA, workflow/job identity и runner image version отдельно.
Marker ниже означает явный grant на shutdown всего daemon этого ephemeral runner.
Он запрещён на shared stand, машине владельца и runner с чужими процессами или контейнерами.

Repository-owned entry: `.github/workflows/acquisition-diagnostic.yml`.
Он получает только `pull_request: labeled` для `main`, same-repository PR #1333 и attempt 1.
Label должен совпасть с `1324-acq-<полный head SHA>`.
Обычный push, другой label, новый head и rerun не допускают diagnostic job.
`workflow_dispatch` не подходит до появления workflow на default branch.
GitHub описывает [labeled events и head checkout](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request).

Root выполняет следующую последовательность после отдельного hosted grant:

1. Дождаться завершения обычного CI после source push.
2. Зафиксировать reviewed head PR #1333 и проверить отсутствие новых source commits и merge conflicts.
3. Создать label `1324-acq-<полный reviewed head SHA>` и добавить его к PR #1333 ровно один раз.
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
SQL prerequisite выполняет только guardian. Workflow не добавляет preload или provider changes.
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
Guardian считает Docker data, containerd data, output и временный backend cache вместе.
Все эти paths должны находиться на одном filesystem.
Growth ceiling: 2 GiB; ранняя остановка с margin 256 MiB.
Diagnostics ceiling: суммарно 1 MiB для stdout и stderr, включая SDK DEBUG.
Guardian принимает оба потока через pipe и сохраняет только байты внутри лимита.
Периодическая проверка ресурсов не задерживает и не повторяет registry requests.
Guardian резервирует время на shutdown внутри общего runtime budget 180 s.

Source допускает максимум три logical image acquisitions: native SQL PostgreSQL `996d…`,
SDK PostgreSQL `9a8afca…`, затем publisher Ryuk `7c1a8a9…`.
References, digests, platform defaults, pull arguments и SDK auth lookup сохраняются.
Новых retries/preload, image/provider/version, credentials и mirror нет.
Внутренняя HTTP политика Docker daemon сохраняется; один logical pull может содержать несколько HTTP requests.

`DEBUG=testcontainers:pull` сохраняет supported stream diagnostics.
Перед печатью stream records проходят allowlist: произвольный текст, headers и URLs исключены.
Тонкие observations добавляют actual pull start/end, arguments и auth presence.
Они возвращают исходный Promise, result и error; auth values не сериализуются.
Runtime record содержит только architecture, OS, Docker Engine version и presence Docker environment locators.
Host/socket paths, environment values, auth headers и signed URLs не печатаются.
SQL child output подавлен; `sql-prerequisite` в `diagnostic.jsonl` сохраняет настоящий SQL exit.
`nativeExit` в `receipt.json` относится ко всему диагностическому процессу.
Неизвестный primary получает failure exit и безопасную классификацию, без произвольного error text.

Успех означает успешный setup и нормальный teardown только этого запуска.
Ошибка сохраняет failed status; она не преобразуется в success.
После процесса guardian останавливает системные Docker/containerd services этого ephemeral runner.
`receipt.json` сохраняет native exits, resource samples и результат shutdown.
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


### Diagnostic-owned privileged measurement

The committed entry first runs a no-Docker mixed-UID native preflight on the ephemeral Linux runner. Root must authorize the next one exact-SHA label after source checks, full review and terminal normal CI. The previous hosted attempt failed before admission; neither the timed-out command nor PID 2877 ownership was captured. Initial privileged `du` is a hypothesis. Provider acquisition and the #1324 cause remain unproved.

The meter uses its own transient systemd unit, separate from the unprivileged supervisor ancestry. The unit registers `KillMode=control-group`, `RuntimeMaxSec` and a bounded stop reserve before launching a root leaf. A private FIFO and the caller PID/birth/UID bind owner lifetime. The privileged helper records real UID, PGID and birth, then signals and reaps only its verified leaf groups. Owner EOF/death cancels measurement. An independent unit deadline remains when the helper or caller dies. Shared `owned-process.py`, `heavy-check/lock.py` and EPERM behavior are unchanged.

Before every native operation, `command-stage.json` records its stage, allowlisted command, start and deadline. A separate `primary-failure.json` preserves TimeoutExpired command, timeout, bounded partial stdout/stderr and primary status before cleanup. Command and acquisition output share the existing 1 MiB cap. The 10-second command bound, 180-second whole bound, shutdown reserves, resource floors, images and zero retries remain unchanged.

Repository tests exercise actual nonprivileged timeout, FIFO cancellation, output intake, signals and reap. Run `node scripts/owned-node.mjs --command python3 -B -m unittest discover -s scripts -p 'test_acquisition_diagnostic_*.py'`. These results cannot prove mixed-UID Linux closure. The future hosted native preflight tests a TERM-resistant root leaf and runner-owner SIGKILL, records kernel fingerprints and requires native absence before `pending: 0`. The guardian starts only after that preflight succeeds. The actual root fixture and acquisition guardian remain pending until a separate Root grant.
