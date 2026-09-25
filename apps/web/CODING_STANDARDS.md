# Web coding standards

This file is normative for `apps/web` changes and reviews. The nearest `AGENTS.md` owns routing and
verification; ADR 0011 owns the current Library/transport boundary, ADR 0012 owns browser
mutations and ADR 0027 owns navigation and caching.

## Slices and runtime boundaries

- Keep `app/` thin: routing, metadata, route states, and composition only. Product UI, presentation
  models, and data adapters live in feature-owned slices under `src`. A route file declares its
  `params` and `searchParams` types itself rather than through the generated `PageProps` and
  `LayoutProps`: `pnpm lint` runs type-aware rules before `next typegen`, and on a clean checkout
  the generated types do not exist yet.
- `_app` owns root providers and shell; `_pages` owns route slices; `widgets`, `features`, `entities`,
  and `shared` follow the enforced downward dependency direction. Import through a public entrypoint
  and use a focused sub-entrypoint when a broad barrel crosses runtime or bundle boundaries.
- Keep route-specific behaviour beside its `_pages/<page>` slice. Promote code to `shared` only
  after multiple real consumers need the smaller interface.
- Public page metadata comes from `src/shared/link-preview`; each page slice maps its own result to
  one `PublicPagePreview` and its own social card content, so a route stays load, map, respond. That
  ownership has no executable check yet: the seam is one function call, not an import boundary, so
  it stays prose until a route hand-rolls `openGraph` and gives the check a shape to match.
  `check-web-architecture` does enforce the narrower rule that only that module reads the public
  site origin, which keeps the domain a request-time value. A closed area with its own layout
  declares `noindex` there once instead of repeating it on every page. A transient dependency
  failure never answers with `noindex`.
- Mark backend adapters, BFF handlers, and server query options `server-only`; use `*.client.tsx`
  for the interactive boundary. Client-reachable code imports no server-only interface.
- Storybook proofs and fixtures remain outside the production graph.

## Storybook catalog

- A story renders the production module in its production environment. A page-level story wraps the
  module in the shell its route uses; a component story uses the containers its real page gives it.
  A story never re-creates page markup, a shell, or navigation of its own.
- `src/workshop/story-environment` owns those wrappers and `@/widgets/application-shell` owns the
  navigation items. A story that copies navigation or rebuilds a header drifts from the application
  as soon as either changes; extract the real frame into a module both sides import instead.
- Scrolling in a story matches the product: the document scrolls below 48rem, and above it the
  shell owns scrolling. A page-level story that cannot scroll on desktop is a defect, not a fixture.
- The application is the reference. When a story and its route disagree on tokens, spacing,
  typography, or states, the story changes.
- A retired proof leaves the catalog. Git history and the issue keep the decision; the catalog keeps
  only what the product still shows.
- Owner decision 2026-09-11: these rules stay prose and are checked in review. Do not add a
  Storybook-specific automated check for them.

## Transport and validation

- Nest owns the wire contract. Change controller schemas, regenerate deterministic OpenAPI and the
  Web client, and use `pnpm api:check` for drift. Do not hand-edit generated artifacts.
- `@inside/material-blocks` owns the material block set. Take the rendered block type and its
  schema from its registry entry point, and build the editor from its document-schema entry point;
  a page slice adds a block's appearance, never its node, block list or rendered shape. Reading and
  lightweight authoring routes stay on the registry entry point so the editor bundle cannot reach
  them.
- `src/shared/config` owns server-only environment parsing. `src/shared/api/backend` owns generated
  transport, the private Nest URL, HTTP adapter, and timeouts. Other modules import those
  interfaces and do not read application env or duplicate backend URLs.
- Treat generated response types as compile-time guidance. Feature adapters receive external bodies
  as `unknown`, validate focused Zod schemas, and map Problem Details and success bodies into known
  feature outcomes and presentation models.
- React Server Components may call Nest only through server-only transport. Browser code calls a
  same-origin, capability-owned Next Route Handler and never receives or calls the Nest address.
- Do not add a universal proxy, generated TanStack hooks/Zod schemas/UI models, or a second
  transport path without a concrete consumer and an explicit architecture decision.
- `proxy.ts` limits the request rate of entry routes and answers unknown legal addresses with 404
  (Navigation and caching). A new sign-in, payment command, public link or guest browser-report
  route joins `entryRoutePaths` in `src/_app/entry-rate-limit.ts` and the proxy `matcher`
  together; `entry-rate-limit.test.ts` compares them, leaving out the legal section entry. A guest
  browser-report handler also takes its log lines from the shared ceiling in
  `client-report-ceiling.server.ts` before writing. Security headers live in `next.config.ts`,
  HSTS in Caddy ([ADR 0028](../../docs/adr/0028-web-edge-hardening.md)).

## Navigation and caching

