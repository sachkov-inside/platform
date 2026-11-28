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

An agent that only needs its own web and API for a browser check uses a
[light instance](#light-instance-per-agent) instead; several of them run side by side.

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
`release` frees the reservation while leaving the application running. `release --if-owned` frees
this worktree's reservation and leaves another worktree's one, checking ownership again under the
lock; like every mutation, it also releases a reservation whose worktree is deleted. It exits 0
when another worktree holds the stand. From a task worktree it asks the registered controller to
release.
`pnpm stand:finish`, the `finish` step of `.worktree-resources.json` run by `agent-worktree
finish`, stops this worktree's light instance and runs `release --if-owned`. It reports a failed
or a five-minute step as a warning and exits 0; a reservation it leaves is released by the next
stand operation after the worktree is removed. Reservations have no timer
and survive session completion. A reservation whose worktree directory no longer exists is released
by the next `show`, `refresh`, `release` or `upgrade` from any worktree, which reports it; `status`
only reads and marks such a reservation. `status` shows the reserved worktree and how long ago it
was reserved, from `reservation-times.json` beside the state; reservations taken before this file
existed show an unknown age. Ordinary editing and isolated tests do not reserve it.

A mutation that finds another stand operation running waits in a first-come queue instead of
failing, and prints its position and the running operation to stderr. `status` lists the queue.
A waiter whose process ends leaves the queue. The name of its ticket records when its process
started, so a killed waiter also leaves after the system gives its process ID to another process.
The process ID alone decides in three cases: a ticket without that time (the earlier format, or
`ps` could not tell), a process whose start time cannot be read, and a process that started within
2 seconds of the recorded time. Its first place also waits while another tool holds the
machine-wide lock (`pnpm local:setup`, identity proofs, `pnpm stand:images --apply`). Run a waiting
command in the background: an agent's tool timeout that kills it gives up its place.

`show`, `refresh` and `upgrade` build the source's application image (`api`, and `web` for
`--production-web`) before joining the queue, under the separate Compose project
`inside-platform-prebuild`, with the stand's disk budget. The build tags are removed afterwards; the
layers stay in the build cache. The build under the lock then reuses the cache, so the stand is held
while it is changed, not while the source compiles. On 2026-11-16 the build under the lock took
25 s after the early build, against 111 s without it; image export and unpacking took 18.6 s of the
25 s. An `upgrade` and a first cold start still build `rabbitmq` and `logto` under the lock. A foreign reservation or a
different schema, infrastructure or identity refuses the command before the early build. When the
ready stand already runs this source in this mode, the command skips the early build.

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
3. Compose replaces infrastructure services whose configuration or image changed, with volumes
   attached; a source in another worktree changes bind paths, so Logto is then recreated too. It
   recreates every application role, and the controller records the new receipt.

The dumps cover PostgreSQL only; object storage, broker and mail volumes stay in place untouched.
New seed data and sign-in bootstrap changes from the newer source are not applied. A new
infrastructure service in Compose needs an entry in `scripts/stand-services.mjs` before an upgrade
starts it. Commit the source before an upgrade with `--production-web`.

Until it finishes, `status` reports `recovery` and `show`/`refresh` refuse. Rerun the same
`upgrade` after a failure: a completed backup is reused, and Compose and migrations repeat safely.
The dumps are plain SQL from `pg_dumpall --clean --if-exists` and contain account data and
sign-in secrets: keep them in place and delete superseded ones once the owner no longer needs them.
A dump that is still being written, or that failed, ends in `.partial`; it is not a backup. Restoring one is a manual recovery outside the
controller that replaces newer stand data, so it needs a separate owner request. Stop every service
except the two database clusters (Logto included), replay each dump with
`gunzip -c <file> | docker exec -i <container> psql -U <user> -d postgres` in its own cluster
(errors about the connected role are expected), and hand off the controller state: its recorded
schema no longer matches the restored database.

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

## Light instance per agent

A light instance runs one worktree's web and API on the host, against the shared stand's PostgreSQL
and object storage, with its own database, free loopback ports and the synthetic sign-in of the
full-stack checks. It needs no shared stand reservation. The Mac verification command holds [heavy-check admission](local-heavy-checks.md) for the session.

```bash
pnpm verify:light -- bash    # run commands in the admitted shell, then exit it
pnpm stand:light status
pnpm stand:light down       # recover an interrupted instance record
```

The [verify-platform skill](../../.agents/skills/verify-platform/SKILL.md) drives an instance as a
user and records evidence; its helper `node scripts/verify-platform.mjs doctor` tells whether a
running instance is worth driving.

`up` prints the web, API and sign-in addresses. Open
`<sign-in>?as=owner&next=/path` (owner «Владелец Тестов» with `platform:admin`), `?as=holder`
(«Покупатель Тестов», holds the synthetic learning course), `?as=learner` («Участник Тестов», no
paid products; has a linked synthetic Telegram identity, a pending test purchase of the learning
course, and an active waiting-list membership) or `?as=newcomer` (no name, terms not accepted) in the
browser; `/sign-out` on the same server removes the session. Use a separate browser context per
instance: cookies of `127.0.0.1` ignore the port, and each instance names its own cookie.

