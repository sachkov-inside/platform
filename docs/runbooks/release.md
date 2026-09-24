# Выпуск следующей версии

Один проход от `main` до проверенного production для Platform и Telegram. Подробности каждого шага
живут в [production delivery](production-delivery.md) (выкладка, откат, состояние),
[production release](production-release.md) (конфигурация, брокер, проверки после выкладки) и
`docs/operations/production.md` Telegram. Процесс проверен в
[Workspace #184](https://github.com/sachkov-inside/workspace/issues/184): первый выпуск v7, второй
обычный выпуск, откат и возврат вперёд.

Выпуск и выкладка требуют разрешения владельца (`WORKFLOW.md`, Owner gates). Всё ниже, кроме
шага 2, выполняется без входа на сервер.

## 1. Что выпускаем

```bash
git fetch origin
current=$(gh release view --json tagName -q .tagName)            # последняя опубликованная, например v8
git log --oneline "$current"..origin/main
```

Номер следующего выпуска — `current` + 1. Выпускается ровно текущий `main`; CI выпуска повторяет
проверки PR.

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
| `infra/production/database/*`, `infra/production/logto/*`, `infra/identity/logto/*` | Обновить foundation по [подготовке VPS](production-foundation.md#порядок-применения-в-244): свежий checkout в `/opt/inside/foundation`, `docker compose ... up --detach --build --wait`. Если Dockerfile Logto меняет только непроизводственные файлы (README, proof), пересборка не нужна |
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

```bash
gh workflow run deploy.yml --repo sachkov-inside/platform --ref main --field operation=deploy --field version=vN
```

Выкладка включает maintenance, скачивает образы, дренирует воркеры, применяет миграции, запускает
девять процессов и брокер, ждёт readiness и возвращает маршруты. Сбой оставляет maintenance и
записывает фазу: повторите ту же команду с той же версией. Если миграции уже изменили базу, а
выпуск не проходит, — исправление следующим номером (repair forward), не откат.

## 5. Выпустить и выложить Telegram

Только если в `inside-telegram` есть изменения с прошлого выпуска. Путь тот же:
`release.yml` → `deploy.yml` в репозитории Telegram, порядок и проверки — в его
`docs/operations/production.md`, раздел «Выпуск и выкладка». Platform выкладывается первым, если
новый Telegram зависит от нового контракта Platform.

## 6. Проверить

С сервера (read-only) — команды раздела [Checks after rollout](production-release.md#checks-after-rollout):
процессы `healthy`, воркеры `ready`, нет `operator_attention`, у очередей есть consumers, маршруты
отвечают ожидаемыми кодами. Затем открыть `https://inside.sachkov.dev` и войти. Записать `free -m`:
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

## 8. Записать итог

В задаче выпуска: номер и SHA, ссылки на runs `release.yml` и `deploy.yml`, результат проверок,
`free -m`, разовые шаги на сервере, если были.
