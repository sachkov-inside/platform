# Sachkov Inside: зависимости, TypeScript, линтинг

> Историческое исследование на указанную в документе дату. Оно не задаёт текущие правила.
> Источник: [Workspace](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/2026-09-24-engineering-review/deps-typescript.md); текущие правила — [документы Platform](../../../README.md).

Дата: 2026-09-24. Режим: только чтение. Репозитории: `platform` (main `6ce6b22f`, отстаёт от origin на 3),
`telegram` (main `9a2a4e5`, отстаёт на 9), `landing/app` (main `f227684`).

Как измерялось:

- Последние версии получены через `npm view` (97 уникальных пакетов, 138 прямых зависимостей),
  Node через `nodejs.org/dist/index.json`, Go через `go.dev/dl`, Docker через Docker Hub, Actions через
  `git ls-remote --tags`.
- Компилятор: `tsc` 7.0.2 из platform, `tsc --noEmit --incremental false -p <cfg> <флаги>`. Файлы не
  менялись, `tsbuildinfo` не писался.
- Линтер: `oxlint` 1.80.0 + `oxlint-tsgolint` 7.0.2001 с текущим `.oxlintrc.json` и добавленными
  флагами `-D typescript/<rule>`.
- В `telegram` и `landing/app` нет `node_modules`. Установка вне рамок обзора, поэтому замеры
  компилятора и линтера там не проводились. Для них есть только статический разбор и счётчики гигиены.

## Главное

| # | Находка | Severity | Effort |
|---|---|---|---|
| 1 | NestJS в разных major: platform `11.2.1`, telegram `12.0.1`, последняя `12.1.0`. Platform отстаёт и в своей линии: вышли 11.2.2–11.2.6 | High | L |
| 2 | Путь telegram на TS 7 закрыт: `typescript-eslint@8.70.1` требует `typescript >=4.8.4 <6.1.0`, а линт там не type-aware (только `recommended`) | High | M |
| 3 | В platform `packages/legal` и `packages/access-capabilities` не попадают в type-aware override `.oxlintrc.json`. Это противоречит `platform/CODING_STANDARDS.md`: там сказано, что пакеты проверяются той же type-aware конфигурацией. Замер: 0 нарушений, закрыть можно бесплатно | Medium | S |
| 4 | Нет общего base tsconfig: 7 почти одинаковых копий в platform, отдельная в telegram, лендинг на `astro/tsconfigs/strict` (а не `strictest`) | Medium | S |
| 5 | Telegram tsconfig слабее platform: нет `exactOptionalPropertyTypes` и `noImplicitReturns`; в коде 317 non-null `!` (146 в src) | Medium | M |
| 6 | Landing: нет линтера и форматтера, диапазоны `^`, npm вместо pnpm, Node 22 (engines `<23` при Node 24 в остальных репозиториях) | Medium | S |
| 7 | В platform нет форматтера (у telegram есть prettier) | Medium | S |
| 8 | ~15k LOC нетипизированных `.mjs` в platform (111 файлов: `scripts/`, `tools/authoring/`, guardrail-чекеры), без `@ts-check` и без `checkJs` | Medium | M |
| 9 | Разброс версий Node: platform 24.19.0, telegram 24.20.0, landing CI 22.23.1; последняя 24.x — 24.21.0 | Medium | S |
| 10 | amqplib: platform `0.10.9` + `@types/amqplib`, telegram `2.0.1` (типы встроены) | Medium | M |
| 11 | Управляемые harness workflows используют `actions/upload-artifact@v4`, а весь остальной CI — `v7.0.1` | Low | S |
| 12 | Storybook в web рассинхронизирован: `storybook` 10.6.0 против `@storybook/*` 10.5.10 | Low | S |
| 13 | `packages/runtime-identity`: `.mjs` + рукописный `index.d.mts`, реализация против объявлений не проверяется | Low | S |
| 14 | `openapi-typescript-codegen` 0.31.0 даёт классы с parameter properties и мешает `erasableSyntaxOnly` в web. По моим данным автор объявил проект неподдерживаемым и рекомендует `@hey-api/openapi-ts`; это нужно перепроверить | Low | M |

## 1. Версии

### 1.1 Устаревшие прямые зависимости (pinned → latest stable)

`p/` = platform, `pk/` = packages. Пакеты, которые уже на последней стабильной версии, в таблицу не
вошли. Среди них `prisma`/`@prisma/*` 7.10.0: тег `latest` у prisma указывает на `8.0.0-rc.15`, а
последняя стабильная — 7.10.0.

