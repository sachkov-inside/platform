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

## Recording baseline

This checkpoint intentionally removes the finished application Dockerfile and Compose topology so
the Docker delivery can be rebuilt from first principles. The separate Logto proof under
`infra/identity/logto` is unchanged.

Use the Node.js and pnpm versions pinned by the repository:

```bash
pnpm install --frozen-lockfile
cp .env.example .env
```

Repository checks do not require a shared application database. To run the application, provide a
PostgreSQL instance through `DATABASE_URL`, apply migrations and the development seed, then start
the host processes:

```bash
pnpm --filter @inside/backend db:migrate
pnpm --filter @inside/backend db:seed
pnpm dev
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

`pnpm check` is the normal code/build/UI gate and does not require a shared database.
`pnpm check:full` additionally runs isolated real-PostgreSQL integration tests and the host
full-stack smoke; that smoke needs the configured PostgreSQL and free ports `3000` and `3001`.

The API listens on `127.0.0.1:3001`, exposes `GET /health`, and serves OpenAPI
UI at `/openapi`.

For migrations, integration tests, manual database inspection and reset procedures, see the
[local development runbook](docs/runbooks/local-development.md). Version policy and current
compatibility holds are recorded in the
[dependency update policy](docs/runbooks/dependency-updates.md).
