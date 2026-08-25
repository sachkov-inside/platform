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
- `apps/backend`: one NestJS codebase with thin API and MCP entrypoint adapters over shared
  application modules. A capability-specific worker is added only with its first durable job.

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

For a fresh local environment, run the repository-owned setup. It creates `.env` from the checked
example only when missing, checks prerequisites, starts PostgreSQL, applies migrations, seeds one
stable published Material and verifies live web/API processes:

```bash
pnpm local:setup
```

## Commands

```bash
pnpm dev          # web and API
pnpm dev:web
pnpm dev:api
pnpm dev:mcp

pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
pnpm check:full
```

`pnpm check` is the normal code/build/UI gate and does not require the shared Compose database.
`pnpm check:full` additionally runs isolated real-PostgreSQL integration tests and the live local
stack smoke; PostgreSQL must already be reachable. Use `pnpm platform:doctor` for a read-only
diagnosis of Node, pnpm, Docker, `.env` and development ports. The `platform:` prefix avoids
pnpm's unrelated built-in `doctor` command.

The API listens on `127.0.0.1:3001`, exposes `GET /health`, and serves OpenAPI
UI at `/openapi`.

## Local PostgreSQL and health smoke

The checked-in defaults are local-only values. Override them through an ignored root `.env`
copied from `.env.example` when needed. Compose and every backend entrypoint load that same file;
already exported environment variables take precedence.

```bash
pnpm infra:up
pnpm --filter @inside/backend db:seed
pnpm smoke:health
pnpm smoke:fullstack
pnpm infra:down
```

`infra:up` waits for PostgreSQL to become healthy. `smoke:health` boots the
Nest API in-process, calls `GET /health`, and proves the API can query that PostgreSQL
instance. The named volume is preserved by `infra:down`; use
`docker compose down --volumes` only when local data should be discarded.

`db:seed` is development-only and idempotently creates one representative published Material
through the Materials application interface; its fixed Topic/Format prerequisites use typed Kysely
bootstrap because no product taxonomy-authoring capability exists. `smoke:fullstack` applies
migrations and that seed, starts the development API and a production-built web process, verifies
the live web route plus the web server-only adapter against the live API, and stops only the
application processes it started.

For migrations, integration tests, manual database inspection and reset procedures, see the
[local development runbook](docs/runbooks/local-development.md).