| Пакет | Pinned | Latest | Разрыв | Где |
|---|---|---|---|---|
| `@nestjs/common` | 11.2.1 | 12.1.0 | MAJOR | p/apps/backend |
| `@nestjs/core` | 11.2.1 | 12.1.0 | MAJOR | p/apps/backend |
| `@nestjs/platform-fastify` | 11.2.1 | 12.1.0 | MAJOR | p/apps/backend |
| `@nestjs/swagger` | 11.4.7 | 12.0.2 | MAJOR | p/apps/backend |
| `amqplib` | 0.10.9 | 2.0.1 | MAJOR | p/apps/backend |
| `vitest` | 4.1.11 | 5.0.1 | MAJOR | p/apps/backend, p/apps/web, p/pk/access-capabilities, p/pk/legal, telegram |
| `@vitest/browser`, `@vitest/browser-playwright` | 4.1.11 | 5.0.1 | MAJOR | p/apps/web |
| `typescript` | 6.0.3 / ^6.0.3 | 7.0.2 | MAJOR | telegram, landing |
| `dotenv` | 17.4.2 | 18.0.3 | MAJOR | telegram |
| `oxc-parser` | 0.147.0 | 0.151.0 | MAJOR (0.x) | platform root |
| `@types/node` | 24.13.3 | 24.13.6 (26.6.2) | patch в линии 24 | все TS-пакеты platform, telegram |
| `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` | 3.1121.0 | 3.1139.0 | minor | p/apps/backend |
| `@modelcontextprotocol/{server,node,client}` | 2.0.0 | 2.1.0 | minor | p/apps/backend |
| `@nestjs/{common,core,platform-fastify,testing}` | 12.0.1 | 12.1.0 | minor | telegram |
| `@playwright/test` | 1.62.1 | 1.63.0 | minor | p/apps/web |
| `@storybook/{addon-a11y,addon-docs,addon-vitest,react-vite}` | 10.5.10 | 10.6.0 | minor | p/apps/web |
| `@tanstack/react-query` | 5.102.8 | 5.103.2 | minor | p/apps/web |
| `@tiptap/*` (7 пакетов) | 3.30.3 | 3.31.3 | minor | p/apps/web, p/pk/material-blocks |
| `react`, `react-dom` | 19.2.8 | 19.3.0 | minor | p/apps/web, landing |
| `@types/react`, `@types/react-dom` | 19.2.18 / 19.2.7 (^19.2.4 в landing) | 19.3.0 | minor | p/apps/web, landing |
| `agentation` | 3.0.2 | 3.1.2 | minor | p/apps/web, landing |
| `agentation-mcp` | ^1.2.0 | 1.3.2 | minor | landing |
| `astro` | ^7.2.2 (lock 7.2.2) | 7.3.5 | minor | landing |
| `eslint` | 10.9.1 | 10.11.0 | minor | telegram |
| `typescript-eslint` | 8.68.0 | 8.70.1 | minor | telegram |
| `globals` | 17.11.0 | 17.12.0 | minor | telegram |
| `fastify` | 5.11.3 | 5.12.5 | minor | p/apps/backend |
| `file-type` | 22.0.2 | 22.1.1 | minor | p/apps/backend |
| `lucide-react` | 1.34.0 | 1.48.0 | minor | p/apps/web |
| `oxlint` | 1.80.0 | 1.85.0 | minor | platform root |
| `pg-boss` | 12.27.0 | 12.34.0 | minor | p/apps/backend |
| `shadcn` | 4.19.0 | 4.21.0 | minor | p/apps/web |
| `tailwind-merge` | 3.6.0 | 3.7.0 | minor | p/apps/web |
| `undici` | 8.10.2 | 8.11.2 | minor | p/apps/backend |
| `vite` | 8.2.2 | 8.3.1 | minor | p/apps/web |
| `zod` | 4.4.3 | 4.6.5 | minor | 6 мест в platform |
| `fastify` | 5.12.1 | 5.12.5 | patch | telegram |
| `@fastify/multipart` / `@fastify/static` | 10.1.1 / 10.1.3 | 10.1.2 / 10.1.4 | patch | p/apps/backend |
| `@logto/next` / `@logto/node` | 4.2.10 / 3.1.10 | 4.2.11 / 3.1.11 | patch | p/apps/web, platform root |
| `@nestjs/config` | 12.0.0 | 12.0.1 | patch | p/apps/backend |
| `jose` | 6.2.10 | 6.2.12 | patch | platform root, p/apps/backend |
| `kysely` | 0.29.5 | 0.29.6 | patch | telegram |
| `next` | 16.3.4 | 16.3.6 | patch | p/apps/web |
| `nodemailer` / `@types/nodemailer` | 10.0.0 / 8.0.1 | 10.0.10 / 8.0.2 | patch | p/apps/backend |
| `oxlint-tsgolint` | 7.0.2001 | 7.0.2002 | patch | platform root |
| `prettier` | 3.9.6 | 3.9.9 | patch | telegram |
| `tsx` | 4.23.12 | 4.23.15 | patch | p/apps/backend, telegram |

Итог: 12 major (включая TS в двух репозиториях и vitest в пяти пакетах), около 45 minor, около 15
patch. Устаревших на момент обзора (deprecated) пакетов npm не нашёл. У `platform` и `telegram`
стоит `minimumReleaseAge: 1440`: версии моложе суток (next 16.3.6, undici 8.11.2, vite 8.3.1, astro
7.3.5, lucide 1.48.0 от 2026-09-24) pnpm поставит только завтра. Это ожидаемо.

### 1.2 Рантайм, пакетный менеджер, образы, CI

