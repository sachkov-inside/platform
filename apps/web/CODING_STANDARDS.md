# Web coding standards

The nearest `AGENTS.md` owns routing and verification. ADRs 0011, 0012 and 0027 own transport,
mutations and navigation. This file keeps judgement rules for Web changes and reviews.
`pnpm --filter @inside/web guardrails` runs `scripts/check-web-architecture.mjs` and its negative
fixtures in `scripts/check-negative-guardrails.mjs`; diagnostics own the enforced rules.

## Slices and runtime boundaries

- Keep `app/` thin: routing, metadata, route states, and composition only. Product UI, presentation
  models, and data adapters live in feature-owned slices under `src`.
- `_app` owns root providers and shell; `_pages` owns route slices. Import through a public
  entrypoint; use a focused sub-entrypoint when a broad barrel crosses runtime or bundle boundaries.
- Keep route-specific behaviour beside its `_pages/<page>` slice. Promote code to `shared` only
  after multiple real consumers need the smaller interface.
- Public page metadata comes from `src/shared/link-preview`; each page slice maps its own result to
  one `PublicPagePreview` and its own social card content, so a route stays load, map, respond.
  Review holds this one-call seam until a route hand-rolls `openGraph` and gives a check a shape to
  match. A closed area with its own layout declares `noindex` there once instead of repeating it on
  every page. A transient dependency failure never answers with `noindex`.
- Mark backend adapters, BFF handlers, and server query options `server-only`; use `*.client.tsx`
  for the interactive boundary.

## Storybook catalog

- A story renders the production module in its production environment. A page-level story wraps the
  module in the shell its route uses; a component story uses the containers its real page gives it.
  A story never re-creates page markup, a shell, or navigation of its own.
- `src/storybook/story-environment` owns those wrappers and `@/widgets/application-shell` owns the
  navigation items. A story that copies navigation or rebuilds a header drifts from the application
  as soon as either changes; extract the real frame into a module both sides import instead.
- Scrolling in a story matches the product: the document scrolls below 64rem, and above it the
  shell owns scrolling. A page-level story that cannot scroll on desktop is a defect, not a fixture.
- The application is the reference. When a story and its route disagree on tokens, spacing,
  typography, or states, the story changes.
- A retired proof leaves the catalog; Git history and the issue keep the decision.
- Owner decision 2026-09-11: these rules stay prose and are checked in review. Do not add a
  Storybook-specific automated check for them.

## Transport and validation

- The Node web process configures Undici for HTTP/1.1 in `instrumentation.ts` before serving
  requests. Logto rejects SDK streaming token bodies over HTTP/2 without Content-Length;
  [ADR 0032](../../docs/adr/0032-web-http1-logto-sdk.md) owns this compatibility choice.
- Nest controller schemas own the wire contract; `pnpm api:check` owns generated contract drift.
- Read rendered block types/schemas from `@inside/material-blocks`' registry and editor schemas
  from its document-schema entrypoint. Page slices own appearance, not nodes, block lists or shapes.
- Authenticated reads use `handleAuthenticatedRead` for GET adapters and
  `readAuthenticatedSession("rsc")` for server renders. The session adapter owns the token mode;
  the read module owns session failures (401/503) and private no-store with `Vary: cookie`.
  Browser adapters use `requestAuthenticatedRead` and validate ready values with feature schemas.
  The shared result distinguishes missing authentication, identity failure and dependency failure;
  other HTTP rejections keep their status and `unknown` body for feature failure schemas.
  Feature outcomes remain local. Replace the public `sessionAdapter` in read tests, rather than
  token or Logto config internals. RSC prefetch interruption stays outside failure catches.
- Generated types guide compilation; adapters validate `unknown` bodies with focused Zod schemas
  and map Problem Details and success bodies to feature outcomes and presentation models.
- Do not add a universal proxy, generated TanStack hooks/Zod schemas/UI models, or a second
  transport path without a concrete consumer and an explicit architecture decision.
- `proxy.ts` limits the request rate of entry routes and answers unknown legal addresses with 404
  (Navigation and caching). A new sign-in, payment command, public link or guest browser-report
  route joins `entryRoutePaths` in `src/_app/entry-rate-limit.ts`; `entry-rate-limit.test.ts`
  holds the proxy `matcher` to it. A guest browser-report handler takes its log lines from the
  shared ceiling in `client-report-ceiling.server.ts` before writing. Security headers live in
  `next.config.ts`, HSTS in Caddy ([ADR 0028](../../docs/adr/0028-web-edge-hardening.md)).

## Navigation and caching

[ADR 0027](../../docs/adr/0027-web-navigation-and-caching.md) owns the rationale and the numbers.

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
- Review cached reads for closed Material bodies, per-viewer availability, progress, guide mode
  and offers: they never enter the cache or link prefetch. Only guest offer month counts for
  description placeholders may be cached (ADR 0027), never prices. The cache guardrail rejects
  direct session access; a renamed token or session reached through an intermediary needs review.
- A cached read returns a dependency failure as a value, and its entry expires at once: it stays
  out of the cache, of prefetch and of the shell that the image build prerenders without a backend.
- A page or layout that reads the session on the server before it renders is not split into
  layers and declares `export const instant = false`, which exempts it from the instant-navigation
  validation; a redirect from a layout needs a real status code, which streaming cannot give. The
  declaration does not remove a parent's loading boundary: a page nested under another page's
  address brings its own `loading.tsx`, or it shows that page's skeleton. Review holds this rule,
  because session dependence is a reading of a segment's data.
