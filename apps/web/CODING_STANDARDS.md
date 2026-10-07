# Web coding standards

This file is normative for `apps/web` changes and reviews. The nearest `AGENTS.md` owns routing and
verification; ADR 0011 owns the current Library/transport boundary, ADR 0012 owns browser
mutations and ADR 0027 owns navigation and caching. A rule that a check can hold lives in that
check, not here: `pnpm --filter @inside/web guardrails` runs `scripts/check-web-architecture.mjs`,
whose diagnostic names the broken rule. This file keeps the judgement around those checks.

## Slices and runtime boundaries

- Keep `app/` thin: routing, metadata, route states, and composition only. Product UI, presentation
  models, and data adapters live in feature-owned slices under `src`.
- `_app` owns root providers and shell; `_pages` owns route slices; `widgets`, `features`, `entities`,
  and `shared` follow the enforced downward dependency direction. Import through a public entrypoint
  and use a focused sub-entrypoint when a broad barrel crosses runtime or bundle boundaries.
- Keep route-specific behaviour beside its `_pages/<page>` slice. Promote code to `shared` only
  after multiple real consumers need the smaller interface.
- Public page metadata comes from `src/shared/link-preview`; each page slice maps its own result to
  one `PublicPagePreview` and its own social card content, so a route stays load, map, respond. The
  seam is one function call, not an import boundary, so it stays prose until a route hand-rolls
  `openGraph` and gives a check a shape to match. A closed area with its own layout declares
  `noindex` there once instead of repeating it on every page. A transient dependency failure never
  answers with `noindex`.
- Mark backend adapters, BFF handlers, and server query options `server-only`; use `*.client.tsx`
  for the interactive boundary.

## Storybook catalog

- A story renders the production module in its production environment. A page-level story wraps the
  module in the shell its route uses; a component story uses the containers its real page gives it.
  A story never re-creates page markup, a shell, or navigation of its own.
- `src/storybook/story-environment` owns those wrappers and `@/widgets/application-shell` owns the
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

- The Node web process configures Undici for HTTP/1.1 in `instrumentation.ts` before serving
  requests. Logto rejects SDK streaming token bodies over HTTP/2 without Content-Length;
  [ADR 0032](../../docs/adr/0032-web-http1-logto-sdk.md) owns this compatibility choice.
- Nest owns the wire contract. Change controller schemas, regenerate deterministic OpenAPI and the
  Web client, and use `pnpm api:check` for drift. Do not hand-edit generated artifacts.
- `@inside/material-blocks` owns the material block set: take a block's rendered type and schema
  from its registry entry point and build the editor from its document-schema entry point. A page
  slice adds a block's appearance, never its node, block list or rendered shape.
- Authenticated reads use `handleAuthenticatedRead` for GET adapters and
  `readAuthenticatedSession("rsc")` for server renders. The session adapter owns the token mode;
  the read module owns session failures (401/503) and private no-store with `Vary: cookie`.
  Browser adapters use `requestAuthenticatedRead` and validate ready values with feature schemas.
  The shared result distinguishes missing authentication, identity failure and dependency failure;
  feature outcomes remain local. Replace the public `sessionAdapter` in read tests, rather than
  token or Logto config internals. RSC prefetch interruption stays outside failure catches.
- Treat generated response types as compile-time guidance. Feature adapters receive external bodies
  as `unknown`, validate focused Zod schemas, and map Problem Details and success bodies into known
  feature outcomes and presentation models.
- Do not add a universal proxy, generated TanStack hooks/Zod schemas/UI models, or a second
  transport path without a concrete consumer and an explicit architecture decision.
- `proxy.ts` limits the request rate of entry routes and answers unknown legal addresses with 404
  (Navigation and caching). A new sign-in, payment command, public link or guest browser-report
  route joins `entryRoutePaths` in `src/_app/entry-rate-limit.ts`; `entry-rate-limit.test.ts`
  holds the proxy `matcher` to it. A guest browser-report handler takes its log lines from the
  shared ceiling in `client-report-ceiling.server.ts` before writing. Security headers live in
  `next.config.ts`, HSTS in Caddy ([ADR 0028](../../docs/adr/0028-web-edge-hardening.md)).

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
  the skeleton, the shared part and the ready page; `src/storybook/loads-in-place.ts` owns their
  shared helpers.
- `"use cache"` reads the catalog as a guest; the guardrail holds its module, policy call, variant
  and placement. A read made with a token, a closed Material body, per-viewer availability,
  progress, the guide mode and offers are never cached and so never enter link prefetch. The one
  exception is the guest read of a product's offer terms for its description placeholders
  (ADR 0027): month counts only, no price. The guardrail sees a direct breach only: a token under
  another name or a session reached through an intermediary stays a review concern.
- A cached read returns a dependency failure as a value, and its entry expires at once: it stays
  out of the cache, of prefetch and of the shell that the image build prerenders without a backend.
- The guardrail and `pnpm --filter @inside/web test:prerendered-handlers` hold every `GET` Route
  Handler to `await connection()`; a handler that is static on purpose is listed in both.