[ADR 0027](../../docs/adr/0027-web-navigation-and-caching.md) owns the rationale and the numbers;
these are the rules a change follows.

- A public catalog page has layers: the route skeleton in `loading.tsx`, the shared part rendered
  from a guest read, and, where the page depends on the reader, a personal part inside an inner
  `<Suspense>` whose fallback is the same page on shared data. The page reads `params` and
  `searchParams` below the skeleton, never at the top of the route file. The personal part starts
  with `await connection()` before it touches the session, so link prefetch stops in front of it.
- A loading state is built from the frame of its own page — the same column, return row and
  header — and is at least a screen tall, so the footer waits below the fold instead of jumping
  when the page arrives. A page with a different layout gets its own skeleton instead of borrowing
  one. Every such page has `LoadsInPlace` stories for 1440 and 390 that compare the geometry of
  the skeleton, the shared part and the ready page; `src/workshop/loads-in-place.ts` owns their
  shared helpers.
- `"use cache"` lives only in a `*.public-cache.server.ts` module, reads the backend without a
  token, and sets its tag and lifetime through `applyCatalogCachePolicy`. The directive is declared
  inside the function, never for the whole module, and every cached function calls the policy
  itself: a second read in the same file would otherwise have neither a tag nor a lifetime. A read made with a token, a
  closed Material body, per-viewer availability, progress, the guide mode and offers are never
  cached and so never enter link prefetch. `"use cache: private"` and `unstable_cache` are not
  used. `check-web-architecture` enforces the module name, the policy call in each cached
  function, the absence of the session and the directive variant and placement, with the negative
  fixture `public-cache`. It sees a direct breach only: a
  token under another name or a session reached through an intermediary stays a review concern,
  because its shape is ordinary code.
- A cached read returns a dependency failure as a value, and its entry expires at once: it stays
  out of the cache, of prefetch and of the shell that the image build prerenders without a backend.
- Every `GET` Route Handler is declared in its route file and starts with `await connection()`,
  outside any `try`. Otherwise the image build prerenders its answer without configuration or a
  backend, and a `catch` that swallows the bail-out freezes an error response into the image.
  `check-web-architecture` enforces the shape with the negative fixture `prerendered-handler`;
  `pnpm --filter @inside/web test:prerendered-handlers` checks the built manifest. A handler that
  is static on purpose is listed in both; the manifest check also allows the `icon.svg` metadata
  file, which has no handler code.
- A page or layout that reads the session on the server before it renders is not split into
  layers and declares `export const instant = false`, which exempts it from the instant-navigation
  validation; a redirect from a layout needs a real status code, which streaming cannot give. The
  declaration does not remove a parent's loading boundary: a page nested under another page's
  address brings its own `loading.tsx`, or it shows that page's skeleton. This rule stays prose:
  whether a segment depends on the session is a reading of its data, not a shape a guardrail can
  match.
- On a catalog surface — cards, lists, lesson navigation, the product and programme pages — link to
  a lesson, product, programme or topic with `IntentPrefetchLink` from
  `@/shared/ui/intent-prefetch-link.client`: until touched it prefetches the shared route shell,
  and intent upgrades it to the shared part of that address. A return row of a catalog page uses
  it as well: its target is computed and is usually a catalog page. `prefetch={false}` has no place
  there. Links from the cabinet, purchase pages and state screens stay a plain `<Link>`. The rule
  stays prose because a guardrail cannot tell a catalog destination from a computed `href`.
- A catalog page declares `unstable_dynamicStaleTime` as a literal in its route file: for that
  window the browser keeps the page, personal part included. Other routes declare none and are
  read again on every transition. On a catalog page a control that must reach the server again —
  retry after a failure, a change of the guide mode, a confirmed purchase — calls
  `router.refresh()`; a link to the same address would be served from that memory. A catalog
  `error.tsx` retries through `retry`, not `reset`, which re-renders the same failure without a
  request. Leaving the
  authoring workspace for the site is a full document load for the same reason.
- Every page reaches an `error.tsx` inside its shell: `(public)` and `authoring` own a section
  boundary, catalog pages keep their own, `app/error.tsx` catches a failed section layout and
  `app/global-error.tsx` the root one. A boundary reports the error through
  `useRenderErrorReport` and recovers with `retry`. An unknown address and `notFound()` render
  `PageNotFound` in the public shell. `test/e2e/routes.spec.ts` checks the Russian 404; the rest
  stays prose, because which boundary a segment reaches is a reading of the route tree.
- A page with a parameter streams, so its `notFound()` arrives after status 200. Where web itself
  knows every valid address — today the legal section — `proxy.ts` checks the address before the
  response and rewrites an unknown one to an unrouted path, which Next.js answers with its own 404.
  Its `matcher` is a literal, and it reads neither the backend nor the session:
  `check-web-architecture` follows its imports and rejects the backend transport, the session
  modules, any `.cookies` access and any `fetch` call on the way, with the negative fixture
  `proxy-dependencies`; a cookie parsed from a raw header stays a review concern. Catalog addresses
  live in the backend and keep the soft 404 (ADR 0027).
