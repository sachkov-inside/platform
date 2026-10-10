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

После checkout точного подготовленного commit Root выполняет один раз из корня репозитория:

```bash
ACQUISITION_DIAGNOSTIC_EPHEMERAL=1 python3 scripts/acquisition-diagnostic-guard.py \
  --source-sha '<полный SHA подготовленного commit>' \
  --output "$RUNNER_TEMP/1324-acquisition"
```

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
Runtime record содержит только architecture, OS, API version и presence Docker environment locators.
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
node --test scripts/acquisition-diagnostic.test.mjs
node scripts/check-agent-documentation.mjs
```

Эти проверки доказывают propagation, secret omission и вызов teardown через диагностический адаптер.
Они не доказывают реальный Docker teardown, доступность registry, causal red/green или current-head CI.
Hosted experiment, whole check, CI queue и rerun принадлежат Root и требуют отдельных grants.