- A page or layout that reads the session on the server before it renders is not split into
  layers and declares `export const instant = false`, which exempts it from the instant-navigation
  validation; a redirect from a layout needs a real status code, which streaming cannot give. The
  declaration does not remove a parent's loading boundary: a page nested under another page's
  address brings its own `loading.tsx`, or it shows that page's skeleton. The rule stays prose:
  session dependence is a reading of a segment's data, not a shape a guardrail can match.
- On a catalog surface — cards, lists, lesson navigation, the product and programme pages — link to
  a lesson, product, programme or topic with `IntentPrefetchLink` from
  `@/shared/ui/intent-prefetch-link.client`: until touched it prefetches the shared route shell,
  and intent upgrades it to the shared part of that address. A return row of a catalog page uses
  it as well: its target is computed and is usually a catalog page. `prefetch={false}` has no place
  there. Links from the cabinet, purchase pages and state screens stay a plain `<Link>`. The rule
  stays prose because a guardrail cannot tell a catalog destination from a computed `href`.
- A catalog page declares `unstable_dynamicStaleTime`: for that window the browser keeps the page,
  personal part included. Other routes are read again on every transition. On a catalog page a
  control that must reach the server again — retry after a failure, a change of the guide mode, a
  confirmed purchase — calls `router.refresh()`; a link to the same address would be served from
  that memory. Leaving the authoring workspace for the site is a full document load for the same
  reason.
- Every page reaches an `error.tsx` inside its shell: `(public)` and `authoring` own a section
  boundary, catalog pages keep their own, `app/error.tsx` catches a failed section layout and
  `app/global-error.tsx` the root one. An unknown address and `notFound()` render `PageNotFound` in
  the public shell. `test/e2e/routes.spec.ts` checks the Russian 404; which boundary a segment
  reaches stays prose, because it is a reading of the route tree.
- A page with a parameter streams, so its `notFound()` arrives after status 200. Where web itself
  knows every valid address — today the legal section — `proxy.ts` checks the address before the
  response and rewrites an unknown one to an unrouted path, which Next.js answers with its own 404.
  Its `matcher` is a literal; the guardrail keeps the backend and the session out of its imports,
  and a cookie parsed from a raw header stays a review concern. Catalog addresses live in the
  backend and keep the soft 404 (ADR 0027).
- A component that reads the clock, randomness or a request value during render breaks the
  production build under Cache Components. Read it in an event handler or an effect.
- A page the reader left is hidden, not unmounted, and keeps its client state. State that starts
  from a server value follows that value when it changes; `ProductModeProvider` is the worked
  example. A surface that must reset on return resets itself.
- A server render reads the session only through `@/shared/auth`, whose `connection()` stops a
  prefetch before it starts a token refresh. The guardrail holds the Logto SDK there; a session
  cookie read through `next/headers` stays a review concern.
- A hydrated or freshly read TanStack query keeps the client default `staleTime`. Freshness after a
  write comes from invalidating the owner's key and from fact announcements, not from
  `staleTime: 0`; `selfRefreshingRead` stays for surfaces where a person waits for someone else's
  change. Reading progress is cached per Material and read through the batching loader.

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
  and notification channel preferences (`useNotificationPreferences`). A write that lives in a
  slice which may not import the owner receives the owner's announce function from the page that
  composes both: the confirmed purchase in `_pages/subscription` announces the buyer's billing
  state. The announcement reaches tabs of one browser only; another device needs a server push. The closest executable check is a
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
  types. Do not multiplex unrelated writes through `operation` or `mode`.
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
- Simulate a return to the tab with `visibilitychange` and `focus` together, as a browser sends
  them. TanStack Query re-reads stale queries on `visibilitychange` only, and the shell re-checks
  sign-in on `focus`. A bare `focus` only re-checks sign-in and re-reads no query. Worked examples:
  `returnToStaleTab` in `test/fullstack/personal-home.spec.ts` for a return to the tab and
  `signInAndRecheckOnFocus` in `test/fullstack/reading-progress.spec.ts` for a sign-in re-check.
- Build site animation as a CSS component next to its page, with a `prefers-reduced-motion` guard
  and platform tokens. The static cover is the same component with its loop stopped. The guardrail
  rejects Remotion and framer-motion; an embedded video is not a site asset either (owner decision
  of 2026-09-11). Design a card or hero animation for its real slot, draw its icons with
  `lucide-react` and change scenes without morphing objects into each other; the owner's decisions
  of 2026-09-13 and their reasons are in
  `docs/evidence/issue-614/ai-first-animation/README.md`. The AI Engineering course film (#808) is
  the owner-approved exception of 2026-09-30, confirmed by the owner in the #808 session before
  merge: a canvas drawn by a pure function of time, whose dark card moves between the states of one
  episode, with no pause button and the final frame under reduced motion; its brief and critique
  are in `docs/evidence/issue-808/animation/README.md`. Its course page and Home card draw list
  icons with duotone Phosphor geometry (`features/ai-engineering-course/ui/course-icons.tsx`)
  instead of `lucide-react`, by the owner's decision of 2026-09-30 to avoid the standard icon set
  there.
- Keep Web guardrails and negative fixtures aligned with environment ownership, browser bypass,
  slice direction, mutation boundaries, and bundle limits. Use focused mapping/query tests,
  Storybook for meaningful UI states, and Playwright for route behaviour and accessibility.
