# Подготовка production VPS

Этот runbook описывает комплект, подготовленный в #239 для будущей одноразовой настройки
production VPS. Сама VPS в рамках #239 не изменяется: owner сначала переустановит её, а затем
применит комплект в owner-gated задаче #244. Обычные release и deploy не должны повторно
provision-ить хост.

Не запускайте provisioning script на текущем сервере до clean reinstall и явного GO в #244. Он
устанавливает системные пакеты, включает firewall и сервисы и занимает выделенные Platform пути.

## Что лежит в комплекте

| Путь | Назначение |
|---|---|
| `infra/production/host/provision-host.sh` | Единственная команда первичной подготовки чистой Ubuntu VPS |
| `infra/production/host/Caddyfile` | Безопасный Caddy baseline без публичных application routes |
| `config/production/foundation/*.env.example` | Шаблоны конфигурации и секретов без реальных значений |
| `infra/production/database/` | Долгоживущий PostgreSQL 18 + pgBackRest, backup timers и restore entrypoint |
| `infra/production/logto/` | Отдельный долгоживущий Logto stack |
| `infra/production/secrets/README.md` | Подготовка age recipients и доставка env через SOPS |

Application Compose, release artifacts и регулярный deploy принадлежат #236, #235 и #243. Этот
комплект не добавляет GitHub Actions jobs, не создаёт тестовый VPS и не содержит production
credentials.

## Что делает provisioning script

Команда рассчитана на чистую Ubuntu 24.04:

```bash
sudo infra/production/host/provision-host.sh
```

Она:

1. Проверяет запуск от `root`, Ubuntu 24.04 и отсутствие чужих данных в managed paths.
2. Устанавливает из Ubuntu repositories Docker Engine, Compose v2, Caddy, OpenSSH, UFW и age.
3. Создаёт заблокированного по паролю пользователя `inside-deploy`, но не выдаёт ему Docker или
   `sudo` permissions. Ограниченный SSH command добавит #243 вместе с deploy protocol.
4. Создаёт `/etc/inside`, `/opt/inside/foundation`, `/srv/inside` и `/var/lib/inside` с базовыми
   permissions.
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
3. Скопировать env templates и заменить все placeholders реальными значениями:

   ```bash
   for template in config/production/foundation/*.env.example; do
     target="/etc/inside/foundation/$(basename "${template%.example}")"
     sudo install -m 600 -o root -g root "$template" "$target"
   done
   ```

   `compose.env` — единый источник имён Compose projects, shared database network, loopback port и
   активного PostgreSQL volume. Остальные `.env` файлы передаются только внутрь контейнеров.

4. Подготовить host/offline age recipients и доставить secrets по
   [инструкции](../../infra/production/secrets/README.md). Файлы `postgres.env`,
   `logto-database.env` и `pgbackrest.env` должны быть заполнены только через защищённый канал.
5. До запуска контейнеров проверить Compose templates без вывода раскрытой конфигурации:

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

6. Создать отдельный backup bucket/service account и запустить database stack:

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

7. После успешной database check запустить отдельный Logto stack:

   ```bash
   sudo docker compose \
     --env-file /etc/inside/foundation/compose.env \
     --file /opt/inside/foundation/infra/production/logto/compose.yaml \
     up --detach --build --wait
   ```

   Logto опубликован только на `127.0.0.1:3301`. Публичный `auth.sachkov.dev`, TLS и отсутствие
   Logto Console проверяются в #244 после настройки DNS/Caddy.

8. Выполнить первый full backup и только после успешных `stanza-create`, `check` и backup включить
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
  up --detach --wait postgres
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

До возврата application traffic отдельно проверьте обе базы (`inside` и `logto`) и WAL archiving.
Старый volume остаётся отдельным и удаляется только по последующему owner decision. Credentialed
recovery proof проводится на реальной подготовленной инфраструктуре в #244, а не на каждом pull
request.
