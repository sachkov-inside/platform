# platform
Sachkov Inside membership platform

## Product and application contract

- [`docs/product/platform-mvp-brief.md`](docs/product/platform-mvp-brief.md): canonical product scope;
- [`docs/specifications/platform-v1.md`](docs/specifications/platform-v1.md): modules, logical model,
  flows, application NFR, production foundation order and ADR inputs;
- [`CONTEXT.md`](CONTEXT.md): canonical application terminology.

## Architecture

The repository is a pnpm workspace with two applications:

- `apps/web`: Next.js App Router process;
- `apps/backend`: one NestJS codebase with API, `pg-boss` worker and MCP entrypoint adapters
  over shared application modules.

The process-layout decision is recorded in
[`ADR 0001`](docs/adr/0001-one-backend-multiple-entrypoints.md).

## Prerequisites

- Node.js version pinned in [`.node-version`](.node-version);
- pnpm version pinned by `packageManager` in [`package.json`](package.json);
- Docker with Compose.

Install from the committed lockfile:

```bash
pnpm install --frozen-lockfile
```

## Commands

```bash
pnpm dev          # web and API
pnpm dev:web
pnpm dev:api
pnpm dev:worker
pnpm dev:mcp

pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
```

The API listens on `127.0.0.1:3001`, exposes `GET /health`, and serves OpenAPI
UI at `/openapi`.

## Local PostgreSQL and health smoke

The checked-in defaults are local-only values. Override them through an ignored root `.env`
copied from `.env.example` when needed. Compose and every backend entrypoint load that same file;
already exported environment variables take precedence.

```bash
pnpm infra:up
pnpm smoke:health
pnpm infra:down
```

`infra:up` waits for PostgreSQL to become healthy. `smoke:health` boots the
Nest API in-process, calls `GET /health`, and proves the API can query that PostgreSQL
instance. The named volume is preserved by `infra:down`; use
`docker compose down --volumes` only when local data should be discarded.

The worker starts and stops `pg-boss` with its process lifecycle. This provisions only
`pg-boss`'s library-owned PostgreSQL schema; product queues and jobs are intentionally absent.

For migrations, integration tests, manual database inspection and reset procedures, see the
[local development runbook](docs/runbooks/local-development.md).
