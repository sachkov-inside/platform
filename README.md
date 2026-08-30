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

## Start the development stack

A fresh clone needs Docker with Compose; host Node.js is not required for the primary path.

```bash
docker compose up --build --watch
```

This starts PostgreSQL, a one-shot migration/seed bootstrap, Nest API, MCP and Next web. Open web at
<http://127.0.0.1:3000>, API health/OpenAPI at <http://127.0.0.1:3001/health> and
<http://127.0.0.1:3001/openapi>. Source changes synchronize through Compose Watch without host
`node_modules`; manifest and lockfile changes rebuild the affected images.

## Commands

```bash
pnpm compose:up    # optional host-pnpm wrapper for detached full Compose
pnpm compose:smoke

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
stack smoke. For that optional host gate, stop the full Compose stack and use postgres-only
`pnpm infra:up`, because the smoke owns host ports 3000 and 3001. Run `bash scripts/doctor.sh` for a
read-only Docker-only prerequisite and Compose-contract diagnosis. It does not require host Node,
pnpm or `.env`; `pnpm platform:doctor` is only a convenience alias for an installed host toolchain.

The API listens on `127.0.0.1:3001`, exposes `GET /health`, and serves OpenAPI
UI at `/openapi`.

## Docker-only smoke and shutdown

```bash
docker compose up --detach --build --wait
bash scripts/compose-stack-smoke.sh
docker compose down
```

The smoke verifies web → API → PostgreSQL, OpenAPI, MCP readiness and the idempotent seeded
Material. Normal shutdown preserves the named PostgreSQL volume; `docker compose down --volumes`
is an explicit destructive reset.

## Production delivery baseline

The production runtime uses prebuilt immutable API and web images, a one-shot migration service,
private application networking and Caddy as the only public entry point. It is intentionally
separate from the source-mounted development stack.

```bash
pnpm compose:production:smoke
```

See the [production delivery runbook](docs/runbooks/production-delivery.md) for the topology,
configuration contract and the boundary for the upcoming GitHub Actions deployment workflow.

For migrations, integration tests, manual database inspection and reset procedures, see the
[local development runbook](docs/runbooks/local-development.md). Version policy and current
compatibility holds are recorded in the
[dependency update policy](docs/runbooks/dependency-updates.md).