- On a catalog surface — cards, lists, lesson navigation, the product and programme pages — link to
  a lesson, product, programme or topic with `IntentPrefetchLink` from
  `@/shared/ui/intent-prefetch-link.client`: until touched it prefetches the shared route shell,
  and intent upgrades it to the shared part of that address. A return row of a catalog page uses
  it as well: its target is computed and is usually a catalog page. `prefetch={false}` has no place
  there. Links from the cabinet, purchase pages and state screens stay a plain `<Link>`. Review
  holds this rule: a guardrail cannot tell a catalog destination from a computed `href`.
- A catalog page declares `unstable_dynamicStaleTime`: for that window the browser keeps the page,
  personal part included. Other routes are read again on every transition. On a catalog page a
  control that must reach the server again — retry after a failure, a change of the guide mode, a
  confirmed purchase — calls `router.refresh()`; a link to the same address would be served from
  that memory. Leaving the authoring workspace for the site is a full document load for the same
  reason.
- Every page reaches an `error.tsx` inside its shell: `(public)` and `authoring` own a section
  boundary, catalog pages keep their own, `app/error.tsx` catches a failed section layout and
  `app/global-error.tsx` the root one. An unknown address and `notFound()` render `PageNotFound` in
  the public shell. `test/e2e/routes.spec.ts` checks the Russian 404; review holds the boundaries.
- A page with a parameter streams, so its `notFound()` arrives after status 200. Where web itself
  knows every valid address — today the legal section — `proxy.ts` checks the address before the
  response and rewrites an unknown one to an unrouted path, which Next.js answers with its own 404.
  Keep `matcher` literal. Review raw-header cookies: the proxy guardrail cannot detect them. Catalog
  addresses live in the backend and keep the soft 404 (ADR 0027).
- A component that reads the clock, randomness or a request value during render breaks the
  production build under Cache Components. Read it in an event handler or an effect.
- A page the reader left is hidden, not unmounted, and keeps its client state. State that starts
  from a server value follows that value when it changes; `ProductModeProvider` is the worked
  example. A surface that must reset on return resets itself.
- Review server session cookies read through `next/headers`; the Logto import guardrail cannot
  prove that session reads go through `@/shared/auth` and its prefetch-stopping `connection()`.
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
  Without the browser's inter-tab channel, the common mechanism announces writes to surfaces in
  the same tab through a window event. Other tabs see the write on their next read: opening or
  returning focus re-reads only when the cached answer is stale.
- Bookmark state and lists use Account-scoped query keys and announcement channels; guests make no
  personal read. People and Summary subscribe to enrollment writes; Invitations and Summary to
  invitation writes. `test/browser-engines/browser-facts.test.ts` checks two documents, Account
  switching with pending reads and the same-document fallback through the common announcement mechanism.
- Interactive writes use `useMutation` → browser adapter → same-origin capability Route Handler →
  generated Nest transport. The shared BFF boundary owns Origin, session, private no-store, timeout,
  and the default 2 MiB limit; a larger limit requires a named narrow override and boundary tests.
  Give each product operation its own named mutation and browser adapter with exact input/result
  types. Do not multiplex unrelated writes through `operation` or `mode`.
- Put `QueryProvider` in the lowest layout shared by its consumers.

## Interaction and enforcement

- Apply root [waiting rules](../../CODING_STANDARDS.md#waiting-in-tests) and
  [deterministic test contracts](../../CODING_STANDARDS.md#deterministic-test-contracts-1153).
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
  and platform tokens. The static cover is the same component with its loop stopped. An embedded
  video is not a site asset (owner decision of 2026-09-11). Design animation for its real slot, use
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
- Keep Web guardrails and negative fixtures aligned. Use mapping/query tests, Storybook for
  meaningful UI states, and Playwright for route behaviour and accessibility.

## Reader controls

Owner correction 2026-10-10 (#1336): Reader actions must stay compact and distinct from prose.

- Use `text-xs` (12 px) on phones and `text-sm` (14 px) from `sm` for Reader navigation and
  action labels, with 16–20 px icons. Keep the reading-state label visible; an empty circle
  alone does not explain the action.
- Keep touch targets at least 44 px high. Size ordinary action buttons to their labels with
  12 px horizontal padding and 8 px gaps; do not add a fixed broad width or oversized vertical
  padding. Full-width actions need a named layout reason.
- The upper lesson panel sits before metadata and the heading. On phones, both upper and lower
  panels show programme, bookmark and the written reading-state action in one row at normal
  text size. Allow reflow when text is enlarged. The upper panel has no next button. Keep previous and next
  arrows only in the floating mobile panel, with the lesson number on one line. Do not repeat
  the ordinal, product heading or large next button beneath the material on phones.
- On phones, use 22 px for the Reader title and 15 px with a 1.65 line height for its summary and
  prose; outcomes use 14 px. Keep the established desktop sizes from their breakpoints.
- A collapsed callout is one 44 px summary row; put body padding only inside its open content.
- A quiz uses the shared semantic result colors, a result icon and a written result. A person
  can change the answer directly; do not repeat the selected text or add a separate retry button.

The 44 px choice preserves comfortable touch targets while reducing visual bulk;
[W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced)
explains the enhanced size criterion. These sizes apply to Reader; they do not change other page
typography.
