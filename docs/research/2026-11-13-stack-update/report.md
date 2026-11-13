# Обновление стека Inside Platform, #2117

Работа продолжается. В production изменения этой сессии не применены.
BASE_SHA: `e514406f9ec774b6ede2524b9638480617c44a24`, актуальный origin/main при начале работы.
Worktree `2117-update-entire-stack`, ветка `chore/2117-update-stack`, основной PR #2136.

## Зависимости и источники

[inputs.json](inputs.json) перечисляет Docker/Compose/CI inputs до и после по файлам.
[packages.json](packages.json) перечисляет все отслеживаемые package.json, включая приложения,
общие пакеты и учебный fixture. `before` прочитан из BASE_SHA, `candidate` из рабочего дерева.
Источники выбранных версий: npm registry dist-tags, даты публикации, полный рекурсивный
`pnpm outdated`, audit и разрешённый граф lockfile. Корневой outdated отдельно не использовался
как полный список приложений. После обновления прямых зависимостей обновлён транзитивный граф.

| Компонент | До | Кандидат |
|---|---|---|
| Node | 26.10.0 | 26.13.1 |
| pnpm workspace | 11.27.1 | 12.18.0 |
| Corepack | 0.36.0 | 0.36.0, актуальный стабильный |
| npm в сборочных образах | из базового образа | 12.2.2 |
| Vitest | 4.1.11 | 5.1.0 |
| Storybook | 10.6.1 | 10.6.7 |
| Prisma | 7.10.0 | 7.10.1 |
| Учебный Codex CLI | 0.163.0 | 0.169.0 |

Prisma latest указывает на 8.0.0-rc.33, поэтому выбран стабильный 7.10.1.
Частные патчи Storybook, Vitest и Testcontainers перенесены на новые версии.
Строгие peer dependencies, quarantine 1440 минут и политика build scripts сохранены.
Сборочные npm и esbuild не остаются в соответствующих финальных слоях, где они не нужны.
Новые axe-проверки выявили несовпадения видимых подписей и имён для экранного диктора.
Исправлены подписи и связанные проверки без отключения правил доступности.

## Безопасность

| Аудит pnpm | critical | high | moderate | low |
|---|---|---|---|---|
| Исходный граф | 6 | 14 | 21 | 5 |
| Кандидат, все зависимости | 0 | 0 | 0 | 1 |
| Кандидат, production-зависимости | 0 | 0 | 0 | 0 |

`deepmerge@4.3.1` остаётся в отчёте по версии. Опубликованного исправления
[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) нет.
Добавлен частный патч, который исключает `__proto__` из клонирования target и слияния source.
Регрессионная проверка сначала воспроизвела подмену прототипа, затем прошла с патчем.
Это исправление проверяется отдельно от метаданных audit, исходная версия не переименована.

Logto имеет собственный граф. Обновлены доступные исправленные версии его зависимостей,
пересобираются core, account, console и experience. Частные исправления Router 6, Zod 3 и
deepmerge, их источники, ограничения и условия удаления записаны в
[Logto security maintenance](../../../infra/identity/logto/security/README.md).
Принудительный переход CLI на Zod 4 нарушил peer-контракт `@withtyped/server` и совместимость
типов схем. Вместо обхода этого ограничения перенесено официальное исправление ограниченных
коллекций. Неограниченные коллекции этим патчем не получают нового общего лимита.

Trivy образа PostgreSQL 18.7/pgBackRest 2.60.0 после пересборки Gosu не нашёл известных
уязвимостей. Это результат сканирования конкретного локального образа, не обещание отсутствия
всех уязвимостей. Проверки остальных финальных образов продолжаются. Официальный RabbitMQ
4.4.0 содержит исправимую находку zlib; локальный образ обновляет пакет. Проверка официального
Caddy .deb 2.11.9 отдельно подтвердила 7 findings (2 high, 3 medium, 2 unknown),
[состав и checksum](caddy-security.json). В нём Go 1.27.3 и x/net 0.60.0. Приписывать ему
нулевой результат сканирования контейнера или считать все эти пути достижимыми нельзя. Финальный production
образ RabbitMQ и Caddy требуют отдельного решения по оставшимся upstream findings до выпуска.

## Production baseline, только чтение

13.11.2026, около 16:28 UTC: Ubuntu 26.04.1 LTS, ядро 7.0.0-43-generic,
`dpkg --audit` без вывода, 12 контейнеров healthy, sachkov.dev HTTP 200.
Platform v79, source `915e265e487e597dad753a9e267ab206ac35dafe`.
Telegram v54, source `c064917cd2aaa4089f511861ea0a00499c26ef1e`.
PostgreSQL 18.4, pgBackRest 2.59.3, RabbitMQ 4.2.4, Logto 1.44.0-inside.15.
Последний проверенный плановый incr backup завершён в 12:02:42 UTC,
label `20261108-010858F_20261113-120227I`, 315.4 MB. Восстановление этой копии ещё не проверено.

Полный read-only verify не был зелёным: Platform сообщил RestartCount=1 у notifications-worker
после перезагрузки, Telegram сообщил сетевые ошибки в startup logs. Контейнеры при этом healthy.
Смежные исправления принадлежат #2130/#2134 и PR #2135, эта работа их не дублирует.

Повторная проверка владельцев пакетов в 17:43 UTC:

