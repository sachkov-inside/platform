# Local development runbook

This recording-baseline checkpoint intentionally has no root application Dockerfile, `.dockerignore`
or Compose topology. The application Docker delivery is rebuilt in later checkpoint commits.
The separate Logto proof under [`infra/identity/logto`](../../infra/identity/logto/README.md) is not
part of that reset.

## Parallel worktrees and runtime ownership

An existing `inside-platform` Compose project may have been started from another checkout. Its
containers, fixed host ports and PostgreSQL volume belong to that checkout and session.

Inspect ownership without changing it:

```bash
docker ps --filter label=com.docker.compose.project=inside-platform
docker inspect <container> \
  --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}'
```

Do not rebuild, migrate, stop or reset a project owned by another checkout. This stripped baseline
does not claim a Compose runtime. Testcontainers databases remain isolated and may run in parallel.

Playwright does not use Compose. If another worktree owns its default port `3100`, use an available
explicit port such as `PLAYWRIGHT_PORT=3200 pnpm check`.

## Separate Logto proof

The optional Logto email-code proof is a separate, disposable Compose project with isolated ports
and volumes. Its pinned build, automated Management API bootstrap and Mailpit capture are documented
in [`infra/identity/logto/README.md`](../../infra/identity/logto/README.md).

The destructive clean-volume security corpus remains available through:

```bash
pnpm identity:proof:hardening
```

It owns distinct Compose project names and ports, proves the pinned Logto recipient cap, callback
and dependency recovery behavior, verifies one local `Account` and no Platform session table, then
removes only its disposable volumes.

## Install the host toolchain

Use Node.js from `.node-version` and pnpm from the root `packageManager` field:

```bash
pnpm install --frozen-lockfile
cp .env.example .env
```

Every backend process loads the optional repository `.env` once and parses one immutable
`PlatformConfig`. `NODE_ENV=development` enables checked-in local defaults; absent `NODE_ENV` is
production, where database and API listen values are required.

## Provide PostgreSQL

Application runtime commands require a PostgreSQL instance reachable through `DATABASE_URL`.
This checkpoint does not provision one. After choosing an isolated database owned by the current
session, apply migrations and the deterministic development seed:

```bash
pnpm --filter @inside/backend db:migrate
pnpm --filter @inside/backend db:seed
```

The Prisma schema maps the product-owned `materials` and `accounts` schemas. Checked-in,
append-only SQL migrations are the database authority. Their positions and checksums must form an
exact registry prefix; regenerate the ignored Prisma client instead of editing it:

```bash
pnpm --filter @inside/backend db:schema:check
pnpm --filter @inside/backend prisma:generate
```

## Start host processes

Start web and API together, or run each adapter separately:

```bash
pnpm dev
pnpm dev:web
pnpm dev:api
pnpm dev:mcp
```

Useful surfaces:

- web: <http://127.0.0.1:3000>;
- API health: <http://127.0.0.1:3001/health>;
- OpenAPI: <http://127.0.0.1:3001/openapi>;
- Library: <http://127.0.0.1:3000/library>;
- Reader: <http://127.0.0.1:3000/materials/inside-platform-overview>.

The expected health response is:

```json
{"process":"api","status":"ok","database":"reachable"}
```

`pnpm smoke:health` verifies Nest composition and the documented `tsx watch` API entrypoint.
`pnpm smoke:fullstack` starts the host API and a production-built web process, then verifies the
Library and Reader through Playwright. It requires the configured database and owns ports `3000`
and `3001` for the duration of the smoke.

## Repository verification

The normal code, build and UI gate does not require a shared PostgreSQL instance:

```bash
pnpm check
```

Run the isolated real-PostgreSQL backend suite through Testcontainers:

```bash
pnpm test:integration
```

The complete host path requires both Docker for Testcontainers and a separately provided
`DATABASE_URL` for the full-stack smoke:

```bash
pnpm check:full
```

## Owner Account release bootstrap

After migrations and before serving production traffic, confirm that the owner exists in Logto and
run the explicit idempotent release command with that exact identity:

```bash
OWNER_LOGTO_ISSUER=https://auth.example.com/oidc \
OWNER_LOGTO_SUBJECT=<opaque-logto-subject> \
pnpm --filter @inside/backend release:bootstrap-owner
```

The command ensures one Account and `materials:manage`, writes only redacted Account audit events,
and prints a JSON summary. It does not run from an application startup hook or public route and
does not need the owner's email.