| Что | platform | telegram | landing | Latest | Severity |
|---|---|---|---|---|---|
| Node (`.node-version` / CI) | 24.19.0 | 24.20.0 | CI `22.23.1`, engines `>=22.12.0 <23` | 24.21.0 (LTS Krypton); 26.10.0 Current, LTS ожидается в конце октября 2026 | Medium |
| `engines` | нет (при `engineStrict: true`) | `24.x` | `<23` | — | Low |
| `packageManager` | `pnpm@11.22.0` | `pnpm@11.22.0` | npm, lockfile v3 | pnpm 11.27.1 / **12.6.0** | Low (minor), Medium (12 — отдельная задача) |
| Версии зависимостей | exact (`saveExact: true`) | exact | `^` у всех | — | Medium |
| Базовый образ Node | `node:24.19.0-alpine3.23`, без digest; pnpm через corepack | `node:24.20.0-bookworm-slim`, без digest; `npm i -g pnpm` | — | `24.21.0-alpine3.24`, `24.21.0-trixie-slim` | Low |
| Прочие образы | `postgres:18.4-alpine3.23@sha256`, `logto:1.41.0@sha256`, `rabbitmq:4.2.4-management-alpine` | — | — | logto v1.43.0; rabbitmq 4.2.9 / 4.3.6 | Low |
| Go (`tools/workshop-evaluator`) | `go 1.26.0`, локально go1.26.4 | — | — | go1.27.1; x/text v0.14.0 → v0.42.0, regexp2 1.11.0 → 1.12.0 (indirect) | Low |
| `actions/checkout` | v7.0.1 (тег) | v7.0.1 (SHA) | `@v7` (плавающий) | v7.0.1 | Low (разная политика пинов) |
| `actions/setup-node` | v7.0.0 | v7.0.0 (SHA) | `@v7` | v7.0.0 | — |
| `actions/upload-artifact` | v7.0.1; **v4** в harness workflows | **v4** в harness | **v4** в harness | v7.0.1 | Low; правка в `inside/harness/packages/inside-engineering/github/*.yml` |
| `pnpm/action-setup` | v6.0.10 | — | — | v6.1.0 | Low |
| `docker/build-push-action` / `setup-buildx-action` / `login-action` | v7.3.0 / v4.3.0 / v4.6.0 | — | — | v7.4.0 / v4.4.1 / v4.6.0 | Low |

### 1.3 Несогласованность между репозиториями

| Тема | platform | telegram | landing | Рекомендация |
|---|---|---|---|---|
| NestJS | 11.2.1 (config 12.0.0) | 12.0.1 | — | Перевести обоих на 12.1.x одной волной, telegram взять за образец |
| TypeScript | 7.0.2 | 6.0.3 | ^6.0.3 | 7.x везде, где инструменты позволяют (блокеры ниже) |
| fastify | 5.11.3 | 5.12.1 | — | 5.12.5. В Nest 12 `@nestjs/platform-fastify@12.1.0` жёстко зависит от `fastify@5.12.5`; прямой pin должен совпадать, иначе в дереве окажутся два экземпляра fastify |
| amqplib | 0.10.9 + `@types/amqplib` | 2.0.1 (свои типы) | — | 2.0.x везде, `@types/amqplib` убрать |
| Линтер | oxlint + tsgolint (type-aware) | eslint 10 + typescript-eslint `recommended` (без типов) | нет | oxlint + tsgolint везде |
| Форматтер | нет | prettier 3.9.6 (дефолтный конфиг) | нет | Один форматтер везде |
| Пакетный менеджер | pnpm 11.22.0 | pnpm 11.22.0 | npm | pnpm везде |
| Пины | exact | exact | caret | exact везде |
| Node | 24.19.0, alpine | 24.20.0, debian bookworm | 22.23.1 | 24.21.0 везде, одна ОС образов, digest-пины |
| Пины Actions | теги | SHA | плавающие мажоры | SHA + комментарий с версией (как в telegram) |

### 1.4 Кандидаты на замену и лишние зависимости

| Пакет | Вывод |
|---|---|
| `dotenv` (telegram, 5 импортов: `dotenv/config` + `parse` в preflight) | В Node 24 есть `process.loadEnvFile()`, `util.parseEnv()` и `--env-file-if-exists`. Зависимость можно убрать вместо перехода на 18. Low, S |
| `reflect-metadata`, `rxjs` | Остаются обязательными: у `@nestjs/core@12.1.0` и `@nestjs/common@12.1.0` это peerDependencies (`rxjs ^7.1.0`, `reflect-metadata ^0.1.12 \|\| ^0.2.0`). Убрать нельзя |
| `@types/amqplib` | Не нужен после перехода на amqplib 2.x (в пакете есть `types: ./index.d.ts`) |
| `openapi-typescript-codegen` | Генерирует классы с parameter properties: 26 из 27 ошибок `erasableSyntaxOnly` в web приходятся на `generated/`. Альтернатива — `@hey-api/openapi-ts` 0.99.0 (0.x, API меняется) |
| `tsx` для dev/скриптов | Node 24 умеет снимать типы сам, но Nest-код с `experimentalDecorators` так не запустится. `tsx` оставить для backend. Для новых `.ts`-скриптов без декораторов хватит `node file.ts` |
| `proper-lockfile` 4.1.2 (2022), `class-variance-authority` 0.7.1 (2024), `server-only` 0.0.1 | Не обновлялись давно, но заменять незачем. Мониторить |
| `@nestjs/config` 12.0.0 на Nest 11 | peer `^11 \|\| ^12`, работает. После Nest 12 версии совпадут |

### 1.5 Риски major-переходов