| Пакет | Установлен | Кандидат из настроенного apt |
|---|---|---|
| docker.io | 29.1.3-0ubuntu4.1 | тот же |
| containerd | 2.2.2-0ubuntu1.2 | тот же |
| runc | 1.4.0-0ubuntu1 | тот же |
| caddy | 2.11.4 | подготовлен официальный 2.11.9 |

Docker runtime принадлежит пакетам Ubuntu, docker-ce не установлен. Другой канал поставки
не подменяет фактического владельца пакета. По кешу apt доступны distro-info и python3-distro-info.
`qemu-guest-agent` находится на hold; его доступное обновление не разрешает снять hold.
`reboot-required` отсутствует. Память при baseline: 3910 MB всего, 1570 MB available, без swap.

Эта сессия не выполняла записей на production, включая apt refresh, backup и restart.
Предыдущая сессия обновила 28 пакетов ОС и перезагрузила сервер без production lock.
Это процессная ошибка, задним числом lock ей не приписывается. Перед каждой новой записью
обязателен production lock и соответствующее разрешение владельца.

## Образы и инфраструктура

[image-targets.json](image-targets.json) сохраняет прочитанные OCI indexes и платформы.
[mirror-packet.json](mirror-packet.json) фиксирует пять новых официальных inputs подготовительного
PR #2137. Он прошёл CI Gate на head `062de70910aa3ef2da0d658411b5dbaacd85fe6b` и независимые
Standards, Spec, security reviews. Публикация ожидает разрешения владельца.

| Компонент | До | Кандидат и совместимость |
|---|---|---|
| PostgreSQL foundation | 18.4 | 18.7, тот же major и каталог данных |
| pgBackRest | 2.59.3 | 2.60.0, source/checksum закреплены, native restore proof обязателен |
| Gosu внутри PostgreSQL | 1.19 | 1.20, исходники закреплены, пересобран Go 1.27.4 и x/sys 0.44.0 |
| Logto | 1.44.0-inside.15 | 1.46.0-inside.16, все частные патчи сохранены |
| Изолированная БД Logto proof/стенда | PostgreSQL 17.6 | 17.12, сохраняется major существующего volume |
| RabbitMQ | 4.2.4 | 4.4.0, требуется проверенный промежуточный переход через 4.3 и feature flags |
| Caddy host/smoke | 2.11.4 | 2.11.9, официальный .deb и checksum закреплены |
| Mailpit стенда | 1.30.6 | 1.33.1 |
| RustFS стенда | 1.0.0 | 1.0.5 |
| Telegram Node base | Debian bookworm | общий Alpine 3.24, проверка совместимости финального образа обязательна |
| pnpm/action-setup | прежний pinned commit | v6.1.1, release commit SHA |
| docker/login-action | прежний pinned commit | v4.8.0, release commit SHA |
| jactionlint / betterleaks | прежние quality pins | 2.6.0 / 1.10.1, release assets с checksum |

[PostgreSQL 19](https://www.postgresql.org/about/news/postgresql-187-1712-1616-1520-1425-and-19-rc-2-released-3442/)
на дату аудита ещё RC2, его не выбираем как стабильный выпуск. PostgreSQL 17.12 остаётся
поддерживаемым minor для отдельного существующего Logto volume. Перенос его major нельзя
выполнить сменой тега без dump/restore. Рабочий volume общего стенда не менялся.
RabbitMQ 4.4 меняет формат .sqs, поэтому возврат тега не считается безопасным rollback.

Источники: [Node security release](https://nodejs.org/en/blog/vulnerability/november-2026-security-releases),
[PostgreSQL 18.7](https://www.postgresql.org/docs/release/18.7/),
[Logto releases](https://github.com/logto-io/logto/releases),
[RabbitMQ 4.4.0](https://github.com/rabbitmq/rabbitmq-server/releases/tag/v4.4.0),
[pgBackRest 2.60.0](https://github.com/pgbackrest/pgbackrest/releases/tag/release/2.60.0).

## Проверки и доставка

`worktree:prepare --task 2117` выполнен. Тяжёлые проверки используют проектный heavy-check.
Общий локальный стенд не резервировался и не менялся. Исходные полные unit/contracts проверки
прошли; новые патчи и изменённые inputs получают повторные адресные проверки. Полная проверка интерфейса прошла: Storybook 1295/1295, Telegram widgets 269/269,
браузерные движки 92 passed и 1 штатный skip, Storybook build завершён. Основной E2E-набор
прошёл, 166 passed и 14 штатных skips. Навигация, финальные сборки и CI ещё выполняются.

Для PostgreSQL добавлен native proof чтения текущих production backups (18.4/2.59.3) новым
writer/restore (18.7/2.60.0) на обеих архитектурах. Исторический proof 18.4/2.57 сохраняется.
Сам harness продолжает отказывать на общем локальном daemon. Backup/restore на production
без lock и разрешения не запускается. Полный account-email proof прошёл на первом собранном
кандидате Logto; после заморозки обновлённого security-графа он выполняется повторно.

Пересекающиеся Dependabot PR #1544 (Node) и #1991 (Actions) оставлены без изменений.
Первый CI #2136 не является итоговым доказательством: он выявил неопубликованный Node mirror
и устаревшие эталоны pins. Merge, публикация, release и deployment сохраняют owner gates.
