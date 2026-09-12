# Web coding standards

This file is normative for `apps/web` changes and reviews. The nearest `AGENTS.md` owns routing and
verification; ADR 0011 owns the current Library/transport boundary and ADR 0012 owns browser
mutations.

## Slices and runtime boundaries

- Keep `app/` thin: routing, metadata, route states, and composition only. Product UI, presentation
  models, and data adapters live in feature-owned slices under `src`.
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

## Server state and mutations

- Give each server-state surface one runtime/cache owner. Browser-owned live search, filters, and
  infinite lists use one page-owned TanStack Query factory and feature BFF; RSC renders metadata and
  a hydration-safe shell without reading `searchParams`, prefetching, or dehydrating that query.
- When initial data must be server-rendered and continue in the browser, use one complete path:
  request-isolated `QueryClient`, prefetch, dehydration, and `HydrationBoundary`.
- Server-render-only data calls its server adapter directly. Query `staleTime` is browser-cache
  policy; HTTP cache policy belongs to the BFF/backend boundary.
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
- Keep Web guardrails and negative fixtures aligned with environment ownership, browser bypass,
  slice direction, mutation boundaries, and bundle limits. Use focused mapping/query tests,
  Storybook for meaningful UI states, and Playwright for route behaviour and accessibility.