| Переход | Что известно | Риск |
|---|---|---|
| Nest 11 → 12 (platform) | Все `@nestjs/*` 12 вышли как `"type": "module"`, то есть только ESM. Backend уже `"type": "module"`, это снимает главный барьер. `@nestjs/core` 12 требует Node ≥ 20. `@nestjs/common` 12 тянет `@standard-schema/spec` и `file-type@22.1.1`. `@nestjs/platform-fastify` 12 требует `@fastify/static ^10.1.2` и `@fastify/multipart ^10.1.0`: текущие 10.1.3 / 10.1.1 подходят. **Блокер:** у `@nestjs/swagger@12.0.2` peer `typescript: ^5.5.0 \|\| ^6.0.0`, а в platform стоят TS 7.0.2 и `strictPeerDependencies: true`. Без `peerDependencyRules.allowedVersions` в `pnpm-workspace.yaml` установка упадёт. Полный список изменений 12.0 не читал; нужно пройти migration guide на docs.nestjs.com. Telegram уже на 12 и служит рабочим примером | High |
| amqplib 0.10 → 2.0 (platform) | Два файла: `notification-transport/rabbitmq.ts` и `worker.ts`. Точный список breaking changes не проверял. Практичный путь — повторить адаптер telegram (`src/adapters/amqp/notification-broker.ts`), который уже работает на 2.0.1. По памяти у notification-transport в CI есть нестабильные краш-тесты | Medium |
| TS 6 → 7 (telegram) | Блокер: `typescript-eslint <6.1.0`. Сначала переносим линт на oxlint + tsgolint, потом поднимаем TS. `experimentalDecorators`/`emitDecoratorMetadata` в TS 7 работают: platform backend на Nest собирается на 7.0.2 | Medium |
| TS 6 → 7 (landing) | Блокер: `@astrojs/check@0.9.10` peer `typescript ^5 \|\| ^6`. Остаёмся на 6.x, пока Astro не поддержит 7 | Low |
| vitest 4 → 5 | 5.0.1 вышла 2026-09-15; engines `^22.12 \|\| ^24 \|\| >=26`. Breaking changes не изучал. Затронуты 5 пакетов плюс storybook addon-vitest и browser-режим web. Переводить одной волной во всех репозиториях | Medium (неизвестность) |
| dotenv 17 → 18 | Проще удалить (см. 1.4) | Low |
| pnpm 11 → 12 | Не изучал. Возможны изменения формата lockfile и настроек `allowBuilds`/`minimumReleaseAge`. Отдельная задача после остальных | Medium (неизвестность) |
| Node 24 → 26 | 26 станет LTS примерно в конце октября 2026. Тогда поднимать вместе с `@types/node@26`. До этого держать `@types/node` в линии 24.x, под рантайм | Low сейчас |
| Prisma 7 → 8 | Пока RC (`8.0.0-rc.15`), ждать GA | — |
| React 19.2 → 19.3 | Minor. Поднимать вместе с `@types/react*` 19.3, прогнать Storybook и e2e | Low |

## 2. Строгость TypeScript

### 2.1 Все tsconfig и эффективные флаги

Условные обозначения: ✓ включено, ✗ выключено, «—» не применимо, `(s)` включено через `strict`.

| Флаг | backend `tsconfig.json` (+build, production, test) | web `tsconfig.json` (+next) | access-capabilities / legal (json + build) | material-blocks | telegram `tsconfig.json` (+build) | landing (`astro/tsconfigs/strict`) |
|---|---|---|---|---|---|---|
| strict | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| noUncheckedIndexedAccess | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| exactOptionalPropertyTypes | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| noImplicitOverride | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| noPropertyAccessFromIndexSignature | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| noFallthroughCasesInSwitch | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| noImplicitReturns | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| noUnusedLocals / noUnusedParameters | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| allowUnreachableCode:false / allowUnusedLabels:false | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| useUnknownInCatchVariables | (s) | (s) | (s) | (s) | (s) | (s) |
| noUncheckedSideEffectImports | ✓ | ✓ | ✓ | ✓ | не задан | не задан |
| verbatimModuleSyntax | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| isolatedModules | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ |
| erasableSyntaxOnly | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| isolatedDeclarations | — | — | ✗ | ✗ | — | — |
| module / moduleResolution | NodeNext / NodeNext | esnext / bundler | NodeNext / NodeNext | NodeNext / NodeNext | NodeNext / NodeNext | ESNext / Bundler |
| target / lib | ES2023 / ES2023 | ES2022 / dom, dom.iterable, esnext | ES2023 / ES2023 | ES2023 / ES2023 | ES2023 / (по target) | ESNext / (по target) |
| skipLibCheck | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Прочее | experimentalDecorators + emitDecoratorMetadata, incremental | incremental, next plugin, `allowJs:false` | декларации дублируются в build-файлах | declaration | experimentalDecorators + emitDecoratorMetadata, `declaration:true` у приложения, лишние `allowSyntheticDefaultImports` и `useDefineForClassFields` | allowJs, allowImportingTsExtensions |

Ещё два конфига: `apps/backend/test/guardrails/fixtures/typescript/tsconfig.json` (фикстура) и
`packages/runtime-identity`, у которого tsconfig нет вовсе (`.mjs` + рукописный `.d.mts`).

Наблюдения:

- В platform 7 файлов повторяют один и тот же набор флагов, `extends` нет. Любое ужесточение придётся
  вносить 7 раз. Medium, S.
- `lib: esnext` в web разрешает API, которых может не быть в целевых браузерах. Лучше фиксированный
  `es2024`. Low.
- Node 24 поддерживает ES2024 полностью, поэтому `target/lib ES2024` безопасен. ES2025 (Iterator
  helpers, Set methods, `Promise.try`) в V8 13.x Node 24, по моим данным, тоже есть, но это стоит
  проверить до перехода. Low.

### 2.2 Замеры в platform (TS 7.0.2, число ошибок на каждый добавленный флаг)

| Конфиг | base | unused (Locals+Params) | noPropertyAccessFromIndexSignature | verbatimModuleSyntax | isolatedModules | erasableSyntaxOnly | unreachable/labels | isolatedDeclarations |
|---|---|---|---|---|---|---|---|---|
| apps/backend/tsconfig.json | 0 | **1** | 203 | **0** | **0** | 173 | **0** | — |
| apps/backend/test/tsconfig.json | 0 | **1** | 283 | **0** | **0** | 175 | **0** | — |
| apps/web/tsconfig.json | 5* | **0** | 185 | **0** | (уже вкл.) | 27 (26 в generated) | **0** | — (2632, не нужно приложению) |
| packages/access-capabilities | 0 | **0** | **0** | **0** | **0** | **0** | **0** | 11 |
| packages/legal | 0 | **0** | 10 | **0** | **0** | **0** | **0** | **0** |
| packages/material-blocks | 0 | **0** | 62 | **0** | **0** | **0** | **0** | 22 |