- A component that reads the clock, randomness or a request value during render breaks the
  production build under Cache Components. Read it in an event handler or an effect.
- A page the reader left is hidden, not unmounted, and keeps its client state. State that starts
  from a server value follows that value when it changes; `GuideModeProvider` is the worked
  example. A surface that must reset on return resets itself.
- A server render reads the session only through `@/shared/auth`: that read starts with
  `connection()`, so a prefetch render stops before it can start a token refresh it would share
  with a real request.
- A hydrated or freshly read TanStack query keeps the client default `staleTime`. Freshness after a
  write comes from invalidating the owner's key and from fact announcements, not from
  `staleTime: 0`; `selfRefreshingRead` stays for surfaces where a person waits for someone else's
  change. Reading progress is cached per Material and read through the batching loader.
- Measure transitions only on a production build: `pnpm --filter @inside/web test:navigation`.

## Server state and mutations

- Give each server-state surface one runtime/cache owner. Browser-owned live search, filters, and
  infinite lists use one page-owned TanStack Query factory and feature BFF; RSC renders metadata and
  a hydration-safe shell without reading `searchParams`, prefetching, or dehydrating that query.
- When initial data must be server-rendered and continue in the browser, use one complete path:
  request-isolated `QueryClient`, prefetch, dehydration, and `HydrationBoundary`.
- Server-render-only data calls its server adapter directly. Query `staleTime` is browser-cache
  policy; HTTP cache policy belongs to the BFF/backend boundary.
- A browser-owned fact shown by several surfaces is reset on every open surface at the moment a
  write changes it, not only on the surface that performed the write. A successful read has no
  refresh interval and two visible windows raise no focus event, so an unannounced change leaves
  the remaining surfaces on a remembered answer until they are opened again. The feature that owns
  the fact owns its query key, its named announcement from `src/shared/api/fact-announcement`, one
  announcement per write command, and the one read hook every surface calls. Worked examples: the
  verified billing contact (`useBillingContact`), the buyer's billing state (`useCurrentBilling`)
  and notification channel preferences (`useNotificationPreferences`). The announcement reaches
  tabs of one browser only; another device needs a server push. The closest executable check is a
  Playwright case per fact where a second already-open surface shows the written value without a
  reload, plus a negative one where the announcement is unavailable
  (`test/e2e/account-cabinet.spec.ts`). The rule itself stays prose: deciding that several surfaces
  read a fact means reading its query owner, which is not an import boundary a guardrail can match.
  Its mechanism is a fitness candidate: a guardrail allowing `BroadcastChannel` only in
  `fact-announcement` lands once enrollment events move onto it (#636).
- Interactive writes use `useMutation` → browser adapter → same-origin capability Route Handler →
  generated Nest transport. The shared BFF boundary owns Origin, session, private no-store, timeout,
  and the default 2 MiB limit; a larger limit requires a named narrow override and boundary tests.
  Give each product operation its own named mutation and browser adapter with exact input/result
  types and a literal same-origin route and HTTP method. Do not multiplex unrelated writes through
  `operation`, `mode`, a dynamic route, or a dynamic method. Server Actions are outside the current
  mutation contract.
- Put `QueryProvider` in the lowest layout shared by its consumers.

## Interaction and enforcement

- Hover, focus, loading, and hydration preserve surrounding layout. Reserve a definite footprint or
  use an overlay; layout may change after explicit user actions such as pinning or resizing.
- Prove layout-sensitive interaction with geometry assertions or Layout Shift API checks when
  visual snapshots cannot establish stability.
- Keep editor and explicit CLI checks on the committed TypeScript project that excludes stale
  `.next/dev` artifacts. Do not re-enable the removed JavaScript compiler API checker.
- Compare a node with live document state inside one evaluation, `document.activeElement` above all.
  A locator resolves in one round trip and evaluates in the next, so a re-render between them leaves
  the assertion holding a detached node that can never equal what the document reports now.
- Treat `clock.runFor` as a trigger: it returns once the page's virtual timers ran, before the
  request they started has been answered. Wait for the response or the applied render.
- Build site animation as a CSS component next to its page: keyframes that move only `transform` and
  `opacity`, a `prefers-reduced-motion` guard, and platform tokens. The static cover is the same
  component with its loop stopped. Do not use Remotion, framer-motion or an embedded video as a
  site asset (owner decision of 2026-09-11).
- Keep Web guardrails and negative fixtures aligned with environment ownership, browser bypass,
  slice direction, mutation boundaries, and bundle limits. Use focused mapping/query tests,
  Storybook for meaningful UI states, and Playwright for route behaviour and accessibility.
