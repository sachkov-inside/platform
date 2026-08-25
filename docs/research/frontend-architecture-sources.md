# Frontend architecture: production vertical slices in Next.js App Router

Статус: primary-source research для
[Platform #80](https://github.com/sachkov-inside/platform/issues/80), 2026-08-24.

Документ отвечает на архитектурный вопрос, а не фиксирует уже принятое ADR. Он опирается на
официальную документацию Next.js 16, React 19, TanStack Query v5, Feature-Sliced Design, Zod и
Playwright. Рекомендации, помеченные как project choice, требуют принятия владельцем или отдельным
ADR до того, как станут обязательными правилами репозитория.

## 1. Рекомендуемое решение

Для Platform следует принять **RSC-first vertical slices**:

1. `app/**` остаётся тонким Next.js routing adapter: URL, metadata и специальные файлы
   `page.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`.
2. Async Server Component загружает initial data **напрямую из Nest API через server-only adapter**,
   а не через собственный Route Handler. Next.js прямо рекомендует Server Components обращаться к
   источнику данных напрямую: вызов Route Handler из Server Component добавляет лишний HTTP round
   trip ([Next.js BFF guide](https://nextjs.org/docs/app/guides/backend-for-frontend),
   [production checklist](https://nextjs.org/docs/app/guides/production-checklist)).
3. Nest остаётся authority для domain rules, authorization и persistence. Next server adapter
   владеет только transport/session concerns, runtime validation, безопасным presentation DTO и
   mapping backend outcomes в состояния страницы.
4. Client Components являются небольшими interactive islands. Они нужны для state, event handlers,
   effects и browser APIs; layouts/pages по умолчанию остаются Server Components
   ([Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components),
   [React Server Components](https://react.dev/reference/rsc/server-components)).
5. TanStack Query **не устанавливается как обязательный baseline**. Он появляется в конкретном
   slice только когда browser действительно владеет live server-state после hydration: polling,
   refetch on focus/reconnect, optimistic UI, shared mutation state или infinite loading. Для
   read-only SSR Reader он дублирует RSC/framework data path и создаёт две competing cache
   authorities.
6. FSD применяется layer-on-demand: начать с `_app`, `_pages`, `shared`; добавлять `features`,
   `entities`, `widgets` только после доказанного reuse или самостоятельной product responsibility.
   FSD отдельно подчёркивает, что не каждый проект обязан иметь все layers и не каждое действие
   должно становиться feature
   ([FSD layers](https://feature-sliced.design/docs/reference/layers)).

Это не «минимальный временный frontend». Такой срез уже production-grade: серверный HTML, реальный
Nest/PostgreSQL path, явные runtime boundaries, accepted presentation states, accessibility,
failure handling и E2E proof. Новые библиотеки добавляются по обнаруженной сложности, а не заранее.

## 2. Фактический baseline Platform

На момент исследования [`apps/web/package.json`](../../apps/web/package.json) содержит Next.js
16.3.1, React 19.2.8, strict TypeScript, Storybook 10, Vitest 4, Playwright 1.62 и
`@axe-core/playwright`. TanStack Query, Zod и form-state library во frontend package отсутствуют.
[`next.config.ts`](../../apps/web/next.config.ts) включает typed routes, но не включает
`cacheComponents`.

Структура уже следует официальной FSD/Next.js схеме: framework `app` находится отдельно, а FSD
layers используют `_app` и `_pages`, чтобы не конфликтовать с Next special folders. Именно такую
структуру рекомендует официальный
[FSD guide for Next.js](https://feature-sliced.design/docs/guides/tech/with-nextjs).

Текущий пробел не в отсутствии очередной state library. Production routes пока почти не имеют:

- real backend read adapter и runtime-validated presentation model;
- route-level `loading`, `error` и `not-found` states;
- явной server/client ownership;
- одного E2E vertical-slice proof через Next -> Nest -> PostgreSQL;
- принятой cache/revalidation policy;
- architecture enforcement для FSD public APIs и server-only imports.

## 3. Target vertical slice: Material Reader

Рекомендуемая структура первого полного среза:

```text
apps/web/
├── app/
│   └── materials/[slug]/
│       ├── page.tsx                 # thin re-export / route parameter adapter
│       ├── loading.tsx              # route Suspense fallback
│       ├── error.tsx                # unexpected-error boundary; Client Component
│       └── not-found.tsx            # missing/unavailable material state
└── src/
    ├── _pages/
    │   └── material-reader/
    │       ├── index.ts             # client-safe/static public API only
    │       ├── index.server.ts      # Server Component, loader and metadata public API
    │       ├── api/
    │       │   └── get-material-reader.ts   # server-only Nest adapter + mapping
    │       ├── model/
    │       │   └── material-reader-view.ts  # safe serializable presentation contract
    │       └── ui/
    │           ├── material-reader-page.tsx # async Server Component
    │           ├── material-reader-view.tsx # accepted production presentation
    │           └── reader-controls.tsx      # 'use client' only if interaction exists
    └── shared/
        └── api/backend/
            ├── index.server.ts      # server-only public API
            └── backend-fetch.ts     # base URL, auth forwarding, trace, HTTP failures
```

Почему это FSD, а не произвольная folder tree:

- FSD предлагает выносить App Router files в root `app`, а page implementation — в `src/_pages`;
  route file может просто re-export page implementation
  ([FSD with Next.js](https://feature-sliced.design/docs/guides/tech/with-nextjs)).
- Page slice может законно содержать UI, loading/error states и свои data requests. Неиспользуемый
  больше нигде блок не нужно преждевременно превращать в Widget или Feature
  ([FSD layer definitions](https://feature-sliced.design/docs/reference/layers)).
- `shared/api/backend` содержит только generic external-world connection. Material endpoint,
  interpretation результата и presentation mapping остаются в owning page slice. Это сохраняет
  high cohesion и не превращает `shared` в business layer.
- Если позднее `Material` действительно используется на нескольких pages, стабильный shared
  vocabulary/schema можно выделить в `entities/material`. Если reading controls повторяются на
  разных страницах, interaction можно поднять в `features/*`. До реального второго consumer этого
  делать не следует.

### 3.1 Presentation boundary

Server adapter не должен передавать Client Component полный backend DTO. Он возвращает минимальную
serializable shape, необходимую UI, например:

```ts
type MaterialReaderView = Readonly<{
  title: string;
  summary: string | null;
  publishedAt: string;
  body: ReadonlyArray<ReaderBlock>;
}>;
```

Next.js рекомендует отделять Data Access Layer/DTO и возвращать только разрешённые поля, а
`server-only` даёт build-time error при случайном импорте server module в client graph
([Next.js authentication: DAL and DTO](https://nextjs.org/docs/app/guides/authentication),
[preventing environment poisoning](https://nextjs.org/docs/app/getting-started/server-and-client-components#preventing-environment-poisoning)).

Для Platform это означает два уровня:

- `shared/api/backend` знает, **как** безопасно вызвать Nest;
- `_pages/material-reader/api` знает, **что** означает ответ для Reader и как сузить его до
  presentation interface.

TypeScript type backend response не является runtime proof. Если client не generated from a
single checked contract, response следует принимать как `unknown` и parse на transport boundary.
Zod подходит для этого, потому что schema одновременно валидирует runtime input и выводит
TypeScript type ([Zod parsing and inferred types](https://zod.dev/basics)). Это project choice, а не
причина немедленно добавлять Zod: сначала следует решить, будет ли HTTP contract генерироваться из
OpenAPI и где находится единственный runtime validator.

### 3.2 Outcome mapping

Adapter/page должны иметь закрытое и тестируемое отображение outcomes:

| Nest/API outcome | Next behavior | Почему |
|---|---|---|
| `200` + valid body | render `MaterialReaderView` | Normal server-rendered result |
| `404` | `notFound()` | Next завершает segment с 404 и показывает `not-found.tsx` |
| Expected `401/403` | explicit access state or redirect, по product contract | Expected outcome не является crash |
| `200` + invalid contract | throw contract error | Contract drift должен быть заметен, не маскироваться empty state |
| Network/timeout/`5xx` | throw; route `error.tsx` | Unexpected infrastructure failure обрабатывает nearest error boundary |

Next различает expected errors и uncaught exceptions, рекомендует expected failures моделировать
как значения, а missing resource направлять через `notFound()`
([Next.js error handling](https://nextjs.org/docs/app/getting-started/error-handling),
[`notFound`](https://nextjs.org/docs/app/api-reference/functions/not-found)).

## 4. Data-path decision table

| Need | Правильный путь | Не делать |
|---|---|---|
| Initial SSR/RSC read | Server Component -> feature `server-only` adapter -> Nest API | RSC -> `/api/*` Route Handler -> Nest |
| Server-side presentation mapping, secret/internal URL, auth header forwarding | `server-only` BFF adapter imported directly by Server Component | Передавать backend DTO или secret в Client Component |
| Simple user mutation/form | `<form action={serverFunction}>`; Server Function validates, authorizes, calls Nest, returns expected state | Считать Server Function доверенным только потому, что кнопка скрыта |
| Browser-owned live query, polling, refocus, infinite list | Client Component -> public Nest endpoint **или** Next Route Handler BFF -> Nest | Server Action как TanStack `queryFn` |
| External webhook/callback, secured cache invalidation, downloadable/non-UI response | Route Handler | Притворяться, что Route Handler — второй domain backend |
| Browser-only API determines request (geolocation, storage, file/audio APIs) | Client fetch; Route Handler if same-origin BFF is needed | Тащить browser concern в Server Component |

Next BFF guide называет Route Handlers публичными HTTP endpoints и отдельно говорит, что Server
Components покрывают большинство data-fetching needs; client fetch нужен прежде всего для
browser-only APIs и frequently polled data
([Next.js BFF guide](https://nextjs.org/docs/app/guides/backend-for-frontend)).

Server Functions подходят для mutations, поддерживают forms/progressive enhancement и могут вернуть
обновлённый UI в одном round trip. Но они достижимы прямым POST request, поэтому authentication и
authorization должны проверяться внутри каждой function, даже если Nest повторно защищает domain
operation
([Next.js mutating data](https://nextjs.org/docs/app/getting-started/mutating-data),
[React Server Functions](https://react.dev/reference/rsc/server-functions)).

TanStack отдельно предупреждает: Server Actions/Functions не следует использовать как `queryFn` —
client calls сериализуются и конфликтуют с query/refetch model. Для client read нужен API endpoint
или RPC layer
([TanStack advanced SSR](https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr)).

## 5. Caching and revalidation

### Baseline для текущего Platform

В Next 16 server `fetch` не следует считать «магически cached». Официальный guide говорит, что
requests по умолчанию не cached, а identical fetches внутри React tree memoized; persistent caching
нужно выбирать явно
([Next.js fetching data](https://nextjs.org/docs/app/getting-started/fetching-data),
[`fetch` reference](https://nextjs.org/docs/app/api-reference/functions/fetch)).

Поскольку Platform пока не включает `cacheComponents`, рекомендуемый project choice:

- каждый production adapter явно документирует freshness/authorization contract;
- personalized/access-filtered response остаётся uncached (`no-store` semantics), если нет
  доказанно безопасного partition key;
- публичная immutable revision может использовать explicit cache/tag; если published Material
  заменяется по тому же URL, cache invalidation вызывается после publish или через secured webhook;
- не включать `cacheComponents` попутно в feature ticket: в Next 16 это отдельная opt-in caching
  model и отдельное архитектурное решение
  ([Next.js revalidating with Cache Components](https://nextjs.org/docs/app/getting-started/revalidating),
  [previous caching model](https://nextjs.org/docs/app/guides/caching-without-cache-components)).

После mutation должна обновляться **та cache authority, которая владеет rendering**:

- RSC/Next-owned result -> Next tag/path revalidation;
- client/TanStack-owned result -> TanStack query invalidation/update;
- если один datum одновременно rendered Server Component и independently refetched Client
  Component, две версии могут разойтись. Такой dual ownership не принимать без явного protocol.

TanStack показывает именно этот риск: client revalidation не обновляет уже rendered Server
Component. Поэтому в RSC integration Server Components рекомендуется считать preloading phase, а
не второй renderer того же client-owned result
([TanStack data ownership and revalidation](https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr#data-ownership-and-revalidation)).

## 6. Когда TanStack Query оправдан

### Не нужен

- Material Reader: initial/read-only document, который обновляется navigation/reload/revalidation.
- Обычная detail/list page, где filters представлены URL `searchParams`, navigation приводит к
  новому RSC render, а background freshness не является product requirement.
- Простая form mutation, где достаточно Server Function, `useActionState`, redirect и Next cache
  revalidation.
- Данные, уже полностью принадлежащие RSC и не должны independently refetch после hydration.

Официальный TanStack guide рекомендует для нового Server Components app сначала использовать
framework data tools и не добавлять React Query, пока не возникнет покрываемый им use case; возможно,
он не возникнет вовсе
([TanStack advanced SSR](https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr#data-ownership-and-revalidation)).

### Нужен или заслуживает отдельного решения

- Library с additive `load more`/infinite scroll и сохранением уже загруженных pages
  ([TanStack infinite queries](https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries)).
- Authoring/editor с optimistic update, rollback/retry и несколькими UI consumers одной mutation
  ([TanStack optimistic updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates)).
- Live processing/status surface с polling, reconnect или background refresh.
- Data, которая должна автоматически обновляться после возвращения focus
  ([window-focus refetching](https://tanstack.com/query/latest/docs/framework/react/guides/window-focus-refetching)).
- Сложный client workspace, где несколько Client Components разделяют server-state cache и
  coordinated invalidation.

Если TanStack вводится:

1. Query ownership задаётся на уровне конкретного slice; не переносить все server reads в Query.
2. Initial server prefetch + `HydrationBoundary` используется только если тот же result после
   hydration принадлежит Client Component.
3. `queryOptions`/keys находятся рядом с owning API/entity/page, а `QueryClientProvider` — в `_app`.
   Это соответствует официальному
   [FSD TanStack Query guide](https://feature-sliced.design/docs/guides/tech/with-react-query).
4. `staleTime`, retry и refetch behavior задаются осознанно. По умолчанию data stale, stale queries
   refetch при mount/focus/reconnect, failed client queries retry три раза
   ([TanStack important defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)).
5. Не render один query result одновременно из RSC и client cache. RSC либо владеет result, либо
   prefetch/dehydrate его для client owner.

## 7. FSD: layer-on-demand и public interfaces

### Layer policy

| Layer | Добавлять, когда | Не добавлять для |
|---|---|---|
| `_app` | providers, global styles, instrumentation, Route Handler implementations | feature business logic |
| `_pages` | route-level complete outcome и page-owned data/UI | каждого маленького visual block |
| `widgets` | большой самостоятельный/reused page block или nested route block | single-use основного page content |
| `features` | важное user interaction реально reused на нескольких pages | каждого ticket/use-case name |
| `entities` | стабильный business concept/schema/UI нужен нескольким slices | mirror каждого backend DTO/table |
| `shared` | generic backend client, config, UI primitives, focused libraries | Material-specific interpretation |

FSD import rule разрешает slice импортировать только slices из нижних layers; slices на одном layer
должны оставаться independent
([FSD layers and import rule](https://feature-sliced.design/docs/reference/layers),
[slices and segments](https://feature-sliced.design/docs/reference/slices-segments)).

### Public API rules

- Каждый slice имеет один явный public API; external imports не обходят его deep imports.
- Экспортировать только необходимое, без `export *`.
- Внутри одного slice использовать relative full-path imports, не импортировать собственный
  `index.ts`, чтобы не создавать cycle.
- Между slices импортировать через alias и public API.
- При реальном server/client conflict добавлять `index.server.ts`; server-only exports не должны
  находиться в client-safe `index.ts`. Это прямо рекомендует FSD для Next App Router
  ([FSD server/client public APIs](https://feature-sliced.design/docs/guides/tech/with-nextjs#server-and-client-public-apis)).
- Для `shared/ui` и `shared/lib` использовать per-module entrypoints (`shared/ui/button`), а не один
  широкий barrel, чтобы не ухудшать tree shaking и bundle tracing.

Официальный FSD public API reference также рекомендует Steiger как architecture linter, потому что
index file сам по себе не запрещает deep import
([FSD public API](https://feature-sliced.design/docs/reference/public-api)). Для Platform разумнее
сначала зафиксировать собственные layer/import/server-only rules и negative fixtures, затем
проверить Steiger в коротком evaluation. Tool не заменяет contract и не должен добавляться только
ради названия «AI-first».

## 8. Forms and mutations

Для простого production form достаточно native `<form>`, Server Function и React
`useActionState`:

- browser semantics и progressive enhancement остаются рабочими до hydration;
- `useActionState` даёт pending и last returned state, а с Server Function может показать server
  response до окончания hydration
  ([React `useActionState`](https://react.dev/reference/react/useActionState),
  [React Server Functions](https://react.dev/reference/rsc/server-functions));
- known validation/domain failures возвращаются как typed state; programmer/infrastructure errors
  throw в nearest error boundary
  ([Next.js error handling](https://nextjs.org/docs/app/getting-started/error-handling));
- input parse и auth/authz выполняются внутри каждой Server Function
  ([Next.js mutating data](https://nextjs.org/docs/app/getting-started/mutating-data)).

Zod материально полезен на двух untrusted boundaries: `FormData`/URL input и Nest HTTP response.
`safeParse` возвращает discriminated success/error result, удобный для expected validation state
([Zod basics](https://zod.dev/basics)).

Не принимать React Hook Form, TanStack Form или другую form library как baseline заранее. Отдельная
library оправдана, когда появляется доказанная client-side сложность: большие dynamic forms,
dependent fields, field arrays, многочастное draft state или performance problem native controlled
inputs. Простая create/update form не должна платить client bundle и вторую state model за
возможности, которые уже дают HTML/React/Next.

Для optimistic/infinite client workflow mutation идёт через TanStack `useMutation` и browser API
path. Для simple transactional form — через Server Function. Не смешивать обе mutation state
machines в одном interaction.

## 9. Verification strategy

Next.js официально предупреждает: Vitest/Jest пока не поддерживают async Server Components и для
них рекомендуется E2E
([Next.js Vitest guide](https://nextjs.org/docs/app/guides/testing/vitest),
[testing overview](https://nextjs.org/docs/app/guides/testing)). Поэтому test pyramid должна
разделять pure slice, presentation и framework runtime:

| Boundary | Test | Обязательные proofs для vertical slice |
|---|---|---|
| Pure mapper/schema | Vitest unit | valid DTO -> presentation; malformed DTO; exhaustive status/error mapping |
| Client island | Vitest browser/Storybook interaction | keyboard behavior, pending/disabled semantics, retry, optimistic rollback where applicable |
| Presentation interface | Storybook stories + a11y addon | representative ready, empty/access/error states; responsive visual review |
| Async RSC + Next special files | Playwright against running production-like Next | initial HTML, navigation, `loading`, `not-found`, `error`, hydration interaction |
| Full stack | Playwright + real Nest/PostgreSQL test setup | published Material is read from real DB; missing/inaccessible/failure cases |
| Production graph | `next build` and architecture checks | no Storybook/workshop/fixture/server-only leak into wrong graph; typed routes compile |

### Route-state scenarios

Один Reader slice должен доказать как минимум:

1. `200`: first document response уже содержит meaningful title/body, а не client-only spinner.
2. Slow Nest response: `loading.tsx`/nearest Suspense fallback доступен и не ломает shell.
3. `404`: HTTP/route semantics и `not-found.tsx` соответствуют product message.
4. Expected access denial: выбранный explicit access/redirect outcome.
5. Nest `5xx`, timeout и invalid payload: `error.tsx`, recovery action и server log correlation.
6. Client island: hydration не меняет semantic content и interaction работает после navigation.
7. JavaScript-disabled smoke для simple Server Function form, если progressive enhancement входит
   в acceptance criteria.

`loading.tsx` автоматически создаёт Suspense boundary для segment; Next рекомендует располагать
более точные `<Suspense>` boundaries ближе к uncached/runtime data, чтобы медленный layout не
блокировал navigation
([Next.js fetching and streaming](https://nextjs.org/docs/app/getting-started/fetching-data)).

### Accessibility

- Запускать axe как на accepted Storybook states, так и на живом route после meaningful
  interactions.
- E2E selectors/assertions строить по roles/names, отдельно пройти keyboard-only navigation,
  focus order, visible focus и error announcement.
- Не считать нулевой axe report полной accessibility acceptance: Playwright прямо говорит, что
  automated tests находят только часть WCAG violations и должны сочетаться с manual/inclusive
  assessment
  ([Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing)).

### Performance

- Проверять production build через `next build` + `next start`, а не делать выводы по dev server.
- Ограничивать `'use client'` smallest interactive island и передавать туда минимальный
  presentation data, чтобы не расширять client bundle/serialization boundary.
- Для baseline и regression review сохранять route-specific bundle analysis. Next 16.1+ умеет
  анализировать Turbopack module graph и import chains через `next experimental-analyze`
  ([Next.js package bundling](https://nextjs.org/docs/pages/guides/package-bundling)).
- Lighthouse использовать как lab signal, но production outcome оценивать по field Core Web
  Vitals. Next поддерживает `useReportWebVitals`; его следует изолировать в маленьком Client
  Component
  ([Next.js analytics](https://nextjs.org/docs/app/guides/analytics),
  [production checklist](https://nextjs.org/docs/app/guides/production-checklist)).
- Performance budget должен быть repository decision с baseline evidence; нельзя объявлять
  универсальный bundle/LCP threshold без product/browser/deployment contract.

## 10. Recommended acceptance contract for the first slice

Первый full-stack Reader slice можно считать завершённым, когда одновременно выполнено:

1. Production URL server-renders реальный published Material через Nest/PostgreSQL.
2. Next route вызывает Nest напрямую через feature-owned `server-only` adapter, без внутреннего
   Route Handler round trip и без backend DTO в client graph.
3. Presentation contract runtime-validated и покрыт mapper/error unit tests.
4. Route имеет проверенные loading/not-found/unexpected-error/access states.
5. Accepted Storybook module и production route импортируют одну presentation implementation;
   fixtures отсутствуют в production graph.
6. Playwright доказывает initial SSR content, hydration interaction и full-stack failure states.
7. Axe gate проходит; keyboard/manual accessibility review зафиксирован отдельно.
8. Production build зелёный, client boundary и bundle delta проверены.
9. Cache ownership и freshness policy записаны рядом с adapter; TanStack Query отсутствует, если
   slice не имеет browser-owned live-state requirement.

## 11. Caveats and owner decisions

Перед implementation нужно принять четыре project decisions:

1. **HTTP contract:** generated OpenAPI client/schema или handwritten fetch + Zod parse. Не
   поддерживать вручную одновременно DTO type и независимую schema без drift check.
2. **Reader access/cache:** полностью public immutable revision, public mutable slug или
   viewer-dependent access. От этого зависит caching; personalized response нельзя случайно
   помещать в shared persistent cache.
3. **Browser API policy:** может ли browser обращаться к public Nest API напрямую, или все
   browser-owned queries обязаны идти through same-origin Route Handler BFF.
4. **FSD enforcement:** repository-owned import tests only или tests + evaluated Steiger. Public
   interface contract должен быть выбран до массового появления slices.

Ни Graphify, ни Serena, ни другой code graph/agent memory tool не решит эти решения. Сначала нужны
маленькие semantic slices, explicit public APIs, architecture tests и актуальные durable docs;
после этого инструмент можно оценивать по конкретной задаче: impact analysis, symbol navigation,
cross-session retrieval или stale-index behavior.

## 12. Primary sources

- [Next.js App Router](https://nextjs.org/docs/app)
- [Next.js: Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
- [Next.js: Fetching Data](https://nextjs.org/docs/app/getting-started/fetching-data)
- [Next.js: Backend for Frontend](https://nextjs.org/docs/app/guides/backend-for-frontend)
- [Next.js: Mutating Data](https://nextjs.org/docs/app/getting-started/mutating-data)
- [Next.js: Error Handling](https://nextjs.org/docs/app/getting-started/error-handling)
- [Next.js: Testing with Vitest](https://nextjs.org/docs/app/guides/testing/vitest)
- [Next.js: Production Checklist](https://nextjs.org/docs/app/guides/production-checklist)
- [React: Server Components](https://react.dev/reference/rsc/server-components)
- [React: Server Functions](https://react.dev/reference/rsc/server-functions)
- [React: `useActionState`](https://react.dev/reference/react/useActionState)
- [TanStack Query: Advanced Server Rendering](https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr)
- [TanStack Query: Important Defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)
- [TanStack Query: Infinite Queries](https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries)
- [TanStack Query: Optimistic Updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates)
- [FSD: Usage with Next.js](https://feature-sliced.design/docs/guides/tech/with-nextjs)
- [FSD: Layers](https://feature-sliced.design/docs/reference/layers)
- [FSD: Slices and Segments](https://feature-sliced.design/docs/reference/slices-segments)
- [FSD: Public API](https://feature-sliced.design/docs/reference/public-api)
- [Zod: Basic Usage](https://zod.dev/basics)
- [Playwright: Accessibility Testing](https://playwright.dev/docs/accessibility-testing)