\* 5 базовых ошибок в web вызваны средой: устаревшие `.next/types` (2× TS2307 на удалённые маршруты)
и 3× TS2769 в `catalog-cache.server.ts`, которые, вероятно, исчезнут после `next typegen`. Штатный
`typecheck` сначала вызывает `next typegen`. Я его не запускал, чтобы не писать в дерево.

Разбор:

- **Бесплатно** (0–1 ошибка): `verbatimModuleSyntax`, `isolatedModules`, `noUnusedLocals/Parameters`
  (единственная ошибка — неиспользуемый `actorId` в `billing/features/execute-refund/execute-refund.ts:29`),
  `allowUnreachableCode:false`, `allowUnusedLabels:false`. Для пакетов бесплатен и `erasableSyntaxOnly`.
- **Дёшево**: `isolatedDeclarations` в пакетах — 33 ошибки (TS9010/9013: явные типы у экспортов).
  Даёт быструю и независимую генерацию `.d.ts`.
- **erasableSyntaxOnly в backend: не включать.** 173 + 175 ошибок — это parameter properties в
  DI-конструкторах Nest (`constructor(private readonly …)`, `@Inject(TOKEN) private readonly …`).
  Legacy-декораторы всё равно не снимаются нативным type stripping Node, так что выигрыша нет.
  В web 26 из 27 ошибок в сгенерированном клиенте. После замены генератора флаг можно включить.
- **noPropertyAccessFromIndexSignature**: 743 ошибки в сумме. Правка механическая
  (`process.env.X` → `process.env["X"]`, `node.attrs.x`), основная масса в `backend/src/config` (68),
  `backend/scripts` (53) и `materials/domain/material-body` (40). В паре с `noUncheckedIndexedAccess`
  флаг только делает доступ по индексу визуально заметным. Ценность умеренная, делать последним.
- `noUncheckedIndexedAccess --exactOptionalPropertyTypes` из задания в platform уже включены везде.

Telegram (не замерялось, оценка): `exactOptionalPropertyTypes` — вероятно десятки–сотня ошибок на
22k LOC src + 15k LOC test. Это оценка, не замер. `noImplicitReturns` — единицы.
`verbatimModuleSyntax` — близко к 0, так как `consistent-type-imports` уже в линте.
Landing (15 файлов, 783 LOC): переход на `astro/tsconfigs/strictest` — ожидаемо единицы ошибок.

### 2.3 Предлагаемый общий strict-base

Отдельного общего пакета между репозиториями нет, поэтому один канонический файл нужно
синхронизировать: либо через harness lifecycle, либо через guardrail-проверку, что копия совпадает.
В platform: `tsconfig.base.json` в корне и три пресета.

```jsonc
// tsconfig.base.json — канон для platform и telegram
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "allowUnreachableCode": false,
    "allowUnusedLabels": false,
    "noUncheckedSideEffectImports": true,
    // Фаза 5, после codemod: "noPropertyAccessFromIndexSignature": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "target": "ES2024",
    "lib": ["ES2024"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": []
  }
}
```

