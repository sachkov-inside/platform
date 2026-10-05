# Sachkov Inside: тесты и CI

> Историческое исследование на указанную в документе дату. Оно не задаёт текущие правила.
> Источник: [Workspace](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/2026-09-24-engineering-review/tests-ci.md); текущие правила — [документы Platform](../../../README.md).

Дата: 2026-09-24. Режим: только чтение. Источники: локальные checkout
`repositories/platform` (`6ce6b22f`), `repositories/telegram` (`9a2a4e5`), `repositories/landing`
(`f227684`); GitHub Actions через `gh run list`, `gh api .../jobs?filter=all` и логи упавших jobs.
Полные наборы тестов не запускались. Сырые данные лежат рядом: `review/data/*.json`,
`review/data/classified.txt`, `review/data/categories.txt`, `review/data/ci-summary.txt`; скрипты
лежат в `review/tools/`.

Окно CI: platform `ci.yml`, 200 последних завершённых runs (2026-09-12 … 2026-09-24; 210 выполнений
каждого job с учётом повторов); telegram — 100 runs (08-31 … 09-24); landing — 51 run
(08-18 … 09-15). Из 121 упавшего job удалось скачать и классифицировать 114 логов.

---

## 1. Итог

- **Самая большая потеря в CI — не нестабильные тесты, а Dependabot.** Это 25% runs platform
  (51 из 200) и 20% runner-минут. 61% этих runs падает, и четыре одних и тех же PR падают по 8 раз:
  на каждый merge в `main` строгий required check заставляет PR сделать rebase и заново пройти CI.
- **Настоящий flake один, и он хронический: `notification-transport.test.ts`.** 16 упавших
  выполнений Integration за 12 дней на 13 несвязанных ветках. Последний случай 09-23. Падает каскадом
  (5–7 тестов), таймаут 125–140 с.
- **Второй источник случайных падений — перегрузка integration-набора.** `fileParallelism: true`,
  тестовый таймаут по умолчанию 5 с, а каждый тест с нуля строит базу полным прогоном миграций.
  Рядом идут тяжёлые файлы с брокером (90 с и 63 с).
- **`pnpm check` монолитен.** Это 15 последовательных стадий в одном job Quality (медиана 9,7 мин,
  p90 11,2 мин), и Quality определяет общее время CI (медиана 10,0 мин). Если его разбить,
  получится около 5–6 мин без потери строгости.
- **Пирамида backend перевёрнута.** Integration-кода в 3,2 раза больше, чем unit (29,8k против
  9,2k строк). В web пробелы в `billing-subscription`, `material-lifecycle`, `billing-contact` и
  `guide-modes`. Покрытие кода не собирается нигде.
- **telegram и landing отстают от platform по CI.** В обоих нет branch protection и required checks,
  нет `timeout-minutes` и `concurrency`, используется `ubuntu-latest`. У landing — Node 22 и
  неточные теги actions.

---

## 2. Инвентарь тестов (измерено)

### 2.1 По repository и виду

Случаи — это вызовы `it(`/`test(` по регулярному выражению (для Go — `func Test*`), фактические
числа взяты из логов CI.

| Repo / область | Вид | Файлы | Случаи (статически) | Факт в CI | LOC тестов | Runner |
|---|---|---:|---:|---:|---:|---|
| platform `apps/backend` | unit (`test/unit`, `test/adapters`, `test/contracts`, 7 файлов в корне `test/`) | 70 | 292 | **695** | 9 200 | vitest node |
| platform `apps/backend` | integration (Testcontainers PG, RabbitMQ, MinIO) | 73 | 487 | **638** | 29 803 | vitest |
| platform `apps/backend` | smoke (`*.smoke.test.ts`) | 3 | 3 | вне CI | 194 | vitest |
| platform `apps/web` | «module» (unit/BFF, `test/module`) | 72 | 433 | **475** | 10 523 | vitest node |
| platform `apps/web` | Storybook stories как тесты (browser) | 59 файлов, 551 story | — | **551** | — | vitest browser (chromium) |
| platform `apps/web` | e2e Playwright, подставной backend, `next dev` | 10 (9 в testMatch + evidence) | 106 | **172** (155 pass, 17 skip по проекту) | 3 740 | Playwright ×2 проекта |
| platform `apps/web` | navigation (prod build + fake backend) | 1 | 11 | **22** (20 pass, 2 skip) | 590 | Playwright |
| platform `apps/web` | fullstack (реальный API) | 14 (13 nightly + enrollment) | 64 | nightly; enrollment — 2 в Integration | 3 767 | Playwright |
| platform `apps/web` | editor / reading-proof / identity | 1 / 1 / 2 | — | **ни в каком CI** | — | Playwright |
| platform `apps/web` | smoke | 1 | 1 | вне CI | 60 | vitest |
| platform `packages/*` | unit (colocated `src/*.test.ts`) | 3 | 35 | 98 | 462 | vitest |
| platform `scripts/` | контракты tooling, release, workflow | 32 | 173 | **193** | 5 172 | `node --test` |
| platform `tools/authoring` | unit | 9 | 46 | 57 | 1 199 | `node --test` |
| platform `tools/workshop-evaluator` | Go unit, integration, race | 7 | 17 func | — | 999 | `go test -race` |
| telegram | unit + architecture | 25 | 130 | — | 3 158 | vitest |
| telegram | integration (PG + RabbitMQ service containers, последовательно) | 18 | 232 | — | 11 963 | vitest |
| landing | тестов нет; `verify-production.mjs` — 30 строк проверок метаданных `dist` | 0 | — | — | — | node |

