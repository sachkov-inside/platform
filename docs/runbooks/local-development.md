# Local development runbook

Docker Compose is the primary local-development contract. A fresh clone needs Docker with Compose,
not host Node.js or a host `node_modules` directory.

## What Compose runs

The default stack contains:

- PostgreSQL 18.4 with a persistent named volume;
- MinIO with separate public-delivery, protected and quarantine buckets; its S3-compatible API is
  on <http://127.0.0.1:9000> and console is on <http://127.0.0.1:9001>;
- one `migrations` job that applies the schema and one `seed` job that adds deterministic
  development data;
- Nest API on <http://127.0.0.1:3001> with health and OpenAPI endpoints;
- the long-running MCP process at <http://127.0.0.1:3002/mcp> over the same application and database
  lifecycle;
- `material-assets-worker`, which consumes the durable `pg-boss` cleanup queue and has no HTTP
  listener;
- `profile-avatars-worker`, which consumes the independent durable ProfileAvatar cleanup queue and
  has no HTTP listener;
- Next.js web on <http://127.0.0.1:3000>.

The optional Logto email-code proof is a separate, disposable Compose project with isolated ports
and volumes. Its pinned build, automated Management API bootstrap and Mailpit capture are
documented in [`infra/identity/logto/README.md`](../../infra/identity/logto/README.md). Run
`pnpm identity:proof:start`; it starts the shared Platform PostgreSQL, applies normal repository
migrations and runs the application without Logto Console setup. The launcher claims the same
machine-wide ownership lock as `local:setup`, refuses an already running Platform or proof Compose
project, and stops only the environments it claimed when the process exits.

For the destructive, clean-volume #116 security corpus use `pnpm identity:proof:hardening` instead.
It owns different Compose project names and ports, proves the pinned Logto recipient cap, callback
and dependency recovery behavior, verifies one local `Account` and no Platform session table, then
removes only its disposable volumes.

API and web expose real healthchecks. API, MCP, the Material Asset worker and the Profile Avatar
worker wait for healthy PostgreSQL and a successful seed; web waits for healthy API. Storybook is
an optional profile on <http://127.0.0.1:6006>. Integration tests continue to use their own
temporary PostgreSQL and MinIO through Testcontainers and never share the Compose data services.