```jsonc
// tsconfig.node-lib.json — packages/*
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "erasableSyntaxOnly": true,
    "isolatedDeclarations": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

```jsonc
// tsconfig.nest-app.json — apps/backend, telegram
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "sourceMap": true,
    "types": ["node"]
  }
}
```

```jsonc
// tsconfig.next-app.json — apps/web
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["dom", "dom.iterable", "ES2024"],
    "jsx": "react-jsx",
    "noEmit": true,
    "allowJs": false,
    "plugins": [{ "name": "next" }]
    // после замены openapi-генератора: "erasableSyntaxOnly": true
  }
}
```

Landing: `"extends": "astro/tsconfigs/strictest"` плюс `"noUncheckedSideEffectImports": true`.

Каждый пакет: `{"extends": "../../tsconfig.node-lib.json", "compilerOptions": {"rootDir": "src", "outDir": "dist", "types": [...]}}`.
Build-варианты перестают дублировать флаги.

Для `.mjs` в platform (111 файлов, ~15k LOC): переписать в `.ts` с `erasableSyntaxOnly` и запускать
`node file.ts` на Node 24. Минимальный вариант — `tsconfig.scripts.json` с `allowJs`, `checkJs`,
`noEmit` в `pnpm typecheck`.

## 3. Линтинг

### 3.1 Текущее состояние

**platform, `.oxlintrc.json`** (oxlint 1.80 + tsgolint 7.0.2001, `options.typeAware: true`,
`--deny-warnings --report-unused-disable-directives`):

- На верхнем уровне `categories.correctness: "off"`. Вместо категории перечислены около 60 правил
  eslint-core и около 20 typescript, то есть `recommended` вручную. Плагины `unicorn`, `import`,
  `promise`, `node`, `vitest`, `jsx-a11y`, `oxc` не подключены. `react`/`nextjs` включены только для web,
  `import` — только для stories.
- Type-aware набор (около 70 правил `typescript/*`) задан двумя почти одинаковыми overrides на 95 и
  132 правила: `apps/backend/**` + `packages/material-blocks/**` и `apps/web/**`. Включено всё
  существенное: `no-floating-promises`, `no-misused-promises`, `no-unsafe-*` (все шесть),
  `switch-exhaustiveness-check`, `no-deprecated`, `restrict-*` в строгой форме, `only-throw-error`,
  `no-non-null-assertion`, `no-explicit-any`, `ban-ts-comment` (описание от 10 символов),
  `consistent-type-imports`, `return-await`.
- Расхождения backend и web: в backend выключены `no-confusing-void-expression`,
  `no-misused-spread`, `prefer-nullish-coalescing`, `consistent-type-definitions`,
  `consistent-indexed-object-style`; `restrict-template-expressions` разрешает number.
  `no-unsafe-type-assertion` включён только в backend. В web его нет, замер: 72 нарушения
  (27 src, 45 test).
- **Дыра:** `packages/legal`, `packages/access-capabilities`, `.mjs`-скрипты и `tools/` получают
  только базовые правила, без type-aware. Замер с backend-набором на двух пакетах: 0 нарушений.
- Архитектурные границы (FSD-слои web, domain/infrastructure backend) закрыты через
  `no-restricted-imports`. Это сильная сторона.
- Директивы подавления в разных стилях: `oxlint-disable`, `eslint-disable`,
  `next/no-img-element` и `react-hooks/exhaustive-deps` (имена в стиле ESLint). Часть
  `oxlint-disable-next-line typescript/no-unsafe-type-assertion` в backend domain без пояснения.

**telegram, `eslint.config.mjs`**: `@eslint/js recommended` + `tseslint.configs.recommended` +
`consistent-type-imports`. Не `strictTypeChecked` и вообще без типов: нет `parserOptions.projectService`,
нет `no-floating-promises`, `no-unsafe-*`, `no-non-null-assertion`. Используется `tseslint.config()`,
который в новых typescript-eslint заменён на `defineConfig` из `eslint/config`. Prettier с
дефолтным конфигом, `format:check` в `pnpm check`. **High** для NestJS-сервиса с grammY и RabbitMQ:
плавающие промисы — основной класс дефектов, и он не ловится.

**landing**: только `astro check`, линтера и форматтера нет.

### 3.2 Замер дополнительных type-aware правил в platform

Нарушения при добавлении правила через `-D` (apps + packages):

| Правило | Всего | backend src | backend test+scripts | web src | web прочее | Рекомендация |
|---|---|---|---|---|---|---|
| `strict-boolean-expressions` | 277 | 92 | 60 | 79 | 46 | Включить с `allowNullableObject: true`, `allowString: false`, `allowNumber: false`. Фаза 5, M |
| `no-unnecessary-condition` | 68 | 14 | 24 | 22 | 8 | Включить. S–M |
| `prefer-optional-chain` | 24 | 20 | 1 | 3 | 0 | Включить (autofix). S |
| `require-array-sort-compare` | 5 | 2 | 2 | 0 | 1 | Включить. S |
| `prefer-nullish-coalescing` (backend) | ≥5 | — | 2 | — | 3 | Включить и в backend. S |
| `no-unsafe-type-assertion` (web) | 72 | — | — | 27 | 45 | Включить в web, как в backend. M |
| `consistent-return` | 70 | 15 | 8 | 47 | 0 | Опционально |
| `strict-void-return` | 171 | 3 | 34 | 120 | 14 | Опционально. В web много `onClick={() => mutate()}` |
| `explicit-module-boundary-types` | 733 | 261 | 6 | 423 | 43 | Не для приложений. Для пакетов вместо него `isolatedDeclarations` |
| `explicit-function-return-type` | 1942 | — | — | — | — | Не включать: шум |
| `promise-function-async` | 1504 | — | — | — | — | Не включать: шум |
| `prefer-readonly`, `consistent-type-exports`, `no-misused-spread` | 0 | | | | | Включить бесплатно |
| `no-confusing-void-expression` | 5 (4 в packages) | | | | | Включить и в backend |

Для правил, которые backend-override выключает явно (`no-misused-spread`,
`no-confusing-void-expression`, `prefer-nullish-coalescing`), флаг `-D` перекрывается override, так что
замер по backend там неполный.

### 3.3 Предлагаемая единая строгая конфигурация

Один инструмент на все три репозитория: **oxlint + oxlint-tsgolint (type-aware)**. Это главный
выход: telegram на typescript-eslint не может перейти на TS 7.

Структура: `oxlint/base.json`, общий канон, синхронизируется как tsconfig-base. Каждый репозиторий
делает `extends` и добавляет свои границы (`no-restricted-imports`) и плагины окружения.

```jsonc
// .oxlintrc.base.json (канон)
{
  "plugins": ["typescript", "unicorn", "import", "promise", "node", "vitest", "oxc"],
  "categories": { "correctness": "error", "suspicious": "error", "perf": "warn" },
  "options": { "typeAware": true },
  "rules": {
    // type-aware ядро: текущий web-набор плюс то, что есть только в backend
    "typescript/no-floating-promises": "error",
    "typescript/no-misused-promises": "error",
    "typescript/await-thenable": "error",
    "typescript/no-unsafe-argument": "error",
    "typescript/no-unsafe-assignment": "error",
    "typescript/no-unsafe-call": "error",
    "typescript/no-unsafe-member-access": "error",
    "typescript/no-unsafe-return": "error",
    "typescript/no-unsafe-type-assertion": "error",
    "typescript/no-explicit-any": "error",
    "typescript/no-non-null-assertion": "error",
    "typescript/switch-exhaustiveness-check": ["error", { "considerDefaultExhaustiveForUnions": false, "requireDefaultForNonUnion": true }],
    "typescript/no-deprecated": "error",
    "typescript/only-throw-error": "error",
    "typescript/prefer-promise-reject-errors": "error",
    "typescript/restrict-template-expressions": ["error", { "allowNumber": false, "allowBoolean": false, "allowNullish": false, "allowAny": false, "allowRegExp": false, "allowNever": false }],
    "typescript/restrict-plus-operands": ["error", { "allowAny": false, "allowBoolean": false, "allowNullish": false, "allowNumberAndString": false, "allowRegExp": false }],
    "typescript/return-await": ["error", "error-handling-correctness-only"],
    "typescript/no-unnecessary-condition": "error",
    "typescript/no-unnecessary-type-assertion": "error",
    "typescript/prefer-optional-chain": "error",
    "typescript/prefer-nullish-coalescing": "error",
    "typescript/require-array-sort-compare": "error",
    "typescript/no-misused-spread": "error",
    "typescript/no-confusing-void-expression": "error",
    "typescript/prefer-readonly": "error",
    "typescript/consistent-type-imports": "error",
    "typescript/consistent-type-exports": "error",
    "typescript/ban-ts-comment": ["error", { "minimumDescriptionLength": 10 }],
    "typescript/use-unknown-in-catch-callback-variable": "error",
    // фаза 5:
    "typescript/strict-boolean-expressions": ["error", { "allowString": false, "allowNumber": false, "allowNullableObject": true }],
    // гигиена
    "unicorn/prefer-node-protocol": "error",
    "import/no-cycle": "error",
    "promise/no-multiple-resolved": "error",
    "vitest/no-focused-tests": "error",
    "vitest/expect-expect": "error",
    "oxc/no-barrel-file": "off",
    "eslint/no-console": ["error", { "allow": ["warn", "error"] }]
  },
  "overrides": [
    { "files": ["**/*.test.ts", "**/test/**"], "rules": { "typescript/no-unsafe-type-assertion": "warn" } },
    { "files": ["**/generated/**"], "rules": { "typescript/no-explicit-any": "off", "typescript/no-unsafe-*": "off" } }
  ]
}
```

Опции `switch-exhaustiveness-check` и строки `no-console`, `import/no-cycle` помечены для проверки
на реальном коде. `import/no-cycle` медленный. Точные имена опций сверить со схемой tsgolint 7.0.2002.

- **platform:** переписать на `extends` базы. Два дублирующих override (95 и 132 правила) сойдутся
  в один. Добавить в type-aware область `packages/**` (0 нарушений), включить в web
  `no-unsafe-type-assertion`, в backend — три выключенных правила. Директивы подавления привести к
  `oxlint-disable-next-line <plugin>/<rule> -- причина`.
- **telegram:** заменить eslint + typescript-eslint на oxlint + tsgolint с базой. Ожидаемый объём
  по счётчикам гигиены: ≥317 `no-non-null-assertion` (146 src, 171 test) и до ~285 кандидатов
  `no-unsafe-type-assertion`; плюс неизвестное число `no-floating-promises` (не замерялось).
  Это разблокирует TS 7. Effort M–L.
- **landing:** oxlint с базой без type-aware для `.astro` (oxlint разбирает только script-части).
  `astro check` остаётся проверкой типов. Effort S.
- **Форматтер:** один на всех. Prettier 3.9.x — стабильный вариант (telegram уже на нём).
  `oxfmt` 0.70.0 совместим с Prettier и заметно быстрее на ~150k LOC platform, но это ещё 0.x.
  Рекомендую Prettier сейчас, oxfmt — после 1.0. Первое форматирование platform сделать отдельным
  коммитом и добавить его в `.git-blame-ignore-revs`.

## 4. Гигиена типов (счётчики, приблизительно)

Исключены `node_modules`, `dist`, `.next`, `generated`, `fixtures`, `*.d.ts`. `as_casts` — `as X`
без `as const` и без строк import/export.

| Пакет | Файлов | LOC | `: any` | `as any` | `as` (≈) | `as unknown as` | non-null `!` | `@ts-ignore` | `@ts-expect-error` | lint-disable |
|---|---|---|---|---|---|---|---|---|---|---|
| platform/apps/backend/src | 646 | 57 645 | 0 | 0 | 313 | 0 | 0 | 0 | 0 | 12 |
| platform/apps/backend/test | 171 | 40 765 | 0 | 0 | 92 | 7 | 0 | 0 | 1 | 15 |
| platform/apps/backend/scripts | 12 | 2 706 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 |
| platform/apps/web/src | 693 | 65 104 | 0 | 0 | 51 | 0 | 0 | 0 | 0 | 6 |
| platform/apps/web/test | 107 | 18 862 | 1 | 0 | 88 | 10 | 0 | 0 | 0 | 0 |
| platform/packages/legal/src | 21 | 2 528 | 0 | 0 | 8 | 0 | 0 | 0 | 0 | 0 |
| platform/packages/material-blocks/src | 28 | 1 787 | 0 | 0 | 11 | 1 | 0 | 0 | 0 | 1 |
| platform/packages/access-capabilities/src | 2 | 213 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| telegram/src | 126 | 21 868 | 0 | 0 | 190 | 1 | **146** | 0 | 0 | 0 |
| telegram/test | 48 | 15 491 | 0 | 1 | 95 | 8 | **171** | 0 | 0 | 1 |
| telegram/scripts | 3 | 413 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| landing/app/src | 15 | 783 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |

Выводы:

- В platform гигиена образцовая: `any` и non-null практически отсутствуют, `@ts-ignore` нет.
  Это результат `no-explicit-any`, `no-non-null-assertion` и `ban-ts-comment`. Из 12 disable в backend src
  10 — `no-unsafe-type-assertion` в фабриках branded ID (`accounts/domain/account-identifiers.ts`,
  `member-profiles/domain/*-id.ts`, `materials/domain/material-identifiers.ts`) без пояснения.
  Паттерн лучше вынести в одну функцию `brand<T>()` с одним подавлением.
- В telegram 146 non-null в src сосредоточены в `modules/communications/author-*.ts`
  (`s.funnel!`, `s.intro!`). Типичная реакция на `noUncheckedIndexedAccess` без запрещающего правила.
  Это состояние сессии бота, которое стоит сузить дискриминированным union.
- `as unknown as`: 17 в тестах platform, 9 в telegram — в тестовых дублях, приемлемо.

## 5. План обновлений по порядку

| Фаза | Что | Вместе с | Риск | Effort |
|---|---|---|---|---|
| **0. Гигиена версий** (сразу, после суточной выдержки) | Все patch/minor из 1.1: zod 4.6.5, tiptap 3.31.3, `@storybook/*` → 10.6.0 (синхронно со `storybook`), react/react-dom/@types 19.3.0, next 16.3.6, aws-sdk, pg-boss, undici, MCP 2.1.0, oxlint 1.85 + tsgolint 7.0.2002, fastify 5.12.5 в обоих репозиториях, telegram Nest 12.1.0, `@types/node` 24.13.6, tsx, prettier. Node 24.21.0 в `.node-version` обоих, Dockerfile (`24.21.0-alpine3.24` / `trixie-slim`) и landing CI. pnpm 11.27.1 во всех местах: `packageManager`, Dockerfile, telegram Dockerfile. Actions: pnpm/action-setup 6.1.0, build-push 7.4.0, setup-buildx 4.4.1. Go 1.27 + `go get -u` indirect. Для platform отдельно Nest 11.2.6 как страховка до фазы 2 | Один PR на репозиторий | Low | S |
| **1. Бесплатная строгость** | Общий `tsconfig.base.json` + пресеты (2.3). Включить `verbatimModuleSyntax`, `isolatedModules`, `noUnused*` (1 правка), `allowUnreachableCode:false`, `allowUnusedLabels:false`. В пакетах `erasableSyntaxOnly` + `isolatedDeclarations` (33 правки). В `.oxlintrc.json` расширить type-aware override на `packages/**`. Landing → `astro/tsconfigs/strictest`. `upload-artifact@v4→v7.0.1` в каноническом пакете harness | — | Low | S |
| **2. Nest 12 + amqplib 2 в platform** | `@nestjs/{common,core,platform-fastify}` 12.1.x, `@nestjs/swagger` 12.0.2, `@nestjs/config` 12.0.1, fastify ровно как в platform-fastify. `peerDependencyRules.allowedVersions: { "@nestjs/swagger>typescript": "7" }` в `pnpm-workspace.yaml`. amqplib 2.0.1 по образцу telegram, удалить `@types/amqplib`. Прогнать `check:full`, integration и `smoke:fullstack`; по памяти проекта полный прогон эксклюзивный | Nest и amqplib — отдельные PR; swagger обязательно вместе с core | High (swagger peer, OpenAPI-генерация `api:check`) | L |
| **3. Telegram: линт → oxlint, затем TS 7** | Шаг 1: oxlint + tsgolint с базой, исправить non-null (317) и плавающие промисы. Шаг 2: tsconfig на base (`exactOptionalPropertyTypes`, `noImplicitReturns`). Шаг 3: TypeScript 7.0.2. Удалить `dotenv` → `process.loadEnvFile()` / `util.parseEnv` | Шаги строго по очереди | Medium | M–L |
| **4. Landing: выравнивание** | pnpm + exact pins, Node 24 (engines `24.x`), oxlint, prettier. TS остаётся 6.x, пока `@astrojs/check` не поддержит 7 | — | Low | S |
| **5. Строгий линт и хвосты** | Правила из 3.2: `no-unnecessary-condition` (68), `prefer-optional-chain` (24), `require-array-sort-compare` (5), `no-unsafe-type-assertion` в web (72), затем `strict-boolean-expressions` (277). Codemod под `noPropertyAccessFromIndexSignature` (743). Замена `openapi-typescript-codegen` → включить `erasableSyntaxOnly` в web. `.mjs` → `.ts` или `checkJs` (~15k LOC). `runtime-identity` в TS-пакет. Форматтер в platform | По одному правилу на PR | Low | M–L |
| **6. Мажоры с неизвестностью** | vitest 5 во всех репозиториях одной волной (вместе с `@vitest/browser*` и `@storybook/addon-vitest`). pnpm 12. Сначала прочитать migration guides | vitest — везде одновременно | Medium | M |
| **7. По календарю** | Node 26 LTS (конец октября 2026) + `@types/node@26` + образы. Prisma 8 после GA. TS 7 в landing, когда появится поддержка в Astro | — | Medium | M |

Порядок объясняется так. Фаза 0 снижает разрыв и делает следующие диффы маленькими. Фаза 1 почти
ничего не стоит и закрепляет строгость до большого рефакторинга. Nest 12 идёт раньше telegram TS 7,
потому что это единственная high-severity рассинхронизация между сервисами. Telegram-линт стоит
раньше его TS 7, потому что typescript-eslint прямо блокирует TS 7.

## Границы достоверности

- Замеры компилятора и линтера есть только для platform на локальном `main`, который отстаёт от
  origin на 3 коммита. Telegram и landing не замерялись: нет `node_modules`, установка вне рамок обзора.
- Счётчики гигиены получены регулярными выражениями. `as` и `!` могут давать ложные срабатывания
  в строках и комментариях.
- Breaking changes в Nest 12, amqplib 2, vitest 5 и pnpm 12 известны мне частично. Выше отмечено, что
  подтверждено через `npm view`: peers, `type`, engines. Остальное нужно перепроверить по changelog.
- Правила oxlint, которые переопределены в backend-override, через `-D` не замеряются полностью.