Итого в PR-CI platform около **2 900 автоматических проверок**: 695 + 638 + 475 + 551 + 98 + 250
+ 172 + 22 + 2 + Go.

### 2.2 Гигиена

| Показатель | platform | telegram | Комментарий |
|---|---:|---:|---|
| `.only` | 0 | 0 | Playwright держит `forbidOnly` в CI |
| `.skip` / `.todo` / `.fixme` | 13 `test.skip(...)`, все условные по проекту desktop/mobile или стадии evidence | 0 | Условный skip по имени проекта удваивает число «skipped» (17 в каждом прогоне); вместо него лучше `grep`/tag на проекте |
| Snapshot / `toHaveScreenshot` | 0 | 0 | Визуальные регрессии не ловятся; для UI есть только Storybook-взаимодействия и axe |
| Ожидание по времени (`waitForTimeout`, `setTimeout`-sleep) | 13 мест: fullstack `material-reader.spec.ts:218,762,774,780`, `personal-home.spec.ts:192` (1,2 с), navigation 150/300 мс, integration `setTimeout(5–10)` в 5 файлах | 2 | Противоречит `CODING_STANDARDS.md` §«Waiting in tests»; часть обоснованно доказывает отсутствие события |
| Fake timers | 3 файла | 6 | В integration часы реальные: `new Date()`/`Date.now()` встречаются в 54 местах |
| Retries | Playwright e2e и navigation: `retries: 1` в CI; vitest — 0 | 0 | В 4 проверенных успешных логах flaky не было |
| Coverage | **не настроен** (упоминание есть только в `.oxlintrc.json`) | `coverage.enabled: false` | Нет даже отчёта |

### 2.3 Конфигурация vitest

| Config | Projects/pool | Timeouts | Замечание |
|---|---|---|---|
| `apps/backend/vitest.config.mts` | один, pool по умолчанию | по умолчанию 5 с | include `test/**/*.test.ts` минус smoke и integration |
| `apps/backend/vitest.integration.config.mts` | `fileParallelism: true`, `globalSetup` с одним PG-контейнером | **по умолчанию: test 5 с, hook 10 с** | Тяжёлые тесты ставят свои таймауты (15–180 с), остальные живут с 5 с |
| `apps/backend/vitest.smoke.config.mts` | — | 20 с | вне CI |
| `apps/web/vitest.config.mts` | 2 projects: node module и storybook browser | по умолчанию | `restoreMocks`, `unstubEnvs`, `unstubGlobals` включены — хорошо |
| `packages/legal`, `access-capabilities` | без config | — | |
| telegram `vitest.integration.config.ts` | `fileParallelism: false`, `sequence.concurrent: false` | по умолчанию | Медленнее, зато стабильно: 4 падения на 100 runs, из них 1 flake |

### 2.4 Где лежат тесты

| Место | Соглашение |
|---|---|
| backend | `test/unit/`, `test/adapters/`, `test/contracts/`, 7 файлов в корне `test/`, smoke в корне `test/*.smoke.test.ts`, `test/integration/*.test.ts` без суффикса |
| telegram | `test/unit/`, `test/architecture/`, `test/integration/*.integration.test.ts` с суффиксом |
| web | unit называется `test/module/`; stories colocated в `src/`; 7 Playwright configs в корне app, каждый со своим `testDir` |
| packages | colocated `src/*.test.ts` |
| tooling | `scripts/*.test.mjs` и `tools/authoring/*.test.mjs` на `node:test`, Go — стандартно |

Четыре runner (vitest, `node:test`, `go test`, Playwright) и три схемы именования. В каждом
приложении правило внутренне последовательно, но между repositories оно расходится.

### 2.5 Покрытие модулей (по импортам тестов из `src/`)

**Backend** — число тест-файлов, которые импортируют модуль:

| Модуль | LOC | unit | integ | Оценка |
|---|---:|---:|---:|---|
| materials | 18 413 | 24 | 39 | ок |
| billing | 4 357 | 9 | 22 | unit тонкий для денег |
| membership-entitlements | 4 238 | **4** | 25 | логика доступа проверяется почти только через БД |
| telegram-membership | 4 092 | 6 | 14 | ок |
| accounts | 3 109 | 12 | 43 | ок |
| videos | 2 616 | 6 | 8 | ок |
| workshop | 2 382 | **3** | 20 | перекос в integration |
| member-profiles | 2 044 | 5 | **1** | мало integration |
| reading-activity | 969 | **0** | 2 | нет unit |
| bookmarks | 438 | **0** | 1 | нет unit |
| infrastructure/worker-healthcheck, process-shutdown | 101 | 0 | 0 | не проверены |
| release/* (bootstrap-owner, moderate-profiles) | 105 | 0 | 0 | операционные скрипты без тестов |

**Web** — module-тесты и stories на slice:

| Slice | LOC | module-тесты | stories |
|---|---:|---:|---:|
| features/billing-subscription | 1 761 | **0** | 2 |
| features/material-lifecycle | 768 | **0** | **0** |
| features/billing-contact | 773 | **0** | 1 |
| features/notification-preferences | 580 | 0 (есть BFF-тест через route) | 1 |
| features/guide-modes | 239 | **0** | **0** |
| widgets/application-shell | 348 | **0** | **0** |
| widgets/authoring-shell | 241 | 0 | 0 |
| _pages/communications | 5 183 | 2 | 5 |
| widgets/material-authoring | 4 263 | 3 | 1 |

Оговорка: это эвристика по путям импорта. Часть BFF проверяется через `app/**/route.ts`, поэтому
ноль означает «нет прямого теста», а не «код вообще не проверяется».

**Пакеты:** `packages/material-blocks` — 1 787 LOC без собственных тестов, косвенно его
используют 6 тестов приложений. `packages/runtime-identity` покрыт через
`scripts/http-healthcheck.test.mjs` и `apps/backend/test/runtime-identity.test.ts`.

### 2.6 Дублирование fixtures в integration

| Паттерн | Файлов из 73 |
|---|---:|
| `assembleMaterials(` | 30 |
| `authoring.createDraft` (создание материала вручную) | 28 |
| `account.create(` | 28 |
| `topic.create(` | 27 |
| `assembleContentAccess(` | 12 |

Общие builders есть только частично: `test/integration/setup/*` (bank, broker, legacy-cohort,
telegram-link) и `test/fixtures/material-body`. Пример ручной сборки:
`apps/backend/test/integration/bookmarks.test.ts:26-66`.

---

## 3. CI: измерения

### 3.1 Итоги по workflow

| Workflow | Runs | success | failure | cancelled | Медиана wall (успех) | p90 |
|---|---:|---:|---:|---:|---:|---:|
| platform `Application CI` | 200 | 115 | 48 | 37 | **10,0 мин** | 12,3 мин |
| └ только Dependabot | 51 | 20 | **31 (61%)** | 0 | | |
| └ ветки людей и агентов | 149 | 95 | 17 (15% от завершённых) | 37 | | |
| platform `Nightly full-stack smoke` | 5 (все — ручной запуск или push 09-23; расписание ещё ни разу не срабатывало, merge был 09-24 06:28 UTC) | 4 | 1 | 0 | 11,5 мин | |
| platform `Publish ordinal release` | 11 | 9 | 1 | 1 | 10,1 мин | 16,7 |
| platform `Deploy production release` | 14 | 12 | 2 | 0 | | |
| platform `Workshop evaluator artifacts` | 17 | 11 | 6 (все — bring-up `feat/265`, 09-03) | 0 | 1,6 мин | 2,5 |
| telegram `Application CI` | 100 | 96 | 4 (1 flake, 3 реальных: prettier ×2, миграция) | 0 | **1,5 мин** | 2,3 |
| landing `CI` | 51 | 51 | 0 | 0 | 0,4 мин | 0,5 |

Runner-минуты platform CI: **4 195 мин за 11 дней (~381/день)**. Из них успешные runs людей —
57%, **отменённые (concurrency) — 13,6%**, **Dependabot — 20,4%** (успешные 11,3%, упавшие 9,1%),
упавшие runs людей — 8,8%. Очередь до старта: медиана 3 с, p90 25 с. У веток людей в среднем
2 run на ветку, максимум 16.

### 3.2 Jobs platform `ci.yml` (210 выполнений каждого)

| Job | fail % (все) | fail % (без Dependabot) | Медиана | p90 | max | Повтор прошёл после падения |
|---|---:|---:|---:|---:|---:|---:|
| Quality (`pnpm check`) | 25,0% | 12,0% | **9,7 мин** | 11,2 | 12,7 | 0 |
| Integration | 18,9% | **16,4%** | 6,3 мин | 7,0 | 7,8 | **6** |
| Production Compose | 9,3% | 0,7% | 4,5 мин | 5,0 | 5,7 | 0 |
| Development Compose | 5,6% | 2,0% | 3,2 мин | 3,6 | 4,2 | 0 |
| CI Gate | 44,3% (падает и при `cancelled` вышестоящих jobs) | | 0,1 | | | |

### 3.3 Причины падений (114 классифицированных логов, без CI Gate)

| Категория | Упавших jobs | Runs | Примеры |
|---|---:|---:|---|
| Dependabot: реальная несовместимость, повторяется на каждом rebase | 67 | 31 | tiptap `TS2322` в `material-blocks` postinstall (8 runs, [35321467154](https://github.com/sachkov-inside/platform/actions/runs/35321467154)); storybook: контракт toolchain (8, [35321269110](https://github.com/sachkov-inside/platform/actions/runs/35321269110)); npm-patch-minor: OpenAPI drift и `fastify-multipart TS2345` ([35557488857](https://github.com/sachkov-inside/platform/actions/runs/35557488857)); upload-artifact-7: контракт pinning (4) |
| **FLAKE `notification-transport.test.ts`** (SIGKILL ×5, «mandatory return and queue saturation», «broker node outage») | **16** на всех ветках (11 — не Dependabot) | 16 | [34950519116](https://github.com/sachkov-inside/platform/actions/runs/34950519116), [35273287671](https://github.com/sachkov-inside/platform/actions/runs/35273287671), [35849906891](https://github.com/sachkov-inside/platform/actions/runs/35849906891); даты: 09-12 ×2, 09-14 ×6, 09-15 ×4, 09-17, 09-18, 09-23 ×2 |
| **FLAKE Storybook `src/workshop/material-authoring.stories.tsx`, таймаут 15 с** | 7 | 6 | [34699844794](https://github.com/sachkov-inside/platform/actions/runs/34699844794) (оба attempt), [34950821346](https://github.com/sachkov-inside/platform/actions/runs/34950821346); 09-12…09-15, 5 веток |
| **FLAKE integration: таймаут 5 с по умолчанию** (`material-formats`, `local-development-seed`, `billing-sale-configuration`) | 2 | 2 | [34965997273](https://github.com/sachkov-inside/platform/actions/runs/34965997273) attempt 2, [34700026315](https://github.com/sachkov-inside/platform/actions/runs/34700026315) |
| Enrollment browser smoke (Integration) | 4 | 4 | `feat/468`, `feat/648` ×2 — вероятно реальные, но подтверждения нет |
| PgBoss в Production Compose | **0 в окне** | — | Заметка владельца от 09-12 в окно не попала; за 12 дней Production Compose вне Dependabot упал 1 раз, и это была не PgBoss |
| Реальные ошибки веток (tsc, oxlint, контракты tooling, compose, billing) | 21 | 20 | нормальная работа гейта |
| Инфраструктура (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`) | 1 | 1 | |
| Лог недоступен | 7 | 7 | |

**Вывод по flakes.** Integration не проходит только из-за нестабильности примерно в 1 из 10
выполнений. В окне 14 runs упали **исключительно** из-за flakes, то есть каждый такой случай стоит
10 мин ожидания, ручного `gh run rerun --failed` и разбора.

### 3.4 Где тратится время Quality

Run [35997284774](https://github.com/sachkov-inside/platform/actions/runs/35997284774), job
107625117680; тайминги по отметкам `$ <cmd>` в логе.

| Стадия | Время |
|---|---:|
| checkout, pnpm, setup-node (кеш pnpm store) | 20 с |
| `pnpm install --frozen-lockfile` (включая postinstall-сборку 3 пакетов и `prisma generate`) | 12 с |
| `playwright install --with-deps chromium webkit` (**без кеша**) | **43 с** |
| docs:check, повторная сборка пакетов, api:check, oxlint 8 с, typecheck 12 с, guardrails | ~42 с |
| `node --test scripts/*.test.mjs` (193 теста) | 40 с |
| authoring, workshop contracts, `go test -race` (Go из образа runner, не `setup-go`) | ~27 с |
| `pnpm -r test` (backend 695 за 44 с ∥ web 1 026 за 85 с) | **89 с** |
| `playwright test` e2e на **`next dev`**, 2 workers, 172 теста | **192 с** (от 2,7 до 4,4 мин в 4 runs) |
| `pnpm -r build` (Next build) | 28 с |
| navigation (prod build + fake backend, 1 worker, 22 теста) | ~100 с |
| build-storybook | 9 с |

Самые медленные файлы:

- Integration (сумма 531 с при wall 242 с): `notifications-acceptance` 89,9 с,
  `notification-transport` 63,5 с, `notifications-broker` 19,0 с, `content-library` 15,0 с,
  `material-announcement-broker` 14,3 с.
- Vitest в Quality: `test/module/telegram-sign-in.test.ts` **51,6 с** (запускает настоящие
  chromium и webkit), `material-authoring.stories.tsx` 38,9 с, `series-journey.stories.tsx` 32,2 с.

### 3.5 Граф workflows и паритет

```
platform
  ci.yml (pull_request→main, workflow_call)
    quality ─┐
    integration ─┤
    compose-development ─┼─> CI Gate  (required, strict up-to-date)
    compose-production ─┘
  release.yml (dispatch): plan → ci.yml(reuse) → build-images[matrix backend,web] → finalize
  deploy.yml (dispatch, environment Production, concurrency queue)
  nightly-fullstack.yml (cron 01:17 UTC + dispatch) — не в гейте
  workshop-evaluator.yml (paths: contracts/workshop, tools/workshop-evaluator) — macOS/Linux/Windows
telegram  application-ci.yml (pull_request + push main): verify = pnpm check:full, services PG+RabbitMQ
landing   ci.yml (pull_request + push main): production-build = npm ci && npm run verify
```

| Свойство | platform | telegram | landing |
|---|---|---|---|
| Защита `main` / required checks | ruleset: PR, linear history, `CI Gate` strict | **нет** (rules `[]`, protection 404) | **нет** (rules `[]`, protection 404) |
| `concurrency` | да, cancel-in-progress | **нет** | **нет** |
| `timeout-minutes` | да, на каждом job | **нет** | **нет** |
| Runner | `ubuntu-24.04` | `ubuntu-latest` | `ubuntu-latest` |
| Pinning actions | точный тег `@vX.Y.Z` (контракт-тест) | **SHA** + комментарий | **плавающий `@v7`** |
| Кеш зависимостей | pnpm store через setup-node | **нет** (pnpm ставится через `npm i -g`) | npm cache |
| Node | `.node-version` 24.19.0 (Docker тоже) | 24.20.0 (Docker тоже) | **22.23.1** (engines `<23`) |
| Merge queue / `merge_group` | нет | нет | нет |
| Path filters | только workshop-evaluator | нет | нет |
| Кеш Playwright browsers, Docker layers, Next | **нет** | — | — |
| Push в `main` запускает CI | нет (только nightly) | да | да |

Дублирование: `go test -race ./...` выполняется в Quality (через `pnpm test`) и ещё раз в
`workshop-evaluator.yml` на linux, если изменились соответствующие пути. Release вызывает `ci.yml`
целиком (это правильно — проверяется точный SHA). Nightly повторяет install и browser setup из
Quality без общего composite action. Шаги checkout, pnpm, node, install скопированы в 6 местах
(`ci.yml` ×3, nightly, release ×2).

---

## 4. Находки

Формат: **серьёзность** · находка · доказательства · рекомендация · трудоёмкость.

### High

**H1. Хронический flake `notification-transport.test.ts` ломает Integration.**
Доказательства: 16 упавших выполнений Integration за 12 дней на 13 несвязанных ветках, последний
случай 09-23 (§3.3). Падает каскадом: после SIGKILL первого сценария следующие наследуют брокер и
очередь, и падают 5–7 тестов. Таймаут 125–140 с. Дочерний процесс стартует через
`fork(..., execArgv: ['--import','tsx'])` (`apps/backend/test/integration/notification-transport.test.ts:186-189`),
то есть холодная транспиляция TS-графа идёт на загруженном runner, где параллельно выполняются
`notifications-acceptance` (90 с) и остальные 70 файлов. В telegram похожий файл
`notification-broker.integration.test.ts` дал 1 flake из 100.
Рекомендация:
1. Вынести broker и crash-файлы (`notification-transport`, `notifications-acceptance`,
   `notifications-broker`, `*-broker.test.ts`) в отдельный vitest project с
   `fileParallelism: false`, а лучше — в отдельный CI job `integration-broker`.
2. Собирать crash worker один раз (esbuild или `tsc` в `globalSetup`) и форкать готовый `.js`.
3. Изолировать сценарии: у каждой фазы свой vhost или своя очередь, чтобы падения не шли каскадом.
4. Завести правило карантина: flake с issue-ссылкой можно временно пометить `test.skipIf(CI)` не
   больше чем на N дней, но не держать как вечный «перезапусти».

Трудоёмкость: M.

**H2. Integration-набор перегружает runner и падает на таймаутах по умолчанию.**
Доказательства:
- `apps/backend/vitest.integration.config.mts:7` — `fileParallelism: true` без `testTimeout` и
  `hookTimeout`.
- `setup/test-database.ts:41-44` — каждая база строится с нуля через `migrateToLatest`: 166 вызовов
  `create*TestDatabase` и ещё 33 прямых `migrateToLatest` в тестах.
- `material-formats`, `local-development-seed`, `billing-sale-configuration` падают на
  `Test timed out in 5000ms` (§3.3), что подтверждает заметку владельца.
- Сумма времени файлов 531 с при wall 242 с, то есть запас по параллелизму уже съеден.

Рекомендация:
1. Template DB: в `globalSetup` один раз мигрировать `inside_template`, дальше
   `CREATE DATABASE x TEMPLATE inside_template`. Это миллисекунды вместо полного прогона миграций.
   Тесты самих миграций (`migrations`, `material-formats`, `subscription-migration`) оставить на
   чистой базе.
2. Явно задать `testTimeout: 30_000` и `hookTimeout: 60_000` как бюджет «застрявшего прогона»,
   что согласуется с `CODING_STANDARDS.md` §Waiting.
3. Разделить projects `integration-db` (параллельно) и `integration-broker` (последовательно), см. H1.

Трудоёмкость: S (template, timeouts) + M (разделение).

**H3. Dependabot забирает четверть CI и держит «вечно красные» PR.**
Доказательства: 51 из 200 runs, 61% упавших, 20,4% runner-минут. Четыре PR падают по 8 раз одним и
тем же образом (§3.3). Первопричина повторов в том, что ruleset требует strict up-to-date, поэтому
каждый merge в `main` вызывает rebase Dependabot и полный CI (`.github/dependabot.yml` без
`rebase-strategy`). Runbook `docs/runbooks/dependency-updates.md` описывает политику, но не описывает,
кто и когда разбирает красные PR.
Рекомендация:
1. Еженедельно разбирать красные PR: чинить (tiptap `TS2322`, `fastify-multipart`, OpenAPI drift
   через `pnpm api:generate` в самом PR), закрывать с `@dependabot ignore this minor version` или
   добавлять в `ignore`.
2. Поставить `rebase-strategy: disabled` для npm, чтобы PR обновлялся по команде, или хотя бы
   снизить `open-pull-requests-limit`.
3. Workflow, который после первого красного CI вешает на Dependabot-PR label `needs-owner` и
   выключает дальнейшие rebase.

Трудоёмкость: S.

**H4. Strict required check без merge queue вынуждает повторять CI после каждого merge.**
Доказательства: 37 отменённых runs (13,6% минут) и медиана 2 runs на ветку. В памяти владельца есть
заметка «Окно мержа без требования свежести»: strict временно снимали вручную. В `ci.yml` нет
триггера `merge_group`, а контракт-тест `scripts/ci-workflow-contract.test.mjs:31-33` фиксирует
набор триггеров.
Рекомендация: включить GitHub merge queue для `main`, добавить в `ci.yml` триггер `merge_group`
(в concurrency group указать `github.event.merge_group.head_ref`), снять strict и обновить
контракт-тест. Свежесть относительно `main` гарантирует очередь, а не rebase каждой ветки. Для
одного разработчика с агентами очередь размера 1–3 закрывает ручное «окно мержа».
Трудоёмкость: M. Это изменение ruleset, решение за владельцем.

### Medium

**M1. `pnpm check` — монолит на критическом пути.**
Доказательства: `package.json:47` — 15 стадий через `&&`. Quality: медиана 9,7 мин, p90 11,2
(§3.4). Первая упавшая стадия скрывает результат всех следующих. Локально прогон эксклюзивный,
около 10 мин, и ломается от правок в `dist` (заметки владельца).
Рекомендация:
1. Ввести составные скрипты, которые одинаково работают локально и в CI: `check:static` (docs, api,
   lint, typecheck, guardrails, генераторы; ~1,5 мин), `check:unit` (vitest node-проекты, packages,
   `node:test`, Go; ~2 мин), `check:ui` (Storybook-тесты и `build-storybook`; ~2 мин),
   `check:web-e2e` (`next build`, prerendered, standalone, e2e и navigation на prod-сборке; ~4 мин).
2. `pnpm check` оставить агрегатом этих скриптов.
3. В `ci.yml` сделать 4 параллельных jobs вместо `quality`, `CI Gate` не менять (имя в ruleset
   прежнее) и обновить `ci-workflow-contract.test.mjs:78-80`.

Ожидаемый wall — около 5–6 мин против 10. Runner-минуты вырастут примерно на 3 мин на run из-за
повторной подготовки окружения; с кешем browsers прирост меньше.
Трудоёмкость: M.

**M2. E2E идут на `next dev`, а потом тот же код собирается ещё раз.**
Доказательства: `apps/web/playwright.config.ts:53` — `pnpm dev`. Время e2e плавает от 2,7 до
4,4 мин в 4 успешных runs из-за компиляции маршрутов при первом открытии. Затем
`pnpm build` (`package.json:47`) и navigation уже на prod-сборке. Enrollment smoke в Integration
тоже поднимает `next dev` (`scripts/enrollment-browser-smoke.mjs:94-98`).
Рекомендация: собрать один раз и прогнать e2e и navigation на `next start`; при необходимости
разделить на shards (`--shard=1/2`). Это ближе к production и детерминированнее.
Трудоёмкость: S–M.

**M3. Медленные и нестабильные browser-тесты в web.**
Доказательства:
- `material-authoring.stories.tsx`: 7 упавших Quality на таймауте 15 с (09-12…09-15), 38,9 с на
  35 stories. `series-journey.stories.tsx` — 32 с.
- `test/module/telegram-sign-in.test.ts` лежит в node-проекте «module», но запускает настоящие
  `chromium.launch()` и `webkit.launch()` (строки 3, 56, 213), проверяет код форка Logto из
  `infra/identity/logto/fork` и идёт 52–56 с. Ради одного этого теста CI ставит webkit
  (`ci.yml:46`).

Рекомендация: профилировать play-функции (скорее всего, это реальные задержки редактора или
autosave). Тяжёлые сценарии вынести в Playwright-набор. `telegram-sign-in` перенести в
`test/identity` или отдельный browser-project со своим CI job.
Трудоёмкость: S–M.

**M4. Набор fullstack и ручные наборы почти не видны CI.**
Доказательства:
- nightly добавлен 09-24, расписание ещё не срабатывало; 1 из 6 ручных запусков упал
  (`material-reader.spec.ts:453`, [35849947262](https://github.com/sachkov-inside/platform/actions/runs/35849947262)).
- `test/editor/autosave.spec.ts`, `test/reading-proof/*`, `test/identity/*` не запускаются нигде.
  `scripts/playwright-specs-load.test.mjs` проверяет только то, что наборы загружаются.
- В заметке владельца сказано, что `smoke:fullstack` отстаёт от интерфейса и ловит реальные
  дефекты.

Рекомендация: включить в nightly editor и reading-proof, identity раз в неделю. Красный nightly
автоматически открывает issue (сейчас это ручное правило в runbook). Выставлять статус nightly на
Project.
Трудоёмкость: M.

**M5. В telegram и landing нет CI-гейта.**
Доказательства: §3.5 — в обоих нет protection и required checks, нет `concurrency` и
`timeout-minutes`, используется `ubuntu-latest`. В telegram нет кеша pnpm. У landing плавающие
`@v7` и Node 22 против 24 в остальных repositories.
Рекомендация:
1. Required check `verify` / `production-build` в ruleset `main`.
2. Добавить `concurrency` и `timeout-minutes`, закрепить `ubuntu-24.04`, в telegram ставить pnpm
   через `pnpm/action-setup` с кешем, в landing закрепить версии actions.
3. Для однородности держать канонический CI-скелет в harness `inside-engineering` (он уже
   распространяет workflow `inside-agent-sessions`).
4. Отдельно решить, остаётся ли landing на Node 22.

Трудоёмкость: S.

**M6. Покрытие кода не измеряется.**
Доказательства: нет `coverage` ни в одном `vitest.config` platform, в telegram оно выключено
(`vitest.config.ts:5-7`).
Рекомендация: `@vitest/coverage-v8` только как отчёт и артефакт, без порогов, для backend
unit+integration, web module и telegram. Отчёт использовать для адресной работы с пробелами §2.5.
Пороги вводить позже, только на новых модулях.
Трудоёмкость: S.

**M7. Пирамида backend перевёрнута, у доменной логики мало unit-тестов.**
Доказательства: integration 29,8k LOC / 638 тестов против unit 9,2k / 695. Модули с 0–4 unit-файлами
при 20+ integration: `membership-entitlements`, `workshop`; без unit — `reading-activity` и
`bookmarks` (§2.5). Каждая integration-проверка платит за контейнер, базу и миграции (H2).
Рекомендация: для правил доступа, биллинга и workshop вынести решения в чистые функции или
use-cases с портами и проверять их unit-тестами. В integration оставить швы: транзакции,
конкурентность, SQL-ограничения, брокер. Цель — чтобы новые правила по умолчанию получали
unit-тест, а integration добавлялся только при новом шве с БД.
Трудоёмкость: L (постепенно, по модулям).

**M8. Дублирование fixtures в integration.**
Доказательства: 27–30 файлов из 73 вручную создают account, topic, material и собирают
`assembleMaterials` (§2.6).
Рекомендация: `test/integration/setup/builders.ts` с `aPublishedMaterial()`, `anAccount()`,
`aTopic()` и составным `assemblePlatform(prisma)` для 80% случаев. Мигрировать по мере касания
файлов.
Трудоёмкость: M.

**M9. Пробелы в web-тестах.**
Доказательства: §2.5 — `features/billing-subscription` (1 761 LOC, 0 module-тестов),
`material-lifecycle` (768, 0/0), `billing-contact` (773, 0 module), `guide-modes` (0/0),
`widgets/application-shell` (0/0).
Рекомендация: начать с billing-subscription и billing-contact (деньги), material-lifecycle
(публикация). Для shell достаточно story с проверкой навигации.
Трудоёмкость: M.

### Low

**L1. CI-контракты проверяют текст YAML, а не смысл.**
Доказательства: `scripts/ci-workflow-contract.test.mjs` требует ровно 3 `upload-artifact`, 4
`if: failure()`, `run: pnpm check` и теги `@vX.Y.Z` (`:56`, `:80`, `:142-144`). Они уже роняли
Dependabot `upload-artifact-7` (4 runs) и ветку nightly (2 runs). Любое улучшение CI (M1, H4) требует
переписать регулярные выражения.
Рекомендация: разбирать YAML и проверять инварианты безопасности (permissions, отсутствие secrets,
`needs` у gate, pinning), а не количество строк. Трудоёмкость: S.

**L2. Нет кеша Docker layers.**
Доказательства: Development Compose собирает весь профиль (3,2 мин). Production Compose собирает 3
образа, и `release:images:smoke` на PR собирает их ещё раз (4,5 мин).
Рекомендация: buildx с `cache-from/cache-to: type=gha` или общий bake-файл. Трудоёмкость: M.

**L3. Мелкие потери в настройке окружения.**
Доказательства: Playwright browsers без кеша (43 с в Quality, 25 с в Integration, nightly). Go в
Quality берётся из образа runner, а не через `setup-go` по `go.mod`, и без кеша модулей. `.next/cache`
не кешируется.
Рекомендация: общий composite action `.github/actions/setup-platform` (checkout, pnpm, node,
install, опционально browsers с `actions/cache` по версии `@playwright/test`, опционально Go).
Трудоёмкость: S.

**L4. Разрастание скриптов.**
Доказательства: 69 root-скриптов, 46 в backend, 19 в web, всего 134. Префиксы: 9 `identity:*`,
8 `dev:*`, 7 `test:*`, 6 `authoring:*`, 5 `smoke:*`, 4 `workshop:*`. 7 Playwright configs.
`check:full` не совпадает ни с одним CI job.
Рекомендация: сгруппировать proof и identity в `scripts/proof/` с одним диспетчером; привести
`check:*` к CI-стадиям M1; держать таблицу команд в `README`, сверяемую `docs:check`.
Трудоёмкость: S–M.

**L5. Разные соглашения о размещении и именовании тестов.**
Доказательства: §2.4.
Рекомендация: зафиксировать в `CODING_STANDARDS.md` одну схему (`*.integration.test.ts` или папка —
выбрать одно; `test/unit` вместо `test/module`; smoke в `test/smoke/`) и добавить её в guardrails.
Трудоёмкость: S.

**L6. Сборка пакетов в postinstall и `dist` как вход тестов.**
Доказательства: `packages/*/package.json` (postinstall `pnpm build`); `check` пересобирает их
повторно (`package.json:47`), а потом ещё `pnpm -r build`. В заметке владельца: правка во время
прогона даёт ложные падения.
Рекомендация: export source через `exports` с условием `development`/`source` для vitest и tsx или
TS project references. Это же уберёт эксклюзивность локального check.
Трудоёмкость: M.

**L7. Ожидания по времени в browser-тестах.**
Доказательства: §2.2, в частности `test/fullstack/personal-home.spec.ts:192` (`waitForTimeout(1_200)`)
и `material-reader.spec.ts:762` (500 мс).
Рекомендация: заменить на ожидание факта (`expect.poll`, сетевой ответ). Там, где доказывается
отсутствие события, оставить с комментарием. Трудоёмкость: S.

### Про task runner (turbo/nx)

Сейчас его нет. В workspace 6 пакетов, и CI-время определяется e2e, integration и compose, а не
повторной сборкой пакетов, поэтому **turbo не даст заметного выигрыша в CI без remote cache**.
Локально он помог бы пропускать неизменённые typecheck, test и build в эксклюзивном `pnpm check`
(около 10 мин). Порядок такой: сначала M1 (составные `check:*`) и L6 (без `dist` как входа),
затем, если локальные повторы всё ещё дорогие, turbo с локальным кешем. Трудоёмкость M,
приоритет Low.

---

## 5. Целевая пирамида тестов

| Уровень | Сейчас (platform) | Цель | Где запускается |
|---|---|---|---|
| Static / fitness (lint, typecheck, guardrails, генераторы контрактов, docs) | ~40 с, в Quality | без изменений; YAML-контракты по смыслу (L1) | PR: `static` |
| Unit (без IO): backend, web, packages, tooling, Go | 695 + 475 + 98 + 250 + Go; `telegram-sign-in` ошибочно здесь | **основание пирамиды**: новые правила домена сначала получают unit-тест (M7); цель — backend unit ≥ integration по числу проверок доменных решений | PR: `unit` (< 2 мин) |
| Component (Storybook, browser) | 551 story | оставить; тяжёлые сценарии авторинга — в Playwright; каждая новая UI-фича получает story с play и axe | PR: `ui` |
| Integration DB (Testcontainers PG) | 638 тестов вместе с broker | template DB, явные таймауты, общие builders; только швы с БД | PR: `integration-db` |
| Integration broker / crash (RabbitMQ, SIGKILL) | 4–6 файлов, источник flakes | отдельный последовательный project и job, собранный worker, изоляция по vhost | PR: `integration-broker` |
| Web E2E с подставным backend | 172 + 22 на `next dev` + prod | одна prod-сборка, e2e и navigation на `next start`, shards | PR: `web-e2e` |
| Compose smokes | dev 3,2 мин, prod 4,5 мин | с кешем buildx | PR: `compose-*` |
| Fullstack E2E (реальный API) | nightly, enrollment на PR | nightly: fullstack, editor, reading-proof; еженедельно identity; красный запуск сам открывает issue | nightly / weekly |
| Coverage | нет | отчёт v8 без порогов | PR artifact |

## 6. Целевая схема CI platform

```
on: pull_request, merge_group, workflow_call(source_sha)
concurrency: platform-ci-${{ pr.number || merge_group.head_ref || run_id }}, cancel-in-progress

setup-platform (composite): checkout · pnpm · node(.node-version) · install · [browsers cache] · [go]

static             ~1.5m   pnpm check:static
unit               ~2m     pnpm check:unit            (vitest node projects, packages, node:test, go -race)
ui                 ~2.5m   pnpm check:ui              (storybook vitest + build-storybook)
web-e2e [2 shards] ~3-4m   pnpm check:web-e2e         (next build → prerendered/standalone → e2e + navigation на next start)
integration-db     ~3m     vitest --project integration-db   (template DB)
integration-broker ~3m     vitest --project integration-broker (serial) + smoke:enrollments
compose-development ~2.5m  (buildx gha cache)
compose-production  ~3.5m  (buildx gha cache; images smoke только на PR)
          └──────────────► CI Gate (имя не меняется; ruleset: merge queue, без strict)

nightly (cron): smoke:fullstack + editor + reading-proof; weekly: identity; failure → issue
workshop-evaluator: без изменений (Go уже покрыт в unit)
Dependabot: rebase-strategy disabled, label needs-owner после красного CI
```

Ожидаемый эффект: wall-time PR около 5–6 мин вместо 10,0 (медиана) и 12,3 (p90). Исчезнут
повторы после каждого merge (H4) и ~20% минут Dependabot (H3). Flakes Integration локализуются в
одном job (H1/H2). Runner-минуты на один run вырастут примерно на 20–30% из-за повторной подготовки
окружения, но общий расход упадёт за счёт H3 и H4.

## 7. Порядок работ

| № | Шаг | Находки | Трудоёмкость |
|---|---|---|---|
| 1 | Разобрать 4 красных Dependabot PR и настроить `rebase-strategy` | H3 | S |
| 2 | Template DB, явные таймауты, project `integration-broker` с собранным crash worker | H1, H2 | S+M |
| 3 | Составные `check:*`, разделение Quality на 4 jobs, composite setup, кеш browsers | M1, M2, L3 | M |
| 4 | Merge queue и `merge_group`; контракт-тест CI по смыслу | H4, L1 | M |
| 5 | Гейт для telegram и landing | M5 | S |
| 6 | Coverage-отчёт, затем адресные unit-тесты billing, entitlements, workshop и web billing | M6, M7, M9 | M→L |
| 7 | Builders для integration, соглашения о размещении, nightly-расширение | M8, L5, M4 | M |