The fresh isolated instance uses only the common scenario adapters after migrations and trusted
owner bootstrap. It does not call the legacy `db:seed` or depend on a pre-existing Product ID.
Its library has the shared 120-Material open-feed variant, outside Products, with Video and Guide
formats. ADR0043 permits only free Materials outside Products in the feed. The separate learning
Product retains its chapters, free and paid lessons, supplementary reference with an inline file,
holder progress and bookmark, dictionary, Task Versions, submissions and AuthorFeedback.

The legacy development CLI remains a separate workflow. Its missing overview asset uploads from
#2267 are not repaired by this startup. The isolated repair adapter remains covered by independent
backend regression tests, but the common light instance no longer imports that legacy catalogue.

The instance also owns loopback bank and Telegram protocol providers. The learner’s purchase is
pending, so it grants no ProductAccess. The learner explicitly joins the accepting synthetic
Product Intake through the normal Account API; the local composition creates that Intake through
the Sales Funnel interface. The same learning Product supplies its name and price in the payment.
The owner can inspect the learner under People and the pending purchase under Sales → Payments.
The Telegram profile is fictional and marketing remains stopped. The provider only accepts the
proof from a registered synthetic link. No real bank, Telegram bot or external message is called.
The supervisor discards inherited `TBANK_*` and `TELEGRAM_*` configuration before assigning its
own providers, and stops both with its API and Web processes. This fixture does not run payment
confirmation, fulfillment workers, community membership or message delivery.

| Need | Use |
|---|---|
| An agent checks its own change in a browser, several agents at once | Light instance |
| Real Logto sign-in, mail codes, payment confirmation and fulfillment, workers, RabbitMQ, the owner's data | Full stand (`pnpm stand show`) |
| An owner review that stays open after the session | Full stand |
| Navigation speed of the production build | Full stand with `--production-web` |

How it works:

1. `up` reads the published PostgreSQL and object storage ports of the Compose project
   `inside-platform` (`--infrastructure <project>` selects another one) and refuses when they are
   not running. It never starts or changes containers.
2. A detached supervisor creates `inside_light_<id>`, where `<id>` derives from the worktree path,
   then migrates it and bootstraps the owner through its real Account interface. Once
   the API answers it establishes the role Accounts through the API: the named roles
   accept the current terms and get their fictional names. The isolated API publishes the shared
   open-feed scenario and imports the synthetic learning scenario through
   real authoring interfaces: chapters, free and paid lessons, an extra material and a downloadable
   file, holder progress and bookmark, a dictionary term, two Task Versions and their submissions,
   and AuthorFeedback for the current version. It then links the learner through its owned
   Telegram protocol provider, creates one accepting Product Intake through trusted local
   composition, explicitly joins it as that learner, and creates a pending purchase through real
   pricing, quote, legal-consent and purchase interfaces against the loopback bank. This setup runs
   only against the instance database and never calls real payment or message providers. Every
   `up` starts from a fresh database.
3. It starts the backend's `dev:api` from this worktree and builds and starts Web in production
   mode (`next build`, `next start`), with environment from `.env.example`, the caller's
   environment, and the instance's own database, ports and sign-in. API reloads on source edits;
   Web edits need `down` and `up`. `--dev` runs `next dev` instead, which reloads Web edits and
   needs more memory. Ports come from the reserved range 20000–29999.
4. `down` stops the supervisor, which stops its processes and drops its database. After a crash,
   `down` drops the leftover database, record and release identity file, and warns when
   `apps/web/AGENTS.md` differs from the commit. Nothing else is touched. For a deleted worktree,
   run `pnpm stand:light down --worktree <its former path>` from another checkout; `status` lists
   that path.

The record and log live in `inside-platform-stand/light/` under the shared Git common directory.
One instance runs per worktree. Do not run `pnpm smoke:fullstack` in a worktree with a running
instance: both use `apps/web/.next`. In the default mode the smoke refuses on the instance's
`apps/web/release-identity.json`; with `--dev` nothing stops it. Uploaded files go to the stand's local buckets. Payments, mail,
notifications and background workers do not run. The production build writes
`apps/web/release-identity.json` for the life of the instance. `next dev` and `next build` rewrite
the Next.js block of `apps/web/AGENTS.md`; the instance restores the committed text once web is
ready and again at shutdown. A full stand `upgrade` may recreate its PostgreSQL and break running
instances' connections; restart them with `down` and `up`.

### Memory budget

Measured on 2026-11-16 on a Mac with 24 GiB, of which the OrbStack VM takes 12 GiB:

- The full stand uses about 2.4 GiB inside the VM in production-web mode.
- A light instance runs on the Mac itself, outside the VM. Times include migration and seed.