The production API exposes health, OpenAPI, the published catalog and the Material Reader endpoint.
The local MCP adapter exposes delegated Material authoring over production application interfaces;
production Logto client setup and public routing remain separate deployment work.

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
docker compose up --build
```

This one command builds exact Node/pnpm development images, starts PostgreSQL, migrates and seeds
it once, then starts API, MCP and web. Rebuild the affected service after a source, package
manifest, workspace manifest or lockfile change. For a faster edit loop, use the optional host
Node.js commands below.

The checked-in `config/compose/local/*.env` files contain safe container-only development values.
A root `.env` copied from `.env.example` is optional for host-process overrides and Compose host
ports; already exported variables take precedence. Next.js host fallback uses the same checked-in
defaults or variables exported by its launcher shell. Inside the Compose network, applications use
`postgres` and `api` service DNS.
Browser-facing URLs remain on `127.0.0.1`. See the
[runtime configuration contract](runtime-configuration.md) for ownership, precedence, validation,
and the production env-file boundary.

The API creates only the three named local buckets in development mode. Objects use random,
immutable keys and are never written over. The persistent `object-storage-data` volume follows the
same ownership and non-destructive restart rules as PostgreSQL.

Local development uses `KINESCOPE_PROVIDER_MODE=test`. It creates deterministic provider facts for
upload-init, attach, processing reconciliation and playback without a real credential or outbound
Kinescope call; its reserved `.invalid` upload endpoint makes the browser complete the simulated
transfer immediately. Exact Tus and provider callback behavior is covered at the adapter boundary; real
upload/playback acceptance still requires the owner-gated contour described in issue #183. Switch
to `real` only in a private environment with the full Kinescope configuration from
[the runtime contract](runtime-configuration.md); never paste credentials into the repository or
issue evidence.

For a detached stack suitable for smoke commands:

```bash
docker compose up --detach --build --wait
bash scripts/compose-stack-smoke.sh
```

The smoke proves the live web server adapter can reach API and PostgreSQL, MCP reported
database-backed readiness, one stable free `kak-ustroen-inside-platform` Material with current
stored content and one safe closed catalog Material. Repeating `docker compose down` and the
detached startup preserves the database volume and proves the development seed remains stable.

Stop without deleting data:

```bash
docker compose down
```

After shutdown, `docker compose ps --all` should list no application containers.

## Optional Storybook profile

Start the default stack plus Storybook:

```bash
docker compose --profile storybook up --build
```

The profile uses the same frozen container dependencies as the default stack.

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

The MCP adapter uses stateless Streamable HTTP at `MCP_SERVER_URL` (local default
`http://127.0.0.1:3002/mcp`). It verifies a short-lived Logto-compatible bearer token, resolves its
issuer/subject to an existing Account and checks the Account's current `materials:manage`
permission inside each production authoring operation. Provider roles and scopes do not grant
access, and the adapter has no service identity or provider secret.

The exposed tools are `material_create_draft`, `material_load`, `material_save` and
`material_preview`. Save replaces content, metadata, current relations, access and publication
state atomically using `expectedContentVersion`; it can affect live content and has no server-side
Undo/history. Preview uses canonical ContentAccess. MCP clients can discover the protected resource
metadata at `/.well-known/oauth-protected-resource/mcp` and send the delegated token in the
`Authorization: Bearer` header. Production provider setup and public routing remain outside this
repository task.

NestJS loads the optional repository `.env` through `@nestjs/config`, validates it with Zod, and
injects one immutable `PlatformConfig`. Next.js validates one server-only `WebRuntimeConfig` during
Node.js server startup. `NODE_ENV=development` enables checked-in local defaults; absent
`NODE_ENV` is production, where all runtime values are required.

Inspect the running host fallback or Compose stack:

- health: <http://127.0.0.1:3001/health>
- OpenAPI UI: <http://127.0.0.1:3001/openapi>
- local S3-compatible endpoint: <http://127.0.0.1:9000>
- local Object Storage console: <http://127.0.0.1:9001>
- MCP Streamable HTTP endpoint: <http://127.0.0.1:3002/mcp>
- MCP protected-resource metadata: <http://127.0.0.1:3002/.well-known/oauth-protected-resource/mcp>
- published Material API: <http://127.0.0.1:3001/materials/kak-ustroen-inside-platform>
- published catalog API: <http://127.0.0.1:3001/library/materials>
- Material authoring OpenAPI group: <http://127.0.0.1:3001/openapi#/Material%20authoring>
- production Library: <http://127.0.0.1:3000/library>
- production Reader: <http://127.0.0.1:3000/materials/kak-ustroen-inside-platform>

The API health response is:

```json
{"process":"api","status":"ok","database":"reachable"}
```

`pnpm smoke:health` verifies Nest composition and the documented `tsx watch` API entrypoint.
`pnpm smoke:fullstack` remains the host-process fallback smoke against Compose PostgreSQL; it
starts the API and a production-built web process, verifies the published Reader on desktop and
mobile through Playwright, exercises the server-only adapter against the live API, and uses a
signed delegated owner token to create/reload, publish, Preview and unpublish one stable Material
through the live MCP process.

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
Compose stack and start only `pnpm infra:up` first, because the host smoke owns ports 3000, 3001 and
3002. Pull requests into `main` run the complete application and Docker Compose gate on clean
GitHub-hosted runners; see [Continuous integration](continuous-integration.md) for its job and
failure-diagnostics contract.

Run only the real-PostgreSQL backend suite with:

```bash
pnpm test:integration
```

Its disposable Testcontainers database covers create/load/Save, mutable current Materials,
rollback and constraints, idempotency, concurrent stale writes, migration replay and Prisma schema
mapping.

## Inspect PostgreSQL

```bash
docker compose exec postgres psql -U inside -d inside
```

Useful read-only commands:

```sql
\dt materials.*
select position, name, checksum, applied_at
from public.platform_migrations
order by position;
select id, slug, publication_state, content_version, updated_at
from materials.materials
order by created_at;
```

The migration and seed jobs are safe to repeat manually:

```bash
docker compose run --rm migrations
docker compose run --rm seed
```

The seed refuses non-development mode, uses stable idempotency keys, and creates twelve free
published Materials for catalog pagination: `kak-ustroen-inside-platform` plus eleven architecture
notes. It also creates one Membership Material whose body remains absent from the public catalog.
Repeating the seed keeps the same Materials and upgrades the representative fixture without
resetting the named volume. Materials are created and published through the Materials application
interface; only fixed local Topic/Format/Tag/Series prerequisites use Prisma model operations
because Platform has no product taxonomy-authoring capability yet.

## Migration and Prisma schema checks

With the host fallback database running:

```bash
pnpm --filter @inside/backend db:migrate
pnpm --filter @inside/backend db:schema:check
```

`db:schema:check` validates `prisma/schema.prisma` and regenerates the ignored TypeScript client.
The same generation runs during install, build, and typecheck:

```bash
pnpm --filter @inside/backend prisma:generate
```

The Prisma schema maps the product-owned `materials`, `assets`, `accounts`, `member_profiles`,
`membership_entitlements` and `telegram_membership` schemas. Checked-in,
append-only SQL migrations remain the database authority. Their explicit positions and checksums
must form an exact registry prefix, rejecting drift, gaps, reordering, and newer unknown migrations;
generated client files are not committed or edited. A pre-Prisma local volume must be recreated
with the destructive reset below rather than supported by application compatibility code.

## Owner Account release bootstrap

After migrations and before serving production traffic, confirm that the owner exists in Logto and
run the explicit idempotent release command with that exact identity:

```bash
OWNER_LOGTO_ISSUER=https://auth.example.com/oidc \
OWNER_LOGTO_SUBJECT=<opaque-logto-subject> \
pnpm --filter @inside/backend release:bootstrap-owner
```

The command ensures one Account and `materials:manage`, writes only redacted Account audit events,
and prints a JSON summary. It does not run from an application startup hook or public route and does
not need the owner's email. Repeating it reports that no Account or permission was created.

## Manual Member Profile moderation

Use the owner-only release operation to disable or restore the exact Profile by opaque identity
without exposing a public admin route or participant reporting flow:

```bash
PROFILE_MODERATION_ACTION=disable \
PROFILE_PUBLIC_ID=<opaque-public-profile-id> \
pnpm --filter @inside/backend release:moderate-profiles
```

Use `PROFILE_MODERATION_ACTION=restore` with the same `PROFILE_PUBLIC_ID` to restore it. Disable
increments the Profile version and writes redacted audit metadata; the operation never prints
Profile fields, Account identity, Membership evidence or provider data.

## Diagnose prerequisites

`bash scripts/doctor.sh` checks the same Docker-only prerequisites and Compose contract without
requiring host Node.js, pnpm or `.env`. The `pnpm platform:doctor` alias is available only as a
convenience when the optional host toolchain is already installed. Startup reports image,
dependency, health and port failures through `docker compose up` and `docker compose ps`.

Inspect service state and logs with:

```bash
docker compose ps
docker compose logs postgres migrations seed api mcp web
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
