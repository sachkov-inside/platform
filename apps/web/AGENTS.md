# Web

## Role

`apps/web` is the single production frontend: Next.js App Router renders routes, while product UI,
presentation models, and data adapters live in feature-owned slices under `src`. Keep `app/` thin:
it owns routing, metadata, route states, and composition.

## Required context

Before changing or reviewing Web code, apply [`CODING_STANDARDS.md`](CODING_STANDARDS.md). For
production UI, Storybook, responsive behaviour, accessibility, or owner-review evidence, also read
[`docs/agents/frontend-delivery.md`](../../docs/agents/frontend-delivery.md).

Read [`ADR 0011`](../../docs/adr/0011-client-owned-library-catalog.md) when changing Library data
ownership, generated transport, direct RSC calls, or same-origin BFF boundaries. Read
[`ADR 0012`](../../docs/adr/0012-browser-owned-interactive-mutations.md) when changing interactive
writes or proposing Server Actions.

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
