# Platform full-stack readiness audit

Статус: delivery recommendation для
[Platform #80](https://github.com/sachkov-inside/platform/issues/80), 2026-08-24.
Проверен commit `5a3786198d7eb63fd10ef2c9581ea96b075b7a9d`.

## Короткий ответ владельцу

Platform уже имеет хороший **архитектурный фундамент**, но ещё не готова к поточной разработке
полных product features без дополнительной настройки delivery-контура.

- Backend — не заготовка: это модульный NestJS application с Material domain/application слоями,
  Kysely/PostgreSQL, migrations, real integration tests и архитектурными guardrails.
- Frontend — не «отсутствует», но пока является foundation: Next.js App Router, FSD-compatible
  layout, accepted Storybook UI, accessibility/E2E tooling и shell. Production pages пока не
  загружают product data и не реализуют законченные user journeys.
- Локальная разработка документирована, однако обычный `pnpm dev:api` сейчас падает на реальном
  `GET /health`. Green repository checks этого не обнаруживают.
- CI и локальные gates расходятся: CI не запускает часть проверок, входящих в `pnpm check`, а
  `pnpm check` не включает real-PostgreSQL integration suite и внешний smoke живого dev process.
- Observability пока минимальна: application возвращает correlation IDs, но нет сквозного request
  context, structured logging contract, metrics/tracing или доказанной связи user-facing error с
  диагностической записью.
- Graphify/Serena сейчас не устраняют главный bottleneck. Repository ещё небольшой, а оба tool
  имеют конкретные несовместимости с текущим TypeScript workspace. AI-first foundation сейчас —
  понятные задачи, глубокие public interfaces, executable guardrails и воспроизводимый full-stack
  workflow.

Первый product milestone после исправления окружения — **один законченный Material Reader**:
production URL, реальный Nest/PostgreSQL read path, SSR, принятый UI, loading/not-found/error states,
accessibility и full-stack E2E в одном delivery slice. Текущая схема «временный UI в #67, затем
замена в #37» создаёт лишнюю реализацию. Текущий frontend delivery contract требует этот split;
заменить его одним vertical issue можно только после отдельного owner-approved изменения правила.

## Что было проверено

### Репозиторий и test gates

На pinned Node `24.19.0` успешно выполнены:

```text
pnpm install --frozen-lockfile
pnpm check
pnpm test:integration
pnpm infra:up
pnpm --filter @inside/backend db:migrate
pnpm smoke:health
```

`pnpm check` подтвердил lint, strict typecheck, backend architecture guardrails, 41 backend tests,
27 web/Storybook tests, 26 Playwright desktop/mobile scenarios, production builds и Storybook build.
Real PostgreSQL integration suite подтвердила 22 scenarios в 5 files. In-process health smoke с
Compose PostgreSQL прошёл 2/2.

После проверки Compose был остановлен через `pnpm infra:down`; shared environment не оставлен
занятым.

### Реальный dev process

Отдельно был запущен обычный documented process `pnpm dev:api`, после чего web smoke вызвал
`http://127.0.0.1:3001/health`. Результат: HTTP `500`.

```text
TypeError: Cannot read properties of undefined (reading 'check')
at HealthController.check
```

[`HealthController`](../../apps/backend/src/entrypoints/api/health.controller.ts) полагается на
implicit constructor metadata для `OperationalReadiness`. Production TypeScript build emits эту
metadata, а текущий `tsx watch` dev path — нет; поэтому dependency в dev process становится
`undefined`. Это diagnosis по воспроизведённому поведению и compiled/development paths. Fix должен
явно проверить both dev and built entrypoints, а не только добавить decorator и оставить прежний
blind spot.

Также обычный shell на машине использовал Node `22.23.1`, хотя repository pin — `24.19.0`.
`fnm exec --using=24.19.0` исправляет запуск, но repository не имеет `doctor`/fail-fast command,
который объясняет mismatch до установки и тестов.

## Карта готовности

| Область | Состояние | Уже есть | До полноценной feature delivery не хватает |
|---|---|---|---|
| Backend architecture | Готова | Nest modular monolith, deep Materials module, application interfaces, Kysely, ADR, guardrails | Публичные product transports для Reader/Library/Authoring и transport contract |
| Backend persistence/tests | Готова | Migrations, generated types, Testcontainers, race/idempotency/rollback coverage | Включить правильный real-DB gate в canonical delivery path |
| Backend local runtime | Блокер | Config lifecycle, Compose, in-process smoke | Починить `pnpm dev:api`; внешний smoke именно живого process |
| Frontend foundation | Готова | Next 16, React 19, TypeScript 6, FSD-compatible layout, Storybook, accepted UI, Playwright/axe | Закрепить server-only/public-interface rules на первом реальном slice |
| Production frontend | Не готова | Shell и статические `/`, `/library`, `/map` routes | Реальные feature routes, adapters, SSR data, route states, presentation models |
| Local onboarding | Частично | `.node-version`, exact pnpm, `.env.example`, runbook, Compose | One-command doctor/bootstrap, deterministic seed, full-stack smoke, ясное владение Compose |
| CI | Частично | Pinned actions, Node pin, PostgreSQL service, lint/type/test/build/smoke | Guardrails, Playwright E2E, Storybook build, integration suite и единый canonical gate |
| Observability | Не готова к production | Nest default logger, bootstrap error output, application correlation IDs | Request context propagation, structured/redacted logs, correlation proof, metrics/tracing decision |
| AI-first navigation | Достаточно сейчас | AGENTS/docs/ADR, capability indexes, `rg`, compiler, guardrails, Storybook MCP | Измерять navigation failures; optional tooling только по доказанной проблеме |

### Observability

На current main API использует Nest default logger и печатает bootstrap failure через
`console.error`. Materials application генерирует `correlationId` для `internal_error`, но audit не
нашёл middleware/interceptor, который принимает request ID, добавляет его в log context и пишет
соответствующую internal diagnostic запись. Metrics, distributed tracing, error-reporting provider
и web vitals collection не настроены. Playwright `trace: retain-on-failure` помогает только тестам
и не является production observability.

Минимум до внешнего production traffic:

- принимать или генерировать request ID в Nest и передавать его из Next server adapter;
- писать structured logs с process/route/outcome/duration и безопасной redaction policy;
- связывать returned correlation ID с одной internal error record без SQL, secrets и private
  content в response;
- решить отдельно, нужны ли на первом deploy metrics/tracing provider и field web vitals;
- проверять в full-stack failure test, что owner может пройти от UI error ID к server diagnostic.

## Целевая frontend/backend граница

Первый read-only production slice должен идти по одному пути:

```text
Browser
  -> Next App Router page (thin URL/metadata adapter)
  -> async Server Component in _pages/material-reader
  -> feature-owned server-only adapter
  -> Nest HTTP Materials controller
  -> PublishedMaterialReader application interface
  -> Kysely/PostgreSQL
```

Responsibilities разделены так:

- Nest владеет domain rules, authorization decisions, persistence и stable HTTP outcomes.
- Generic `shared/api/backend` владеет base URL, request metadata, timeout и transport failures.
- `_pages/material-reader/api` валидирует response на runtime boundary, переводит outcomes в малый
  serializable presentation model и знает semantics именно Reader.
- `app/materials/[slug]` владеет route files: `page`, `loading`, `error`, `not-found`.
- Client Component появляется только для реального browser interaction. Initial Reader content
  server-renders без client fetch и без внутреннего Next Route Handler round trip.
- Storybook и production route импортируют одну accepted presentation implementation. Fixtures
  остаются только в Storybook graph.

Подробный source-backed вариант структуры, caching, forms и test pyramid находится в
[`frontend-architecture-sources.md`](frontend-architecture-sources.md).

## FSD и библиотеки

Принять **FSD layer-on-demand**, а не заранее создать пустое дерево всех layers:

- `_app`: providers и app-wide integration;
- `_pages`: законченный route outcome и page-owned data/UI;
- `shared`: generic backend client, config и focused UI primitives;
- `entities`, `features`, `widgets`: только при втором consumer или самостоятельной product
  responsibility.

Каждый slice имеет явный `index.ts`; server exports при необходимости идут через
`index.server.ts`. Между slices запрещены deep imports, широкие `export *` и перенос backend DTO в
client graph.

### Что добавлять сейчас

- `server-only` boundary для backend adapters.
- Один runtime contract mechanism для HTTP response: рекомендован generated OpenAPI contract **или**
  handwritten fetch + Zod, но не две вручную синхронизируемые схемы.
- Route-owned error/loading/not-found semantics и focused mapper/schema tests.

### Что не добавлять как baseline

- TanStack Query — не нужен Reader и обычному SSR catalog с URL filters. Добавить в конкретный
  slice при polling/refocus, infinite loading, optimistic mutation или shared client-owned
  server-state.
- Redux/Zustand — только при доказанном cross-feature client state.
- React Hook Form/TanStack Form — только при сложной dynamic client form. Простую форму строить на
  native form, Server Function и `useActionState`.
- Steiger — сначала расширить существующие repository-owned negative architecture fixtures; затем
  отдельно оценить, даёт ли tool дополнительное покрытие.

## Что на самом деле означает #67

Текущий backend уже умеет прочитать published Material **внутри application process**, но browser
не может открыть его через production URL. [#67](https://github.com/sachkov-inside/platform/issues/67)
предлагает:

1. дать application reader публичный transport path;
2. подключить Next route к реальным данным;
3. показать временную простую HTML-страницу;
4. позже удалить её и поставить финальный UI в #37.

То есть пользователь после #67 получил бы работающий, но заведомо временный Reader. Полностью
готовая фича появилась бы только после #37. Именно это скрывает технический title
«production Material Reader / PostgreSQL-backed Reader route через application».

Важно: действующий [`frontend-delivery.md`](../agents/frontend-delivery.md) требует этот split, пока
Reader существует только как workshop proof, а не production-owned UI module. Поэтому #67/#37
сейчас сформулированы корректно относительно repository rules. Предложение ниже — не тихая отмена
правила, а owner decision: разрешить promotion уже принятого workshop proof и real integration в
одном vertical issue, когда visual contract стабилен и не требует параллельного discovery.

## Предлагаемая переработка full-stack roadmap

Existing specifications не изменены этим audit. Ниже — proposal для owner review; после GO их
следует переписать или supersede, сохранив links и историю решений.

### #65 Material Reader — сделать первой полной фичей

**Понятный результат:** посетитель открывает production URL и читает реальный опубликованный
Material из PostgreSQL в принятом responsive UI.

После owner-approved изменения frontend delivery contract один child вместо временной цепочки
#67 -> #37 должен включать:

- Nest HTTP endpoint поверх `PublishedMaterialReader`;
- runtime-checked server-only Next adapter;
- SSR Reader route и accepted Storybook presentation implementation;
- loading, not-found, unavailable/access и unexpected-error states;
- deterministic representative Material seed/fixture boundary;
- real PostgreSQL + production-like Next/Nest Playwright proof;
- keyboard, axe, responsive и bundle review.

#67 и #37 после такого GO следует закрыть как superseded новым vertical issue или переписать так,
чтобы один из них стал этим единственным delivery contract. До изменения canonical rule текущий
split сохраняется, и temporary UI нельзя просто пропустить по audit recommendation.

**Stopping condition:** один PR даёт production URL, который server-renders seeded published
Material через живые Next, Nest и PostgreSQL; accepted Reader UI и все route states используются в
production, workshop/fixtures не попадают в runtime graph, real full-stack E2E и acceptance gates
проходят. После PR не остаётся second integration ticket или temporary UI marker.

### #64 Library — разбить по пользовательским возможностям

Текущий #28 слишком долго строит backend отдельно от production experience. Предлагаемые slices:

1. **Открыть Library:** production page показывает реальный published catalog в принятом UI.
2. **Найти Material:** RU/EN search, filter и sort работают end-to-end с URL state и SSR.
3. **Перейти по знаниям:** Topic, Series и related Materials дают реальные navigation paths.

Каждый slice включает свой PostgreSQL query/projection, HTTP contract, Next page behavior, UI
states и E2E. TanStack Query нужен только если owner выбирает additive infinite loading или
background refresh; обычные URL filters остаются RSC-owned.

Stopping conditions по slices:

1. Catalog PR закрывается, когда `/library` server-renders deterministic published page из
   PostgreSQL через Nest и accepted UI, включая loading/empty/error; search/navigation явно
   исключены.
2. Search PR закрывается, когда URL query/facets/sort дают проверенные RU/EN database results и
   честный zero-result state в SSR/E2E; additive infinite loading не входит без отдельного choice.
3. Navigation PR закрывается, когда реальные Topic/Series/related links связывают Library и Reader
   routes и full-stack E2E доказывает переход; recommendation engine остаётся исключён.

### #62 Authoring/Preview — не строить fake identity

[MCP child #29](https://github.com/sachkov-inside/platform/issues/29) остаётся независимым channel
adapter и может развиваться отдельно. Production editor начинается только после bounded
trusted-author/session decision.

Production authoring лучше разделить на два user-visible slices после trusted-author decision:

1. **Создать draft и проверить Preview:** browser form -> Next server adapter/function -> Nest HTTP
   -> `MaterialAuthoring` -> PostgreSQL -> exact Preview route. Stopping condition: один trusted
   author создаёт representative draft и видит ту же revision в production Preview; validation,
   unauthorized и infrastructure states доказаны, autosave/conflict edit явно исключены.
2. **Безопасно изменить draft:** тот же путь получает revise semantics, dirty/saving/conflict и
   retry behavior. Stopping condition: две concurrent sessions доказывают accepted save и stale
   conflict без потери content, а Preview показывает выбранную saved revision.

TanStack Query/form library принимаются только по фактической сложности optimistic
autosave/dynamic form. Если accepted editor module отсутствует, текущий frontend delivery contract
по-прежнему требует bounded semantic UI и отдельную visual integration до изменения этого правила.

## Как выстроить работу дальше

### Сейчас параллельно

1. **Продолжить #46** в уже открытом worktree: принять production app shell. Не создавать вторую
   ветку, которая меняет те же shell/shared UI files.
2. **Починить real dev API и добавить external process smoke.** Это отдельный небольшой backend
   bug ticket без frontend overlap.
3. **Сделать developer doctor/full-stack harness:** проверка Node/pnpm/Docker/env/ports, migrations,
   deterministic seed и one-command full-stack smoke. Разделить destructive database reset и
   безопасный normal path.
4. **Выровнять CI и canonical gates:** repository должен ясно отвечать, какие checks обязательны
   для обычного PR, а какие являются real-infrastructure suite. Сейчас три разных зелёных сигнала
   не эквивалентны.
5. **#29 MCP authoring** может идти независимо, если это остаётся текущим product priority.

### После #46 и owner architecture choices

6. Выполнить один production-grade Material Reader vertical slice.
7. На его реальном code shape закрепить FSD/server-only/public-interface negative fixtures и
   reusable full-stack test harness.
8. После Reader начать Library срезами; Authoring production lane открыть после trusted-author
   decision.

Это даёт последовательность: **работающее окружение -> одна эталонная full-stack feature ->
масштабирование pattern**, а не несколько параллельных временных UI и несвязанных backend tickets.

## Graphify и Serena

Не устанавливать сейчас ни один из них как обязательный dependency.

- Graphify не разрешает используемый Platform alias `@/*` через `tsconfig paths`, поэтому
  frontend graph может быть неполным. Он также добавляет Python/uv, snapshot freshness lifecycle и
  installer, способный конфликтовать с managed harness files.
- Serena ближе к нужной symbol/reference navigation, но имеет reproduced risk для TypeScript
  monorepo без root `tsconfig.json`, как Platform. Official evaluation не доказывает free-LSP path,
  а runtime/config остаётся machine-local.

После 2–3 vertical slices следует собирать конкретные navigation failures. Если `rg` + TypeScript
действительно не хватает, первым кандидатом будет timeboxed **read-only Serena pilot** на pinned
commit с exact reference acceptance, no memories, no shell/edit tools и отключённой telemetry.

Полное сравнение и safety contract:
[`ai-first-tooling-assessment.md`](ai-first-tooling-assessment.md).

## Решения владельца перед первой vertical feature

Рекомендованные defaults выделены первыми:

1. **HTTP contract:** generated OpenAPI client/schema; fallback — handwritten fetch + Zod parse.
2. **Reader access/cache:** public mutable slug с explicit revalidation, если published revision
   заменяется; viewer-dependent response остаётся uncached.
3. **Browser API policy:** RSC вызывает Nest напрямую; browser-owned queries могут обращаться к
   public Nest endpoint, а Next Route Handler добавляется только для доказанного same-origin BFF
   requirement.
4. **FSD enforcement:** сначала repository-owned tests/negative fixtures; Steiger — отдельная
   evaluation после первого реального slice.
5. **Frontend delivery contract:** сохранить обязательный temporary-UI/integration split или
   разрешить одному vertical issue продвигать уже принятый workshop proof в production при
   стабильном presentation contract и общем owner visual/functional gate.
6. **Issue migration:** только если выбран второй вариант, создать один новый Reader vertical issue
   и закрыть #67/#37 как superseded, сохранив #65 parent specification.

Hard-to-reverse caching, identity, browser transport и mandatory tooling decisions требуют
отдельного owner GO/ADR. Сам audit не меняет production architecture и не переписывает tracker до
этого решения.
