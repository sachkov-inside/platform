# Подготовка production VPS

Этот runbook описывает комплект, подготовленный в #239 и дополненный ограниченным deployment
interface в #243, для будущей одноразовой настройки production VPS. Сама VPS в этих задачах не
изменяется: owner сначала переустановит её, а затем применит комплект в owner-gated задаче #244.
Обычные release и deploy не должны повторно provision-ить хост.

Не запускайте provisioning script на текущем сервере до clean reinstall и явного GO в #244. Он
устанавливает системные пакеты, включает firewall и сервисы и занимает выделенные Platform пути.

## Production-сервер

Владелец подтвердил сервер 5 сентября 2026 года в задаче
[#244](https://github.com/sachkov-inside/platform/issues/244):

| Параметр | Значение |
|---|---|
| Провайдер | Timeweb Cloud |
| Имя в панели | Inside App |
| IPv4 | `201.24.126.23` |
| Административный доступ | `ssh root@201.24.126.23`, по SSH-ключу |
| Выбранная ОС после переустановки | Ubuntu 26.04 LTS |
| Публичные домены | `inside.sachkov.dev`, `auth.sachkov.dev` |

Адрес определяет целевой сервер, но не доказывает готовность приложения. Фактическую версию ОС,
ключ хоста, DNS/TLS и состояние сервисов проверяют перед настройкой. Секреты и приватные SSH-ключи
в этом документе не хранятся.

## Что лежит в комплекте

| Путь | Назначение |
|---|---|
| `infra/production/host/provision-host.sh` | Единственная команда первичной подготовки чистой Ubuntu VPS |
| `infra/production/host/Caddyfile` | Безопасный Caddy baseline без публичных application routes |
| `infra/production/host/inside-deploy` | Root-owned gateway для двух допустимых forced SSH commands |
| `infra/production/host/configure-deploy-key.sh` | Идемпотентная установка одного ограниченного deployment key |
| `config/production/foundation/*.env.example` | Шаблоны конфигурации и секретов без реальных значений |
| `infra/production/database/` | Долгоживущий PostgreSQL 18 + pgBackRest, backup timers и restore entrypoint |
| `infra/production/logto/` | Отдельный долгоживущий Logto stack |
| `infra/production/secrets/README.md` | Подготовка age recipients и доставка env через SOPS |

Application Compose, release artifacts и регулярный deploy принадлежат #236, #235 и #243. Этот
комплект не добавляет GitHub Actions jobs, не создаёт тестовый VPS и не содержит production
credentials.

## Что делает provisioning script

Команда рассчитана на чистую Ubuntu 24.04 или 26.04 LTS. Для production выбран выпуск 26.04 LTS:

```bash
sudo infra/production/host/provision-host.sh
```

Она:

1. Проверяет запуск от `root`, Ubuntu 24.04 или 26.04 LTS и отсутствие чужих данных в managed paths.
2. Устанавливает из Ubuntu repositories Docker Engine, Compose v2, Buildx, Caddy, OpenSSH, UFW, age и
   `util-linux` с командой `flock`, использующей блокировку ядра.
3. Создаёт заблокированного по паролю пользователя `inside-deploy`. Его sudoers rule разрешает
   только root-owned `inside-deploy` gateway и сохраняет только `SSH_ORIGINAL_COMMAND`.
4. Создаёт отдельные root-owned пути для server configuration, staged Releases и deployment
   journal; устанавливает `jq`, gateway и установщик ключа.
5. Копирует долгоживущие database/Logto definitions в `/opt/inside/foundation`, устанавливает
   Caddy baseline, backup command и systemd units.
6. Включает Docker, SSH, Caddy и UFW; наружу разрешены только TCP 22, 80 и 443.

Скрипт не определяет размер VPS, не создаёт SSH key, DNS, buckets или credentials, не запускает
PostgreSQL/Logto и не включает backup timers. Эти решения и действия выполняются в #244. После
первого успешного запуска marker `/etc/inside/host-provisioned` позволяет безопасно повторить
команду для обновления только принадлежащих комплекту файлов.

## Порядок применения в #244

После owner-approved clean OS reinstall:

1. Доставить на VPS проверенный checkout, содержащий merged #239, и прочитать diff скрипта.
2. Запустить `sudo infra/production/host/provision-host.sh`.
3. Создать отдельный Ed25519 key для GitHub Environment, доставить только public key по уже
   подтверждённому административному каналу и установить его:

   ```bash
   sudo /usr/local/libexec/inside/configure-deploy-key /root/inside-deploy.pub
   sudo -u inside-deploy ssh-keygen -l -f /home/inside-deploy/.ssh/authorized_keys
   ```

   `authorized_keys` содержит `restrict` и forced command. Ключ не даёт shell, forwarding, PTY или
   прямой Docker/sudo interface. Private key, точная host key строка и hostname переходят только в
   secrets `PRODUCTION_SSH_PRIVATE_KEY`, `PRODUCTION_SSH_HOST_KEYS` и `PRODUCTION_SSH_HOST` будущего
   GitHub Environment `Production`.

4. Скопировать application env templates, кроме генерируемого release identity, и заменить все
   placeholders реальными значениями:

   ```bash
   for template in config/compose/production/*.env.example; do
     [[ "$(basename "$template")" == runtime.env.example ]] && continue
     target="/etc/inside/runtime/$(basename "${template%.example}")"
     sudo install -m 600 -o root -g root "$template" "$target"
   done
   ```

5. Скопировать foundation env templates и заменить все placeholders реальными значениями:

   ```bash
   for template in config/production/foundation/*.env.example; do
     target="/etc/inside/foundation/$(basename "${template%.example}")"
     sudo install -m 600 -o root -g root "$template" "$target"
   done
   ```

   `compose.env` — единый источник имён Compose projects, shared database network, loopback port и
   активного PostgreSQL volume. Остальные `.env` файлы передаются только внутрь контейнеров.

6. Подготовить host/offline age recipients и доставить secrets по
   [инструкции](../../infra/production/secrets/README.md). Файлы `postgres.env`,
   `logto-database.env` и `pgbackrest.env` должны быть заполнены только через защищённый канал.
7. До запуска контейнеров проверить Compose templates без вывода раскрытой конфигурации:

   ```bash
   sudo docker compose \
     --env-file /etc/inside/foundation/compose.env \
     --file /opt/inside/foundation/infra/production/database/compose.yaml \
     config --quiet
   sudo docker compose \
     --env-file /etc/inside/foundation/compose.env \
     --file /opt/inside/foundation/infra/production/logto/compose.yaml \
     config --quiet
   ```

8. Создать отдельный backup bucket/service account и запустить database stack:

   ```bash
   sudo docker compose \
     --env-file /etc/inside/foundation/compose.env \
     --file /opt/inside/foundation/infra/production/database/compose.yaml \
     up --detach --build --wait postgres
   sudo docker compose \
     --env-file /etc/inside/foundation/compose.env \
     --file /opt/inside/foundation/infra/production/database/compose.yaml \
     --profile operations run --rm pgbackrest \
     --stanza=production stanza-create
   sudo docker compose \
     --env-file /etc/inside/foundation/compose.env \
     --file /opt/inside/foundation/infra/production/database/compose.yaml \
     --profile operations run --rm pgbackrest \
     --stanza=production check
   ```

9. После успешной database check запустить отдельный Logto stack:

   ```bash
   sudo docker compose \
     --env-file /etc/inside/foundation/compose.env \
     --file /opt/inside/foundation/infra/production/logto/compose.yaml \
     up --detach --build --wait
   ```

   Logto опубликован только на `127.0.0.1:3301`. Публичный `auth.sachkov.dev`, TLS и отсутствие
   Logto Console проверяются в #244 после настройки DNS/Caddy.

10. Выполнить первый full backup и только после успешных `stanza-create`, `check` и backup включить
   расписание:

   ```bash
   sudo systemctl start inside-pgbackrest-backup@full.service
   sudo systemctl enable --now \
     inside-pgbackrest-full.timer \
     inside-pgbackrest-diff.timer \
     inside-pgbackrest-incr.timer
   systemctl list-timers 'inside-pgbackrest-*'
   ```

Расписание хранится в UTC: full — каждое воскресенье, differential — в остальные дни,
incremental — каждые шесть часов. WAL архивируется непрерывно; pgBackRest хранит четыре full
backup. После этого #243 может доставить application release, а #244 — выполнить первый cutover.

## Восстановление базы

Restore — ручная аварийная операция, а не CI job. Сначала переведите application в maintenance
через механизм #243 и остановите Logto и PostgreSQL:

```bash
sudo docker compose \
  --env-file /etc/inside/foundation/compose.env \
  --file /opt/inside/foundation/infra/production/logto/compose.yaml \
  down
sudo docker compose \
  --env-file /etc/inside/foundation/compose.env \
  --file /opt/inside/foundation/infra/production/database/compose.yaml \
  stop postgres
sudo grep '^FOUNDATION_POSTGRES_VOLUME=' /etc/inside/foundation/compose.env
```

Последняя команда фиксирует имя повреждённого volume в incident notes; не удаляйте его. Создайте
новое уникальное имя с обязательным recovery prefix и переключите на него `compose.env`:

```bash
recovery_volume="inside-production-postgres-data-recovery-$(date -u +%Y%m%d%H%M%S)"
sudo sed -i \
  "s/^FOUNDATION_POSTGRES_VOLUME=.*/FOUNDATION_POSTGRES_VOLUME=$recovery_volume/" \
  /etc/inside/foundation/compose.env
sudo docker volume create "$recovery_volume"
```

Теперь restore service подключает только новый volume. Его entrypoint откажется работать, если
имя не начинается с `inside-production-postgres-data-recovery-`. Выберите target по pgBackRest
metadata и выполните restore, например до указанного времени:

```bash
sudo docker compose \
  --env-file /etc/inside/foundation/compose.env \
  --file /opt/inside/foundation/infra/production/database/compose.yaml \
  --profile operations run --rm restore \
  --stanza=production \
  --type=time \
  --target='YYYY-MM-DD HH:MM:SS.US+00' \
  --target-action=promote \
  restore
```

Запустите PostgreSQL с тем же `compose.env`, проверьте repository и сделайте новый full backup:

```bash
sudo docker compose \
  --env-file /etc/inside/foundation/compose.env \
  --file /opt/inside/foundation/infra/production/database/compose.yaml \
  up --detach --force-recreate --wait postgres
sudo docker compose \
  --env-file /etc/inside/foundation/compose.env \
  --file /opt/inside/foundation/infra/production/database/compose.yaml \
  --profile operations run --rm pgbackrest \
  --stanza=production check
sudo systemctl start inside-pgbackrest-backup@full.service
sudo docker compose \
  --env-file /etc/inside/foundation/compose.env \
  --file /opt/inside/foundation/infra/production/logto/compose.yaml \
  up --detach --wait
```

`--force-recreate` обязателен: старый stopped container всё ещё подключён к повреждённому volume и
не должен быть запущен повторно. До возврата application traffic отдельно проверьте обе базы
(`inside` и `logto`) и WAL archiving. Старый volume остаётся отдельным и удаляется только по
последующему owner decision. Credentialed recovery proof проводится на реальной подготовленной
инфраструктуре в #244, а не на каждом pull request.

## Восстановление после потери VPS

Если потерян весь хост, repository pgBackRest в bucket остаётся источником данных. Порядок такой:

1. Переустановить VPS и после явного owner GO выполнить provisioning из проверенного checkout.
2. Offline age identity расшифровать сохранённые SOPS secrets. Создать identity нового хоста,
   добавить его recipient и заново зашифровать те же значения для host + offline recipients.
3. Установить расшифрованные env в `/etc/inside/foundation` с owner `root:root` и mode `0600`.
   Пароли нельзя генерировать заново до restore: восстановленный PostgreSQL содержит старые роли.
4. В `compose.env` сразу указать новое имя вида
   `inside-production-postgres-data-recovery-<UTC timestamp>` и создать этот Docker volume.
5. Не запускать обычный первичный путь `postgres` + `stanza-create`: stanza уже существует в
   backup repository. Сначала выполнить `restore` в новый recovery volume командой из раздела выше.
6. Запустить PostgreSQL с `--force-recreate --wait`, выполнить `pgbackrest check` и проверить базы
   `inside` и `logto`, роли и WAL archiving.
7. Запустить Logto, затем application release через #243 и только после health proof вернуть
   traffic.
8. Выполнить новый full backup. Повреждённый/старый volume и старые credentials удалять только по
   отдельному owner decision.

Этот сценарий использует тот же bucket, stanza `production`, Compose network и recovery guard, что
и обычный restore; отличие только в том, что Docker host и host age identity создаются заново.
