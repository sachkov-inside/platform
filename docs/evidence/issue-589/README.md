# Сквозной набор вне обязательного гейта: #589

## Измеренная цена и выбор

Измерены три успешных прогона `Nightly full-stack smoke` на GitHub-hosted `ubuntu-24.04`.
Источник времени — `startedAt` и `completedAt` шага `Run full-stack smoke` из
`gh run view RUN_ID --json jobs`. Время job включает установку, инфраструктуру и уборку;
время шага включает сборку web, пробы API/MCP и браузерные сценарии.

| Дата UTC | Прогон | SHA | Шаг `smoke:fullstack` | Полный job |
|---|---|---|---|---|
| 01.10.2026 | [36912387184](https://github.com/sachkov-inside/platform/actions/runs/36912387184) | `1c29928f9d1506a7e36e3fdc531d2c7d346f5930` | 19:15:30–19:24:35, **9:05** | 19:11:03–19:24:38, **13:35** |
| 05.10.2026 | [37354045974](https://github.com/sachkov-inside/platform/actions/runs/37354045974) | `75c2a5ff418669ff958350a47b37b97d988f9dc9` | 18:12:23–18:23:54, **11:31** | 18:11:18–18:23:57, **12:39** |
| 06.10.2026 | [37430639885](https://github.com/sachkov-inside/platform/actions/runs/37430639885) | `43a27aa9c2f9ac6bcb57eaf2e81e8f28365f8e14` | 07:36:51–07:48:38, **11:47** | 07:35:46–07:48:41, **12:55** |

Медиана шага — **11:31**, диапазон — **9:05–11:47**. Это три наблюдения, а не верхняя граница времени.

| Способ | Цена и покрытие | Решение |
|---|---|---|
| Весь набор в обязательном гейте | Дополнительный полный job на каждом PR и в merge queue; наблюдаемые jobs занимают 12:39–13:35 | Не добавлять: ежедневного обнаружения требует #589; обязательный полный прогон не требуется |
| Валидатор входных JSON Schema | Новая зависимость или рекурсивный валидатор; верхний уровень не ловит `metadata.difficulty`; ответы, права и Web/BFF остаются вне проверки | Не добавлять отдельную копию валидации |
| Ночной полный прогон с Issue о падении | Один прогон в сутки, существующий workflow #682; проверяет вложенные поля настоящим вызовом сервера | Сохранить; добавить назначенную Issue и диагностику нагрузки |
| Загрузка всех Playwright suites в `unit` | `scripts/playwright-specs-load.test.mjs`, введённый #604, вызывает `--list` и требует непустой список | Сохранить существующий дешёвый сторож |

Текущий порядок уведомления и разбора сбоя принадлежит
[runbook CI](../../runbooks/continuous-integration.md#nightly-full-stack-smoke).
Набор не повторяет упавшие тесты. Нагрузка runner записывается через `vmstat`; она помогает
разобрать истечение бюджета, но сама по себе не доказывает причину ошибки.

## Проверки механизма

`node --test scripts/nightly-fullstack-failure.test.mjs scripts/ci-workflow-contract.test.mjs`
проверяет создание назначенной Issue, обновление открытой Issue, отсутствие уведомления с ветки,
ненулевой код при отказе GitHub и подключение отдельного job с правом `issues: write`.
Тест подменяет только внешний CLI GitHub; сам Bash-скрипт исполняется через macOS `/bin/bash` 3.2.

## Инвентаризация проб на 06.10.2026

Источник инвентаризации — корневой и прикладные `package.json`, `.github/workflows/`,
конфигурации Playwright/Vitest и скрипты запуска. Область — исполняемые пробы Platform,
которые самостоятельно задают запросы или ожидания к живому серверу.

| Проба | Где проверяется | Остаток вне обязательного гейта |
|---|---|---|
| `apps/backend/scripts/mcp-authoring-smoke.ts` | Ночной `smoke:fullstack`; `mcp:check` в `static` сверяет состав инструментов | Валидность вложенных входных данных и ответы проверяет живой ночной сервер |
| `apps/web/test/smoke/backend.smoke.test.ts` | `smoke:backend` из ночного полного прогона | Живые `/health` и `/openapi-json`; generated OpenAPI drift отдельно проверяется в `static` |
| `apps/web/test/fullstack/*.spec.ts` | Ночной полный прогон; `enrollment` и `buyer-journey` отдельно входят в `integration` | Остальные browser/BFF сценарии идут ночью; загрузка всех suites входит в `unit` |
| `scripts/compose-stack-smoke.sh` и `scripts/production-compose-smoke.sh` | `compose-development` и `compose-production` обязательного CI | Нет для этих команд |
| `apps/backend/test/*.smoke.test.ts`, команда `smoke:health` | Ручной host smoke; Compose CI отдельно проверяет живую готовность процессов | Отдельные Vitest-пробы композиции API/MCP и `tsx watch` не вызываются workflow |
| `scripts/billing-contact-proof.mjs`, команда `smoke:billing-contact` | Ручная изолированная проба PostgreSQL/SMTP/BFF, [runbook](../../runbooks/billing-contact.md) | Полный browser/SMTP путь не запускается по расписанию; script проходит lint/typecheck, модульные и интеграционные тесты идут отдельно |
| `playwright.editor.config.ts`, `playwright.identity.config.ts` и identity/Telegram sign-in launchers | Ручные реальные editor/Logto stands; перечень в [CI runbook](../../runbooks/continuous-integration.md#suites-outside-ci) | Загрузка suites проверяется в `unit`; живые ручные контуры не запускаются ночью |
| `playwright.production.config.ts` | Production access pass после deploy и вручную; чистая логика проверяется в `unit` | Живой production-контур требует test identities; он не является условием merge |

Дополнительные ручные пробы названы явно: их живые ожидания также могут устареть.
#589 не переводит эти контуры в CI и не переписывает их. Полный ночной набор покрывает
свой API/MCP/browser путь; он не обещает покрытие каждого ручного или production-контура.
