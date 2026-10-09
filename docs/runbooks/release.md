# Выпуск следующей версии

Один проход от `main` до проверенного production для Platform и Telegram. Подробности каждого шага
живут в [production delivery](production-delivery.md) (выкладка, откат, состояние),
[production release](production-release.md) (конфигурация, брокер, проверки после выкладки) и
`docs/operations/production.md` Telegram. Процесс проверен в
[Workspace #184](https://github.com/sachkov-inside/workspace/issues/184): первый выпуск v7, второй
обычный выпуск, откат и возврат вперёд.

Выпуск и выкладка требуют разрешения владельца (`WORKFLOW.md`, Owner gates). Всё ниже, кроме
шага 2, выполняется без входа на сервер.

Сеть от рабочей машины до сервера и GitHub рвётся (banner timeout, EOF). Повторяйте только
подключение, не действие (решение владельца от 27.09.2026, sachkov-inside/workspace#228):

- на сервере повторяйте пробу `ssh … true`, а саму команду выполняйте один раз: 24.09.2026 обёртка,
  повторившая всю команду, запустила скрипт заново и затёрла файл пустым вводом;
- если `gh workflow run` оборвался, сначала найдите запуск в `gh run list -w <workflow>` и следите
  за ним; запускайте заново, только если его там нет.

## 1. Что выпускаем

```bash
git fetch origin
current=$(gh release view --json tagName -q .tagName)            # последняя опубликованная, например v8
git log --oneline "$current"..origin/main
```

Номер следующего выпуска — `current` + 1. Выпускается ровно текущий `main`; CI выпуска повторяет
проверки PR.

CI выпуска не запускает full-stack smoke. Именно в нём права проверяются через настоящий Web/BFF
отдельными identities (#904). Поэтому перед выпуском нужен зелёный
[nightly full-stack smoke](continuous-integration.md#nightly-full-stack-smoke) ровно на коммите
выпуска:

```bash
release_sha=$(git rev-parse origin/main)
gh run list --repo sachkov-inside/platform -w nightly-fullstack.yml --branch main --limit 100 \
  --json headSha,conclusion,url \
  -q ".[] | select(.headSha == \"$release_sha\" and .conclusion == \"success\")"
```

Если зелёного запуска на этом коммите нет, запустите его и дождитесь успеха:
`gh workflow run nightly-fullstack.yml --repo sachkov-inside/platform --ref main`. Красный прогон
останавливает выпуск до исправления.

## 2. Нужен ли разовый шаг на сервере

Обычный выпуск меняет только образы, миграции, Compose и маршруты Caddy Platform: всё это
доставляет `deploy.yml`. Вход на сервер нужен, только если с прошлого выпуска изменилось что-то из
таблицы. Проверка одной командой:

```bash
git diff --stat "$current" origin/main -- \
  config/compose/production infra/production/host infra/production/database \
  infra/production/logto infra/identity/logto infra/production/broker \
  apps/backend/src/release/write-notification-broker-definitions.ts
```

| Изменилось | Что сделать до выкладки |
|---|---|
| `config/compose/production/*.env.example` | Добавить новые ключи в `/etc/inside/runtime/*.env` ([конфигурация](production-release.md#server-owned-configuration)). Deploy отказывает, пока где-то остаётся `replace-with-`; группа, которую не включают, удаляется целиком |
| `infra/production/host/*` | Применить изменённый файл по [подготовке VPS](production-foundation.md); provisioning повторно не запускать |
| `infra/production/database/*` | Обновить foundation по [подготовке VPS](production-foundation.md#порядок-применения-в-244): свежий checkout в `/opt/inside/foundation`, `docker compose ... up --detach --build --wait` |
| `infra/production/logto/*`, `infra/identity/logto/*` | [Обновить Logto](production-foundation.md#обновление-logto): образ собирается вне VPS и загружается на сервер. Если изменились только непроизводственные файлы (README, proof), пересборка не нужна |
| Состав principals, очередей или vhost брокера | Заново выпустить `definitions.json` образом нового выпуска ([Broker](production-release.md#broker), шаг 3) — сразу после шага 3 этого runbook и до шага 4 |


## 3. Опубликовать выпуск Platform

```bash
gh workflow run release.yml --repo sachkov-inside/platform --ref main --field version=vN
gh run watch --repo sachkov-inside/platform "$(gh run list --repo sachkov-inside/platform -w release.yml -L 1 --json databaseId -q '.[0].databaseId')" --exit-status
gh release view vN --repo sachkov-inside/platform --json isImmutable,targetCommitish
```

Публикация ничего не меняет на сервере. Отказ `plan` означает: номер не следующий, `main` сдвинулся
или истёк `RELEASE_SETTINGS_READ_TOKEN` (продлить токен, см. [production delivery](production-delivery.md#publish-the-next-ordinal-release)).

## 4. Выложить Platform

Перед запуском назовите владельцу ожидаемый простой: сайт показывает maintenance от включения
maintenance route после preflight и pre-pull до возврата маршрутов. Скачивание образов
не входит в этот интервал при первом запуске. Если предыдущая попытка оставила maintenance,
повторный pull входит в продолжающийся простой. Оцените drain, migrations, start, readiness и reload маршрутов
по предыдущему выпуску; объём миграций может увеличить простой.

```bash
gh workflow run deploy.yml --repo sachkov-inside/platform --ref main --field operation=deploy --field version=vN
```

Выкладка скачивает backend, web и объявленный в Compose брокер в фазе `pre-pull`.
Backend и web выбираются по digest из manifest; скрипт проверяет локальные `RepoDigests`.
При нехватке диска или отказе реестра Docker завершает pull до переключения маршрутов.
Затем выкладка включает maintenance, проверяет совместимость схемы, дренирует воркеры,
применяет миграции, запускает процессы и брокер, ждёт readiness и возвращает маршруты.
Сбой до maintenance сохраняет текущие маршруты. Сбой после переключения оставляет maintenance
до успешного возврата маршрутов; фаза `journal` идёт уже после возврата.
Повторите ту же команду с той же версией. Если миграции уже изменили базу, а
выпуск не проходит, — исправление следующим номером (repair forward), не откат.

Типовые отказы и что делать:

| Отказ в логе `deploy.yml` | Причина | Действие |
|---|---|---|
| `You have reached your unauthenticated pull rate limit` | лимит Docker Hub на адрес сервера | проверить зеркало: `docker info --format '{{json .RegistryConfig.Mirrors}}'` ([подготовка VPS](production-foundation.md#что-делает-provisioning-script)), затем повторить |
| `Broken pipe`, код 255 | оборвалось SSH-соединение runner → сервер | посмотреть фазу в `/var/lib/inside/deployments/operation.json` и повторить ту же команду |
| `A deployment must select the next ordinal` | выбран не следующий номер | выложить номер после текущего из `state.json` |

## 5. Выпустить и выложить Telegram

Telegram выпускается независимо из `apps/telegram` в platform. Его
[production runbook](../../apps/telegram/docs/operations/production.md#выпуск-и-выкладка)
владеет командами корневых workflows, проверкой источника, выкладкой и откатом.
Если Telegram зависит от нового контракта Platform, сначала выложите Platform.

## 6. Проверить

С сервера (read-only) — команды раздела [Checks after rollout](production-release.md#checks-after-rollout):
процессы `healthy`, воркеры `ready`, нет `operator_attention`, у очередей есть consumers, маршруты
отвечают ожидаемыми кодами. Сторож установлен и запускается: команды
[проверки после выпуска](production-monitoring.md#проверка-после-выпуска). Затем открыть
`https://inside.sachkov.dev` и войти. Записать `free -m`:
при доступной памяти ниже 500 MiB — меры из [VPS resources](production-release.md#vps-resources).

## 7. Откат

Откат доступен 24 часа после успешной выкладки и только на предыдущую версию с той же схемой базы
(`rollback` в `state.json` не `null`):

```bash
gh workflow run deploy.yml --repo sachkov-inside/platform --ref main --field operation=rollback --field version=vN-1
```

Миграции вниз не выполняются. Если у выпуска новые миграции, откат не предлагается: исправление
выходит следующим номером. После отката следующий выпуск получает номер после отменённого
(`v7 → v8 → rollback v7 → deploy v9`) и не перезапускает отменённую версию.

Скрипт выбранного выпуска определяет порядок rollback. Выпуски до #1279 сохраняют прежний
порядок с pull под maintenance; `operation.json` сохраняет прежние ключи и допустимые фазы во всех состояниях.
Новый `pre-pull` записывается как `preflight` в `operation.json`; фактическая фаза хранится
в `operation-maintenance.json.phase`. Новый отказ до maintenance не даёт права начать rollback
после истечения 24 часов. Старый `pull`
означает уже начатое maintenance и сохраняет прежнее право на точный повтор.

## 8. Записать итог

В задаче выпуска: номер и SHA, ссылки на runs `release.yml` и `deploy.yml`, результат проверок,
`free -m`, разовые шаги на сервере, если были. Запишите фактический простой из строки
`Maintenance duration: N seconds.` и `state.json.maintenance`: начало и конец в epoch seconds,
`durationSeconds` с точностью до секунды. Начало записывается перед reload maintenance,
конец — после успешного reload обычных маршрутов; время reload входит в измерение.
В незавершённой операции `operation-maintenance.json.maintenance` хранит открытый интервал: конец `null`,
длительность на момент последней записи. Точный повтор и repair forward сохраняют начало,
пока маршруты не восстановлены. При аварийном завершении берите начало из журнала и текущий
момент: сохранённая длительность может отставать. Завершённый интервал сохраняется в `state.json`,
а `operation.json` сохраняет прежнюю закрытую форму для старых rollback-скриптов во всех состояниях.
Файл измерения содержит текущую и предыдущую записи `operation.json`: это связывает измерение
с операцией при прерывании между двумя атомарными записями. Если старый скрипт изменил журнал,
новый скрипт игнорирует измерение, которое не соответствует ни одной записи.
Сторож читает `status` и `recordedAt` из `operation.json`; Platform `production:verify` читает
`state.json`. Оба инструмента не читают `operation-maintenance.json`.
Если reload maintenance отклонён, новый интервал не сохраняется. Если `journal` упал после
возврата маршрутов, точный повтор или repair forward сохраняет завершённое измерение предыдущей попытки в
`operation-history/maintenance-<operation>-<version>-run-<id>-ended-<epoch>.json`.
`state.json.maintenance` описывает последний интервал; архив содержит файл измерения и сохраняет более ранний интервал
без включения времени, когда обычные маршруты уже работали.
Старые журналы не содержат измерения; скрипт не восстанавливает неизвестное начало.
