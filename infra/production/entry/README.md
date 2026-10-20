# Установка второго входа #1575

Ниже сохранена процедура первого этапа, когда приложение оставалось в RU. После полного переноса
актуальны [AMS runbook](../../../docs/runbooks/production-amsterdam.md), `haproxy-ams.cfg` и
`haproxy-ru-forward.cfg`. У Aeza backend приложения заменён на `147.45.166.174:8443`; файл
`haproxy-edge.cfg` ниже фиксирует исходную установку. Не применять исторический rollback к
площадке с устаревшей базой. Новые профили используют прежний unit и private-client ACL.

Процедура для существующих двух машин, не универсальный provisioning.
Архитектура, результаты и ограничения — в [runbook](../../../docs/runbooks/production-dual-entry.md).
Выполнять от root из корня проверенного checkout. На каждой машине заранее сверить адрес,
сохранить `ufw status numbered` и убедиться, что нет постороннего владельца HAProxy/443.
Данные снимков остаются на хосте; исходный код установки и отката принадлежит этому репозиторию.
Не перезаписывать существующие снимки. На origin сравнить текущий Caddyfile с версией до изменения,
чтобы не затереть более поздние хостовые правки. DNS этой процедурой не меняется.

## Общая подготовка на обеих машинах

```sh
entry_source="$PWD/infra/production/entry"
snapshot_dir=/root/inside-entry-backup-1575
apt-get install --yes --no-install-recommends haproxy
install -d -m 700 "$snapshot_dir"
install -d -m 755 /etc/inside-entry
install -m 644 "$entry_source/inside-entry.service" /etc/systemd/system/inside-entry.service
install -m 755 "$entry_source/rollback-entry.sh" /etc/inside-entry/rollback-entry.sh
systemctl disable --now haproxy.service
systemctl daemon-reload
```

## Origin 201.24.126.23

Выполнить весь блок в Bash: строгий subshell останавливается до записи при занятом lock
или ошибке проверки и освобождает lock при любом исходе.

```bash
(
set -euo pipefail
exec 9>/var/lib/inside/deployments/operation.lock
flock -n 9
test -f "$snapshot_dir/Caddyfile" || install -m 600 /etc/caddy/Caddyfile "$snapshot_dir/Caddyfile"
install -m 644 "$entry_source/haproxy-origin.cfg" /etc/inside-entry/haproxy.cfg
install -m 644 "$entry_source/non-public-clients.lst" /etc/inside-entry/non-public-clients.lst
haproxy -c -f /etc/inside-entry/haproxy.cfg
caddy validate --config infra/production/host/Caddyfile --adapter caddyfile
install -m 644 infra/production/host/Caddyfile /etc/caddy/Caddyfile
caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
ufw allow from 185.125.101.90 to any port 8443 proto tcp comment inside-entry-1575
systemctl enable --now inside-entry.service
)
```

## Aeza 185.125.101.90

Первое переключение освобождает 443 у Nginx; возможен короткий перерыв IP-службы.
Перед ним подготовить откат и ограниченный по времени внешний аварийный запуск.
После успешной проверки здоровья остановить аварийный таймер, иначе он вернёт старую схему.
Пример перед переключением и после проверки:

```sh
systemd-run --unit=inside-entry-safety --on-active=10m \
  /etc/inside-entry/rollback-entry.sh edge "$snapshot_dir"
# Только после успешных живых проверок:
systemctl stop inside-entry-safety.timer
```

```sh
test -f "$snapshot_dir/xrayebator-sub" || \
  install -m 600 /etc/nginx/sites-available/xrayebator-sub "$snapshot_dir/xrayebator-sub"
install -m 644 "$entry_source/haproxy-edge.cfg" /etc/inside-entry/haproxy.cfg
haproxy -c -f /etc/inside-entry/haproxy.cfg
patch --batch --output=/etc/inside-entry/nginx-subscription.candidate \
  "$snapshot_dir/xrayebator-sub" < "$entry_source/nginx-subscription.patch"
install -m 644 /etc/inside-entry/nginx-subscription.candidate /etc/nginx/sites-available/xrayebator-sub
install -m 644 "$entry_source/nginx-http.conf" /etc/nginx/conf.d/inside-entry-http.conf
nginx -t
systemctl reload nginx
ufw --force delete limit 443/tcp
ufw --force delete limit 80/tcp
ufw allow 443/tcp comment inside-public-entry-1575
ufw allow 80/tcp comment inside-public-entry-1575
systemctl enable --now inside-entry.service
```

Проверить живые ответы по runbook, IP посетителя, удаление marker и действующую подписку;
сверить `ss -ntl`, UFW и `systemctl is-enabled inside-entry`. Записать SHA-256 файлов и commit.
Переход Nginx на loopback не меняет webroot или hook обновления существующего IP-сертификата.
После правки конфигурации HAProxy использовать `haproxy -c`, затем `systemctl reload inside-entry`.
Не перезапускать Xray, приложение или базу ради этой установки.

## Откат

```sh
# На соответствующей машине; сначала вернуть DNS, если он уже направляет посетителей на Aeza.
bash infra/production/entry/rollback-entry.sh edge /root/inside-entry-backup-1575
bash infra/production/entry/rollback-entry.sh origin /root/inside-entry-backup-1575
```

Вызывать только роль своей машины. Снимки содержат прежний Caddyfile либо Nginx server block;
остальные службы не восстанавливаются из общего образа. Код `rollback-entry.sh` воспроизводит
проверенную последовательность #1575; `caddy validate` и `nginx -t` добавлены перед остановкой receiver.
При потере только хостовой копии скрипта взять её из этого checkout. При потере самого снимка
сначала восстановить его из резервной копии; не угадывать чужую конфигурацию Nginx.
