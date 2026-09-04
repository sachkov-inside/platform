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

The separately built, non-service Go Workshop evaluator lives under `tools/workshop-evaluator`.
Its canonical wire schemas and cross-language conformance corpus live under `contracts/workshop`;
neither participant code nor evaluator execution enters the Platform API/worker runtime.

The backend also owns the production Telegram Membership consumer. Authenticated Account requests
begin and confirm a short-lived `/start` link through the provider HTTP adapter; authenticated
evidence enters a durable inbox and updates `MembershipEntitlements`. Material and profile reads
continue to use only the local PostgreSQL projection and never call Telegram. The controlled
compatibility evidence is recorded in
[`docs/verification/telegram-membership-conformance.md`](docs/verification/telegram-membership-conformance.md).

## Start the development stack

A fresh clone needs Docker with Compose; host Node.js is not required for the primary path.

```bash
docker compose up --build
```

This starts PostgreSQL, one-shot migration and development seed jobs, Nest API, MCP and Next web. Open web at
<http://127.0.0.1:3000>, API health/OpenAPI at <http://127.0.0.1:3001/health> and
<http://127.0.0.1:3001/openapi>, and MCP at <http://127.0.0.1:3002/mcp>. Rebuild the affected
service after a source or dependency change, or use the host `pnpm dev*` commands for a faster
development loop.

## Commands

```bash
pnpm compose:up    # optional host-pnpm wrapper for detached full Compose
pnpm compose:smoke

pnpm dev          # web and API
pnpm dev:web
pnpm dev:api
pnpm dev:mcp
pnpm dev:video-deletions-worker

pnpm docs:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
pnpm check:full

pnpm workshop:contracts:check
pnpm workshop:evaluator:test
pnpm workshop:evaluator:generate
```

`pnpm docs:check` validates agent-document pointers and current Materials documentation invariants.
`pnpm check` includes it as the first normal code/build/UI gate and does not require the shared
Compose database.
`pnpm check:full` additionally runs isolated real-PostgreSQL integration tests and the live local
stack smoke. For that optional host gate, stop the full Compose stack and use postgres-only
`pnpm infra:up`, because the smoke owns host ports 3000, 3001 and 3002. Run
`bash scripts/doctor.sh` for a read-only Docker-only prerequisite and Compose-contract diagnosis.
It does not require host Node, pnpm or `.env`; `pnpm platform:doctor` is only a convenience alias for
an installed host toolchain.

Pull requests into `main` run four parallel application checks and the required aggregate
`CI Gate`. See the [continuous integration runbook](docs/runbooks/continuous-integration.md) for
the exact jobs, security boundary, diagnostics, cleanup and future release reuse contract.
Changes to Workshop schemas or evaluator source additionally build, execute and checksum native
artifacts on the three beta hosts. The evaluator's own
[`README`](tools/workshop-evaluator/README.md) documents that bounded workflow.

See the [runtime configuration contract](docs/runbooks/runtime-configuration.md) for the typed
NestJS and Next.js configuration model, local `.env`, server-owned production env files and Docker
Compose precedence.

The API listens on `127.0.0.1:3001`, exposes `GET /health`, and serves OpenAPI
UI at `/openapi`.

Telegram Membership exposes authenticated Account link begin at
`POST /accounts/current/telegram-link`, confirmation/poll at
`POST /accounts/current/telegram-link/:linkRef/confirm`, and provider evidence ingress at
`POST /integrations/telegram/v1/membership-evidence`.

The stateless Streamable HTTP MCP resource server listens on `127.0.0.1:3002/mcp`. It accepts only
a short-lived Logto-compatible bearer token for an existing Account; every tool call independently
requires the current database-backed `materials:manage` permission. Its four tools create a draft,
load current full state, atomically Save full state and Preview through canonical ContentAccess.
The local adapter does not provision Logto clients, service identities or production routing.

## Docker-only smoke and shutdown

```bash
docker compose up --detach --build --wait
bash scripts/compose-stack-smoke.sh
docker compose down
```

The smoke verifies web → API → PostgreSQL, OpenAPI, MCP protected-resource metadata, the
unauthenticated fail-closed boundary and the idempotent seeded Material. Normal shutdown preserves
the named PostgreSQL volume; `docker compose down --volumes`
is an explicit destructive reset.

## Production delivery baseline

The versioned release pipeline builds the exact current `main`, reruns CI, publishes public backend
and web GHCR images, and records the next ordinal `vN` in an immutable manifest plus versioned
runtime bundle. Release consumers identify images and deployment files by digest, never by a moving
tag or a server checkout.

The manual production workflow queues deploy/rollback commands, rechecks the immutable release and
streams it through a forced `inside-deploy` SSH command. The host serializes operations, drains old
workers, runs forward migrations for deploy, proves readiness and read-only smoke, then records the
exact version/schema state before restoring public Caddy routes. Rollback is manual, changes no
database state and is available for 24 hours only with exact previous-image schema evidence.

```bash
pnpm compose:production:smoke
```

See the [production delivery runbook](docs/runbooks/production-delivery.md) for the topology,
release/deploy commands, manifest contract, runtime configuration, failure recovery and rollback
boundary.

For migrations, integration tests, manual database inspection and reset procedures, see the
[local development runbook](docs/runbooks/local-development.md). Version policy and current
compatibility holds are recorded in the
[dependency update policy](docs/runbooks/dependency-updates.md).
