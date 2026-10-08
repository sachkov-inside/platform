# Web

`apps/web` is the single production frontend.

## Required context

Before changing or reviewing Web code, apply [`CODING_STANDARDS.md`](CODING_STANDARDS.md). For
production UI, Storybook, responsive behaviour, accessibility, or owner-review evidence, also read
[`docs/agents/frontend-delivery.md`](../../docs/agents/frontend-delivery.md).

Read the owning ADR before changing:

- Library data ownership, generated transport, direct RSC calls, or same-origin BFF boundaries:
  [ADR 0011](../../docs/adr/0011-client-owned-library-catalog.md);
- interactive writes or a proposed Server Action:
  [ADR 0012](../../docs/adr/0012-browser-owned-interactive-mutations.md);
- a public route, a loading state, a `"use cache"` read, link prefetch, a `GET` Route Handler, the
  unknown-address check in `proxy.ts` or TanStack freshness:
  [ADR 0027](../../docs/adr/0027-web-navigation-and-caching.md);
- security headers, the CSP, the entry-route rate limit in `proxy.ts`, a sign-in, payment or
  public-link entry route, or a guest browser-report handler:
  [ADR 0028](../../docs/adr/0028-web-edge-hardening.md).

## Verification

- Test presentation mapping and query behaviour as focused module tests; represent meaningful UI
  states in Storybook; use Playwright for route behaviour and accessibility.
- Check page transitions on a production build: `pnpm --filter @inside/web test:navigation`.
- Run the full-stack Playwright path, `pnpm smoke:fullstack`, when a backend contract, BFF route,
  query ownership, or production data flow changes.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
