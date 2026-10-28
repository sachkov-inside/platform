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
- **Stand**: the shared `inside-platform` project prepared through `pnpm stand show` or started through `pnpm local:stand`, with
  sign-in, the bank double and mail capture. Its volumes hold the owner's product data, accounts,
  purchases and progress.

## Parallel worktrees and singleton ownership

The fixed `inside-platform` Compose project, host ports and volumes are shared by all worktrees on
one machine. The controller serializes mutations and keeps a durable review reservation separately
from the calling session. Its commands are listed by `pnpm stand --help`.

For an application review, use [the project skill](../../.agents/skills/local-stand/SKILL.md).
One checkout supplies the controller code; use `--worktree <absolute-path>` to select task source
from another worktree. `status` names the registered controller checkout. Keep that checkout and
its installed dependencies available while the state exists.

```bash
pnpm stand status
pnpm stand show
pnpm stand show --live
pnpm stand refresh
pnpm stand release
```

`show` prepares and reserves a snapshot of the selected source. `--live` instead mounts that
worktree's Web app/src/public directories into Next's development server. Web edits in these
directories need no image build; changes elsewhere require `refresh`. `refresh` retains the mode;
`show` without a mode freezes the current code for later review. Database contents remain mutable.
`release` frees the reservation while leaving the application running. Reservations have no timer
and survive session completion. Ordinary editing, Storybook and isolated tests do not reserve it.

An explicit owner request to show a different task permits `show --replace <reservation-id>`.
Read the current ID from status. A changed ID refuses replacement. Other worktrees otherwise
preserve a foreign reservation, including when its containers are stopped.

Controller state and generated Compose overlays live in `inside-platform-stand/` under the shared
Git common directory. State stores source fingerprints, modes, reservation and container receipts,
not secret values. The same machine-wide lock protects controller and legacy launch operations.
Snapshots are reconciled with actual container IDs, immutable images and live HTTP readiness.
Failed preparation keeps the reservation and reports recovery; retry `refresh` after edits settle.
An unavailable application can be repaired by refreshing the same source and mode; restore readiness
before switching to other code. Interrupted initial bootstrap resumes the cold-start procedure,
retaining its generated identity checkpoint. Bootstrap emits only a public digest immediately
after writing the private stand environment; the controller accepts it only while it matches the
current file, even when later bootstrap requests fail.
Preserve the state for diagnosis instead of deleting it to bypass a refusal.

The first cold start requires the controller checkout's schema and infrastructure baseline and
uses the existing stand bootstrap below. Switching an existing managed stand
rebuilds the shared application image and recreates its application roles, including the local
account gateway, without rerunning migrations, seed or identity bootstrap. Infrastructure stays up.
The source migration files, migration engine, backend manifest, dependency lockfile, infrastructure
configuration and identity settings must match the recorded stand. `show` and `refresh` refuse a
different schema or infrastructure; the owner-requested [upgrade](#upgrade-to-newer-schema-or-infrastructure)
moves the stand forward. The controller does not migrate backwards, infer compatibility or erase
volumes. A dependency lockfile change counts as a schema change because database dependencies can
change their own schema. Image builds retain the existing disk budget. Development mode and production-Web mode
retain their existing runtime limits.

### Upgrade to newer schema or infrastructure

```bash
pnpm stand upgrade --worktree <path>
```

Use it when the owner asks for the running stand on newer code whose migrations or infrastructure
differ, for example current `main`. It keeps accounts, purchases and progress. It requires a ready
managed stand, the reservation rules of `show` (`--replace` included) and unchanged identity
settings; identity changes and unmanaged stacks keep the handoff procedure below.

1. It records the incomplete upgrade, then dumps both database clusters (`pg_dumpall`, gzip) to
   `inside-platform-stand/backups/<generation>/` under the shared Git common directory, mode `0600`.
2. It builds the selected source's images and runs the `migrations` job once. The migration engine
   refuses a database ledger that is not a prefix of the source's registry, so only forward
   migrations apply. Seed and the identity bootstrap do not run.
3. Compose replaces only infrastructure services whose configuration or image changed (volumes stay
   attached), then recreates every application role, and the controller records the new receipt.

Until it finishes, `status` reports `recovery` and `show`/`refresh` refuse. Rerun the same
`upgrade` after a failure: a completed backup is reused, and Compose and migrations repeat safely.
Restoring a backup replaces newer stand data, so it needs a separate owner request: stop the
application roles, then pipe the dump through `gunzip` into `psql -U <user> -d postgres` in the
matching database container, and refresh the source that matches the restored schema.

An existing stack without a controller receipt is **unmanaged**. The controller reports it and
refuses takeover. The owning session first hands it off and stops it without deleting volumes;
then the first `show` can prepare the controlled stand. The same rule applies when another tool
has replaced its containers. Direct Docker commands and old launchers can bypass these cooperative
rules; use the registered controller for shared stand changes.

The updated legacy `local:stand` entrypoint refuses startup once controller state exists, even
when its containers are stopped. This avoids replacing a reserved review through the old command.

For manual Compose operations and legacy/unmanaged stacks, retain the ownership procedure below.

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
it refuses to start while a stack is already running. Start the stand through the controller or
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
