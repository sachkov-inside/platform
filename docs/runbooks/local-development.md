# Local development runbook

Docker Compose is the primary local-development contract. A fresh clone needs Docker with Compose,
not host Node.js or a host `node_modules` directory.

## What Compose runs

The default stack contains:

- PostgreSQL 18.4 with a persistent named volume;
- one `bootstrap` job that applies migrations and the deterministic development seed;
- Nest API on <http://127.0.0.1:3001> with health and OpenAPI endpoints;
- the long-running MCP process over the same application and database lifecycle;
- Next.js web on <http://127.0.0.1:3000>.

API and web expose real healthchecks. API and MCP wait for healthy PostgreSQL and a successful
bootstrap; web waits for healthy API. Storybook is an optional profile on
<http://127.0.0.1:6006>. Integration tests continue to use their own temporary PostgreSQL through
Testcontainers and never share the Compose database.

The production API exposes health, OpenAPI and the published Material Reader endpoint. Material
authoring remains an application interface covered by integration tests; this Compose work does
not invent a production authoring transport.

## Parallel worktrees and singleton ownership

The fixed `inside-platform` Compose project, host ports and PostgreSQL volume are shared by all
worktrees on one machine. At most one worktree or agent session owns them.

Before starting, run:

```bash
docker compose ps
```

Any running service belongs to another session unless the current session started it. Wait for its
handoff; do not rebuild, migrate, stop or reset that stack. The successful starter owns the stack
until that same session runs `docker compose down` and reports the shutdown. Integration tests are
safe in parallel because Testcontainers owns an isolated database.

Playwright does not use Compose. If another worktree owns its default port `3100`, use an available
explicit port such as `PLAYWRIGHT_PORT=3200 pnpm check`; never stop another worktree's process.

## Start from a fresh clone

From the repository root:

```bash
docker compose up --build --watch
```

This one command builds exact Node/pnpm development images, starts PostgreSQL, migrates and seeds
it once, then starts API, MCP and web. Compose Watch synchronizes backend and frontend source into
the containers without a host `node_modules`. A package manifest, workspace manifest or lockfile
change performs a controlled image rebuild.

The checked-in local credentials are defaults. A root `.env` copied from `.env.example` is optional
for overrides and for the host fallback; already exported variables take precedence. Inside the
Compose network, applications use `postgres` and `api` service DNS. Browser-facing URLs remain on
`127.0.0.1`.

For a detached stack suitable for smoke commands:

```bash
docker compose up --detach --build --wait
bash scripts/compose-stack-smoke.sh
```

The smoke proves the live web server adapter can reach API and PostgreSQL, MCP reported
database-backed readiness, and exactly one seeded `inside-platform-overview` Material with its two
stable lifecycle revisions exists. Repeating `docker compose down` and the detached startup
preserves the database volume and proves the bootstrap seed does not create another revision.

Stop without deleting data:

```bash
docker compose down
```

After shutdown, `docker compose ps --all` should list no application containers.

## Optional Storybook profile

Start the default stack plus Storybook:

```bash
docker compose --profile storybook up --build --watch
```

The profile uses the same frozen container dependencies and Compose Watch source synchronization.

## Optional host Node.js fallback

Use Node.js from `.node-version` and pnpm from `packageManager` only when a faster host loop is
useful:

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm infra:up
pnpm --filter @inside/backend db:migrate
pnpm --filter @inside/backend db:seed
pnpm dev
```

Individual adapters are `pnpm dev:web`, `pnpm dev:api` and `pnpm dev:mcp`. `pnpm local:setup` is a
host-pnpm convenience wrapper around the full detached Compose startup and smoke; it refuses to
reuse a running singleton stack.

Every backend process loads the optional repository `.env` once and parses one immutable
`PlatformConfig`. `NODE_ENV=development` enables checked-in local defaults; absent `NODE_ENV` is
production, where database and API listen values are required.

Inspect the running host fallback or Compose stack:

- health: <http://127.0.0.1:3001/health>
- OpenAPI UI: <http://127.0.0.1:3001/openapi>
- published Material API: <http://127.0.0.1:3001/materials/inside-platform-overview>
- production Reader: <http://127.0.0.1:3000/materials/inside-platform-overview>

The API health response is:

```json
{"process":"api","status":"ok","database":"reachable"}
```

`pnpm smoke:health` verifies Nest composition and the documented `tsx watch` API entrypoint.
`pnpm smoke:fullstack` remains the host-process fallback smoke against Compose PostgreSQL; it
starts the API and a production-built web process, verifies the published Reader on desktop and
mobile through Playwright, and exercises the server-only adapter against the live API.

## Repository verification

With pinned host Node.js and pnpm:

```bash
pnpm check
```

This covers lint, strict typecheck, backend architecture guardrails, unit/module/Storybook tests,
Playwright, production builds and the Storybook build without claiming a real database.

```bash
pnpm check:full
```

This adds isolated Testcontainers integration tests and the host full-stack smoke. Stop the full
Compose stack and start only `pnpm infra:up` first, because the host smoke owns ports 3000 and 3001.
CI runs that gate and a separate Docker-only contract that builds all image targets, starts a clean
volume, restarts against the preserved volume, exercises Compose Watch and rejects orphan
containers.

Run only the real-PostgreSQL backend suite with:

```bash
pnpm test:integration
```

Its disposable Testcontainers database covers create/load/revise, immutable revisions, rollback
and constraints, idempotency, concurrent stale writes, migration replay and generated-type drift.

## Inspect PostgreSQL

```bash
docker compose exec postgres psql -U inside -d inside
```

Useful read-only commands:

```sql
\dt
select name, timestamp from kysely_migration order by name;
select id, slug, current_draft_revision_id from materials order by created_at;
select id, material_id, title, schema_version, created_at
from material_revisions
order by created_at;
```

The seed is safe to repeat manually:

```bash
docker compose run --rm bootstrap
```

The seed refuses non-development mode, uses versioned idempotency keys and creates one free,
representative published Material at slug `inside-platform-overview`. Repeating it keeps the same
Material and upgrades an older local fixture to the current revision without resetting the named
volume. The Material itself is created, revised, validated and published through the Materials
application interface. Only its fixed local Topic/Format/Tag/Series prerequisites use typed Kysely
bootstrap because Platform has no product taxonomy-authoring capability yet; raw SQL is not used.

## Migration and generated-type checks

With the host fallback database running:

```bash
pnpm --filter @inside/backend db:migrate
pnpm --filter @inside/backend db:types:check
```

Only migration authors regenerate the checked-in Kysely type file:

```bash
pnpm --filter @inside/backend db:types:generate
```

The type commands read the repository `.env` and inspect only the product-owned `public` schema.

## Diagnose prerequisites

`bash scripts/doctor.sh` checks the same Docker-only prerequisites and Compose contract without
requiring host Node.js, pnpm or `.env`. The `pnpm platform:doctor` alias is available only as a
convenience when the optional host toolchain is already installed. Startup reports image,
dependency, health and port failures through `docker compose up` and `docker compose ps`.

Inspect service state and logs with:

```bash
docker compose ps
docker compose logs postgres bootstrap api mcp web
```

If a required port is occupied, inspect its owner and wait for the owning worktree's handoff. Do
not commit machine-specific ports or credentials and do not stop another session's process.

## Destructive reset

Normal shutdown preserves data. Only the current singleton owner may explicitly delete the local
database volume:

```bash
docker compose down --volumes
docker compose up --detach --build --wait
```

This does not affect disposable Testcontainers databases. Never use `--volumes` as routine
shutdown.