| Web mode | Ready after `up` | Resident memory while running | Peak during `up` |
|---|---|---|---|
| Production build (default) | 10–20 s; 20 s with a cold build cache | 0.4–1.0 GiB | 2.9 GiB while `next build` runs |
| `next dev` (`--dev`) | 7–9 s; the first page then compiles for 2–5 s | 0.5–2.3 GiB; `next dev` alone up to 1.8 GiB | as while running |

Use one admitted Mac verification at a time. `pnpm stand:light status` shows the resident
memory of each instance's process tree.

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
  -f config/compose/local/stand-kinescope.compose.yaml \
  --profile identity --profile local-accounts down
```

Include `-f config/compose/local/production-web.compose.yaml` for a production-build stand.
After shutdown, `docker compose ps --all` lists no application containers.

Shutdown keeps volumes. While the stand is stopped, Docker lists its `inside-platform_*` volumes as
dangling, so `docker volume prune`, `docker system prune --volumes` or removing every dangling
volume erases the owner's product data. Remove only volumes whose `com.docker.compose.project`
label names a Compose project this session created.

## Images and build cache

Rebuilds leave the stand's previous images behind, and BuildKit keeps build cache. Both are bounded
without touching volumes (#1779):

- **Build cache.** The OrbStack engine's builder GC (`~/.orbstack/config/docker.json`, set
  2026-10-18) targets 4 GiB of unused cache with 1 GiB reserved, and frees space when less
  than 10 GiB of disk remains. The rule covers the whole engine, so it also trims other projects'
  cache on this engine; 4 GiB sits below the 5–8 GB budget of the storage policy and is kept as is. `docker buildx inspect orbstack` shows the active rule; the engine
  applies it after builds; total cache, including shared/in-use records, can exceed that target.
  No manual prune is needed. A change to that file needs an engine
  restart, which stops the stand: plan it as a stand outage with the owner.
- **Stale images.** `pnpm stand:images` lists the images labelled with the stand's Compose project
  (`com.docker.compose.project=inside-platform`), with a verdict and reason for each. A plain
  `docker compose` run in any worktree uses the same default project name, so its images carry the
  label too and get the same protection rules. It keeps
  every image a container uses (running or stopped, by the daemon's own count), the newest unused image of each service as the
  previous build for a rollback, and anything younger than seven days. `pnpm stand:images --apply`
  removes only the remaining ones, without force, while holding the local setup lock that stand
  operations use, and recalculates eligibility right before each removal. Removal uses the immutable
  image ID with `--no-prune`, without force; Docker refuses conflicting repository references.
  It never touches volumes, the build cache or other projects' images.

### Maintenance ownership and installation

`scripts/stand-images.mjs` is the project-owned maintenance entrypoint. Interactive runs use the
selected Docker context unless `--context <name>` pins every Docker call. Scheduled runs must also
pass `--daemon-id <ID>` recorded from `docker --context <name> info --format '{{.ID}}'` at installation.
An unavailable or unexpected daemon refuses cleanup; identity is checked again before deletion.

By default, the command reads the existing legacy recovery manifest at
`~/.local/state/platform-orbstack/1527/optimization/protected-images.json`. Its absence is allowed
on machines without that legacy setup; malformed or unreadable existing files refuse the run.
Pass `--protected-images <absolute-json-path>` to require a specific JSON array of immutable image
IDs. A missing or malformed explicitly requested file refuses the whole run. Scheduled installation
always passes that explicit path. Preserve the legacy manifest and its backups; age and
lack of containers do not release those references. Images with the
`dev.inside.resource-preparation` label are always retained, even when they inherit stand labels.
Their named next consumers, recovery and retirement belong to the existing #1566 preparation
lifecycle, not this maintenance command. Do not widen the project filter to clean them.

The local LaunchAgent `com.inside.platform.orbstack-maintenance` runs daily. Install only a reviewed,
checked source version as a self-contained Node.js ESM bundle under
`~/.local/share/inside-platform/stand-maintenance/<source-sha>/`, with bundled npm dependencies.
Record its source SHA, bundle SHA256, dependency versions, stable Node executable, Docker context,
daemon ID and protection-manifest path in an installation receipt beside it. Keep that Node version
available. Neither a disposable worktree, the controller checkout nor mutable primary-checkout code
is a scheduled runtime dependency. A new version requires another verified installation; merge alone
does not update the installed bundle.

Keep the launcher and last-run log in `~/.local/state/platform-orbstack/stand-maintenance/`. The
launcher replaces the single `last-run.log` on each run, preserving the command's exit status;
LaunchAgent output goes to `/dev/null` instead of growing append-only logs. Before replacing the
job, verify it is idle and preserve its plist. Validate the bundle's dry-run against the source,
then repoint only this LaunchAgent. Run one controlled apply with before/after container, volume,
readiness and disk evidence. No engine restart, stand reservation or service interruption is needed.
Docker commands run asynchronously so the existing stand lock continues renewing during slow calls.
If the stand lock is busy, preserve the runtime and retry later. GC remains engine-owned; the
maintenance job never prunes cache or volumes and does not build images to trigger GC.

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
