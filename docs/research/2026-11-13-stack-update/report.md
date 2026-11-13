# Обновление стека Inside Platform, #2117

Работа продолжается. Этот отчёт фиксирует проверенные факты и ещё не выполненные этапы.
BASE_SHA: `e514406f9ec774b6ede2524b9638480617c44a24` (origin/main при начале).
Ветка `chore/2117-update-stack`, отдельный worktree `2117-update-entire-stack`.

## Зависимости

`packages.json` содержит все отслеживаемые package.json, исходные и выбранные версии.
Источники: npm registry metadata, `pnpm -r outdated --format json`, `pnpm audit --json`.
Prisma latest указывает на 8.0.0-rc.33. Выбран стабильный 7.10.1.
Node 26.10.0 → 26.13.1, pnpm 11.27.1 → 12.18.0. Corepack 0.36.0 остаётся актуальным.
Vitest 4.1.11 → 5.1.0, Storybook 10.6.1 → 10.6.7. Частные патчи перенесены.
Строгие peer dependencies, quarantine 1440 минут и политика запуска build scripts сохранены.

| Аудит | critical | high | moderate | low |
|---|---|---|---|---|
| До | 6 | 14 | 21 | 5 |
| Кандидат, все зависимости | 0 | 0 | 0 | 1 |
| Кандидат, production-зависимости | 0 | 0 | 0 | 0 |

Остаётся [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4),
`deepmerge@4.3.1` через shadcn CLI. Исправленной версии аудит не называет.
CLI не входит в production. Это не заключение об отсутствии уязвимостей в контейнерах.

## Production baseline, только чтение

13.11.2026, около 16:28 UTC: Ubuntu 26.04.1 LTS, ядро 7.0.0-43-generic,
`dpkg --audit` без вывода, 12 контейнеров healthy, sachkov.dev HTTP 200.
Docker 29.1.3, Caddy 2.11.4, PostgreSQL 18.4, pgBackRest 2.59.3, RabbitMQ 4.2.4,
Logto 1.44.0-inside.15. Последний плановый incr backup завершён в 12:02:42 UTC,
label `20261108-010858F_20261113-120227I`, 315.4 MB. Восстановление этой копии ещё не проверено.
По кешу apt доступны distro-info, python3-distro-info, qemu-guest-agent.
Память: 3910 MB всего, 1570 MB available. Записей на production эта сессия не выполняла.
Предыдущая сессия обновила ОС без production lock. Это не соблюдение процесса.

## Образы и инфраструктура

`image-targets.json` содержит фактические OCI indexes из registry, включая платформы.

| Компонент | Сейчас | Стабильный кандидат | Состояние |
|---|---|---|---|
| PostgreSQL | 18.4 | 18.7 | Нужны зеркало, сборка с pgBackRest, backup/recovery proof |
| pgBackRest | 2.59.3 | 2.60.0 | Проверить новое поведение checksum-page-error на restore |
| Logto | 1.44.0-inside.15 | 1.46.0 | Пробная сборка не проходит патч sentinel-activities.ts, hunk 3 |
| RabbitMQ | 4.2.4 | 4.4.0 | Проверить промежуточное обновление 4.3 и feature flags; формат .sqs не допускает downgrade |
| Caddy | 2.11.4 | 2.11.9 | Нужны новый .deb checksum, проверка конфигурации и rollback |
| Mailpit | 1.30.6 | 1.33.1 | Только локальный стенд; обновление ещё не применено |
| RustFS | 1.0.0 | 1.0.5 | Только локальный стенд; обновление ещё не применено |

Источники: [Node security release](https://nodejs.org/en/blog/vulnerability/november-2026-security-releases),
[PostgreSQL 18.7](https://www.postgresql.org/docs/release/18.7/),
[Logto releases](https://github.com/logto-io/logto/releases),
[RabbitMQ 4.4.0](https://github.com/rabbitmq/rabbitmq-server/releases/tag/v4.4.0),
[pgBackRest 2.60.0](https://github.com/pgbackrest/pgbackrest/releases/tag/release/2.60.0).

## Проверки и доставка

`worktree:prepare --task 2117` выполнен. Тяжёлые проверки используют проектный heavy-check.
Общий локальный стенд не менялся. Первые проверки выявили устаревшие эталонные pins в тестах;
они обновлены вместе с конфигурацией. Полные проверки, независимые review и CI ещё не завершены.
Существуют пересекающиеся Dependabot PR #1544 (Node) и #1991 (Actions), они не изменялись.
Merge, публикация зеркал, релиз и deployment требуют решения владельца по проектному gate.
Новый Node index пока отсутствует в GHCR. Публикация зеркала нужна до Docker-проверок CI.
