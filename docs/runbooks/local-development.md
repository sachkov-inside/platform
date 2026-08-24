# Local development runbook

Use this runbook to start Platform locally, verify the backend against PostgreSQL and inspect the
development database. Run commands from the repository root.

## What runs where

- `docker compose` runs PostgreSQL 18.4 and keeps its data in the named
  `inside-platform_postgres-data` volume.
- API, worker, MCP and web processes run through local Node.js and pnpm commands.
- Integration tests start their own temporary PostgreSQL container through Testcontainers. They do
  not read or modify the Compose database and remove their databases and container after the run.

The current production API exposes health and OpenAPI endpoints. Material create/load/revise is an
application interface covered by integration tests; it does not yet have a production HTTP or MCP
transport.

## Parallel worktrees and Compose ownership

The checked-in Compose project has one fixed project name, host port and named volume shared by all
worktrees on the same machine. Treat this environment as a singleton:

- At most one active worktree or agent session owns the `inside-platform` Compose environment.
- The session that successfully runs `pnpm infra:up` owns it until that same session runs
  `pnpm infra:down` and reports the shutdown in its handoff.
- A running `inside-platform` Compose project is owned by another session unless the current
  session started it. Other sessions use `pnpm test:integration`, whose Testcontainers database is
  isolated, or wait for the owner; they do not run migrations, smoke, shutdown or reset against the
  shared Compose database.
- Only the current Compose owner may run `docker compose down --volumes`, after confirming that its
  local data can be discarded.

Check whether the shared environment is already running before claiming it:

```bash
docker compose ps
```

## First-time setup

Prerequisites are Docker with Compose, the Node.js version from `.node-version`, and the pnpm
version declared in `package.json`.

```bash
cp .env.example .env
pnpm install --frozen-lockfile
```

The checked-in `.env.example` contains local-only credentials. Keep personal overrides in the
ignored root `.env`; already exported environment variables take precedence.

Every backend process loads that repository environment once and then parses one immutable
`PlatformConfig`. `NODE_ENV=development` in `.env.example` explicitly enables the checked-in local
database and listen defaults; an absent `NODE_ENV` is treated as production, where `DATABASE_URL`,
`API_HOST` and `API_PORT` are required. Readiness queries the same Platform-owned Kysely connection
pool used by application modules. The worker's PgBoss connections remain a separate,
library-owned lifecycle.

## Start and verify the local stack

Start PostgreSQL, apply checked-in migrations, and verify API-to-database connectivity:

```bash
pnpm infra:up
pnpm --filter @inside/backend db:migrate
pnpm smoke:health
```

For an interactive API process, keep this command running in a separate terminal:

```bash
pnpm dev:api
```

Then inspect:

- health: <http://127.0.0.1:3001/health>
- OpenAPI UI: <http://127.0.0.1:3001/openapi>

Expected health response:

```json
{"process":"api","status":"ok","database":"reachable"}
```

Stop application processes with `Ctrl+C`. Stop Compose without deleting local data:

```bash
pnpm infra:down
```

## Test the Material flow

Run the complete repository gate:

```bash
pnpm check
```

Run the real-PostgreSQL backend suite:

```bash
pnpm test:integration
```

The Material integration tests exercise the public application interface and prove:

- create, load and revise flows;
- immutable revisions and the current-draft pointer;
- transaction rollback and PostgreSQL constraints;
- idempotency replay and stale concurrent writes;
- migration replay and generated database type drift.

Docker must be running for integration tests, but `pnpm infra:up` is not required because
Testcontainers owns an isolated PostgreSQL container for the test run.

## Inspect the Compose database

Open `psql` inside the PostgreSQL container:

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

Exit `psql` with `\q`.

The Compose database is empty after its first migration. Integration-test Material data is not
visible here because those tests intentionally use isolated temporary databases.

## Migration and generated-type checks

Apply all pending migrations. Repeating the command is safe and reports no newly applied
migrations when the database is current.

```bash
pnpm --filter @inside/backend db:migrate
```

Verify checked-in Kysely database types against the migrated Compose database:

```bash
pnpm --filter @inside/backend db:types:check
```

The type commands read the repository root `.env` explicitly and inspect only the product-owned
`public` schema. Complete the first-time setup before running them. The `pgboss` schema is owned by
the worker library and is deliberately absent from the generated application database types.

Only migration authors should regenerate and commit the type file:

```bash
pnpm --filter @inside/backend db:types:generate
```

## Reset local PostgreSQL

Normal shutdown preserves the named volume:

```bash
pnpm infra:down
```

To deliberately delete all local Compose database data and rebuild from migrations:

```bash
docker compose down --volumes
pnpm infra:up
pnpm --filter @inside/backend db:migrate
```

`docker compose down --volumes` is destructive for the local Compose database. It does not affect
the isolated Testcontainers databases, which are disposable by design.

## Troubleshooting

Inspect container state and PostgreSQL logs:

```bash
docker compose ps
docker compose logs postgres
```

If port `5432` is already occupied, either stop the conflicting local PostgreSQL process or set a
different Compose port and matching `DATABASE_URL` locally. Do not commit machine-specific ports
or credentials.

Always run `pnpm infra:down` when a manual smoke session is complete.
