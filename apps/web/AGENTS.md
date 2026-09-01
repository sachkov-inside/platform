# Web

## Role

`apps/web` is the single production frontend: Next.js App Router renders routes, while product UI,
presentation models, and data adapters live in feature-owned slices under `src`. Keep `app/` thin:
it owns routing, metadata, route states, and composition.

## Slice boundaries

- `_app` owns root providers and the application shell; `_pages` owns route-level slices;
  `widgets`, `features`, `entities`, and `shared` form the remaining dependency layers.
- Import a slice through a public entrypoint. Prefer a focused sub-entrypoint when a broad barrel
  would pull editor or server code into another runtime graph. The architecture guardrail enforces
  downward layer imports and slice isolation.
- Put route-specific behaviour beside its `_pages/<page>` slice. Promote code to `shared` only
  after multiple real consumers need the same smaller interface.
- Keep Storybook proofs and fixtures outside the production graph. When changing production UI,
  Storybook, responsive behaviour, accessibility, or owner-review evidence, follow
  [`docs/agents/frontend-delivery.md`](../../docs/agents/frontend-delivery.md).

## Server data

- Mark direct backend adapters, BFF handlers, and server query options with `server-only`. Mark the
  interactive boundary with `*.client.tsx`; client modules import no server-only interface.
- Treat backend payloads as `unknown`, validate them with Zod in the owning adapter, and map them to
  a presentation model before UI code consumes them.
- Choose one runtime owner for each server-state surface. Browser-owned live search, filters, and
  infinite lists use one page-owned TanStack Query factory and a same-origin feature BFF; the RSC
  route renders only metadata and a hydration-safe shell. Browser code parses and normalizes the
  URL; the route does not read `searchParams`, prefetch or dehydrate that query.
- When initial results must be server-rendered and then continue in the browser, use the complete
  TanStack SSR path: a request-isolated `QueryClient`, prefetch, dehydration and
  `HydrationBoundary`. Do not maintain parallel server and browser cache paths for convenience.
- For server-render-only data with no browser lifecycle, call the server adapter directly instead
  of adding TanStack Query. Query `staleTime` is client-cache policy, not an HTTP cache header;
  declare public or private HTTP caching at the BFF/backend boundary.
- Interactive writes use one path: `useMutation` → browser adapter → same-origin capability Route
  Handler → generated Nest transport. Put the `QueryProvider` in the lowest route layout shared by
  its consumers. The current client-owned mutation contract is recorded in
  [`ADR 0012`](../../docs/adr/0012-browser-owned-interactive-mutations.md).

## Verification

- Test presentation mapping and query behaviour as focused module tests; represent meaningful UI
  states in Storybook; use Playwright for route behaviour and accessibility.
- Run focused web checks while iterating, then root `pnpm check` before handoff. Run the full-stack
  Playwright path when a backend contract, BFF route, query ownership, or production data flow
  changes.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
