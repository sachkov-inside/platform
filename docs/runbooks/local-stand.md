# Local stand

Docker Compose is the primary local-development contract. A fresh clone needs Docker with Compose,
not host Node.js or a host `node_modules` directory. Image inputs follow the
[official image acquisition contract](continuous-integration.md#official-image-inputs).
Other local procedures are listed in the [local development index](local-development.md).

## Terms

- **Compose project**: one named set of containers, networks and volumes. `COMPOSE_PROJECT_NAME`
  selects it; the repository default is `inside-platform`.
- **Stack**: the services one Compose project runs. `docker compose up` starts the default stack;
  [Compose stack contents](local-compose-stack.md) lists them.
- **Stand**: the shared `inside-platform` project started through `pnpm local:stand`, with
  sign-in, the bank double and mail capture. Its volumes hold the owner's product data, accounts,
  purchases and progress.

## Parallel worktrees and singleton ownership

The fixed `inside-platform` Compose project, host ports and volumes are shared by all worktrees on
one machine. One session owns them at a time.

Before any repository Compose command, run:

```bash
docker compose ps
```

A running service belongs to the owner or to another session unless the current session started
it. Leave it running and ask the owner before stopping, rebuilding, migrating or resetting it; wait
for the answer or for the owning session's handoff. The session that started the stack owns it
until it runs `docker compose down` and reports the shutdown.

Integration tests are safe in parallel because Testcontainers owns an isolated database.
Playwright does not use Compose. The Playwright checks of `pnpm check` take free ports from the
reserved range of `scripts/smoke-stand.mjs` (#896), so checks in two worktrees run side by side.
`PLAYWRIGHT_PORT`, `NAVIGATION_WEB_PORT` and `FAKE_BACKEND_PORT` set a port explicitly.
[Heavy-check admission](local-heavy-checks.md) limits concurrent checks; it grants no stand ownership.

## Start from a fresh clone

From the repository root:

```bash
docker compose up --build
```

This builds the development images, starts PostgreSQL, migrates and seeds it once, then starts API,
MCP and web. The seed keeps its demonstration Materials unpublished; run `pnpm local:stand` and
`pnpm local:product` for the product view. Rebuild the affected service after a source, package
manifest, workspace manifest or lockfile change. Image and configuration details live in
[Compose stack contents](local-compose-stack.md#images-configuration-and-storage).

## One stand: sign-in and purchase

One command brings up the whole stand: the application, its workers, sign-in, the bank double and
the mail interceptor.

```bash
pnpm local:stand
```

It builds the images, starts sign-in, configures it with the existing bootstrap and then brings up
the rest of the stand. It prints four addresses at the end:

- the application on <http://127.0.0.1:3000>;
- sign-in on <https://identity.inside.localhost:3301>;
- mail on <http://127.0.0.1:8025>, holding both the sign-in codes and the receipt address codes;
- the bank double on <http://127.0.0.1:8090>.

`pnpm local:stand --production-web` serves the production build of web for navigation-speed and
reading checks; see [Local stand runtime](local-stand-runtime.md#production-web-build).
Accounts, the owner's purchase order and the product view are in
[Local stand accounts](local-stand-accounts.md).

The stand claims the same machine-wide lock as `pnpm local:setup` and the shared Compose project, so
it refuses to start while a stack is already running. Start the stand only through
`pnpm local:stand`: a bare `docker compose --profile identity up` starts Logto without the
bootstrap that configures it, and sign-in then fails at the token exchange.

## Guarded Compose smoke

The smoke needs the published demonstration catalogue, so it runs in its own disposable project
`inside-platform-smoke` and never touches the stand's volumes. It uses the stand's ports: when
`docker compose ps` shows a running stand, apply the ownership rule above before it can start.

This verification needs host Python 3 and Bash, but no host Node.js or pnpm. The wrapper holds one
heavy-check slot through build, smoke and shutdown; the trap shuts the project down on failure too.

```bash
bash scripts/heavy-check.sh bash -euc '
  export COMPOSE_PROJECT_NAME=inside-platform-smoke LOCAL_SEED_VIEW=checks
  trap "docker compose down --volumes" EXIT
  docker compose up --detach --build --wait
  bash scripts/compose-stack-smoke.sh
'
```

[Compose stack contents](local-compose-stack.md) lists what the smoke proves.

## Stop and keep data

Stop the default stack without deleting data:

```bash
docker compose down
```

Stop the stand with the same Compose files it started with:

```bash
docker compose -f compose.yaml -f config/compose/local/learner-setup.compose.yaml \
  --profile identity --profile local-accounts down
```

Include `-f config/compose/local/production-web.compose.yaml` for a production-build stand.
After shutdown, `docker compose ps --all` lists no application containers.

Shutdown keeps volumes. While the stand is stopped, Docker lists its `inside-platform_*` volumes as
dangling, so `docker volume prune`, `docker system prune --volumes` or removing every dangling
volume erases the owner's product data. Remove only volumes whose `com.docker.compose.project`
label names a Compose project this session created.

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

If a required port is occupied, inspect its owner and wait for the owning worktree's handoff. Keep
machine-specific ports and credentials out of commits, and leave another session's process running.

## Destructive reset

Normal shutdown preserves data. Only the current singleton owner, with the owner's explicit
request, deletes the local database volume:

```bash
docker compose down --volumes
docker compose up --detach --build --wait
```

This does not affect disposable Testcontainers databases. Reserve `--volumes` for this reset: it
also deletes the owner's product view, which `pnpm local:product` then rebuilds from the committed
originals (purchases, accounts and progress are lost).
