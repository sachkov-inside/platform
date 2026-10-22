# Local stand runtime

Build, capacity and troubleshooting details of `pnpm local:stand`. Start, stop and ownership rules live in the [local stand runbook](local-stand.md).

## Production web build

Web on the stand runs in development mode by default. Development mode does not prefetch links and
compiles a route on its first open, so it says nothing about how fast page transitions are. To see
the real speed, start the stand with the production build of web:

```bash
pnpm local:stand --production-web
```

The `web` service is built from the `web-production` image target through
`config/compose/local/production-web.compose.yaml` and serves the same data, sign-in and workers.
It uses a separate `${COMPOSE_PROJECT_NAME:-inside-platform}-web-production:local` image and the
production server command; its build cannot replace the shared backend development image.
API and web use the same baked source/release identity so web's `/_health/ready` can verify equality.
API providers remain in development mode; its explicit local image-identity input follows the
[runtime configuration contract](runtime-configuration.md#docker-compose-flow).
There is no hot reload in this mode; after a code change, stop the stand and start it again with
the same flag. [ADR 0027](../adr/0027-web-navigation-and-caching.md) owns what is cached and why.

## Memory bounds

Local Web has provisional memory bounds ([#1332](https://github.com/sachkov-inside/platform/issues/1332)):
development allows 6 GiB of RAM and 8 GiB of RAM plus swap; production Web allows 1 GiB of RAM
and 1 GiB of RAM plus swap, so it cannot use swap. `memswap_limit` is the combined total, not
additional swap. These are container safety caps, not measured FULL-course budgets; actual
production peaks and available VM headroom must confirm or correct them before runtime acceptance.
The local production overlay inherits `restart: unless-stopped` from Web's base service.
Docker restarts unexpected exits after successful startup; an explicit stop remains stopped.
An unhealthy probe alone does not restart the container. These local settings do not change
the release Web's existing 512 MiB deployment cap or other local services.

Before applying these settings to an existing shared stand, its owner must announce the restart.
Record the current Web `memory.current` and guest `MemAvailable`, then choose the runtime limits
for the planned workload. Measure production Web's peak and VM headroom through startup and
FULL-course review; require preserved identities/data, no OOM and no unexpected restart.
The normal 20 GiB disk admission still applies. A runtime Web cap does not bound BuildKit memory
or prove that the VM has enough memory for a build. See Docker's
[memory contract](https://docs.docker.com/engine/containers/resource_constraints/) and
[restart policy](https://docs.docker.com/engine/containers/start-containers-automatically/).

## Object storage origin

The local production-web launcher reads the resolved API signed storage endpoint from
the common learner Compose configuration, including Compose's `.env`/shell interpolation.
It derives that URL's canonical origin and passes it through
`STAND_WEB_OBJECT_STORAGE_ORIGIN` as the existing validated `CSP_LOCAL_OBJECT_STORAGE_ORIGIN`.
For port80 the canonical origin is `http://127.0.0.1`; other ports remain explicit.
Next captures the headers during the build;
setting it only on the running container cannot repair a previously built CSP. The common learner
overlay uses that same published port for API and MCP signed image URLs in both stand modes.
Builds for a production release omit the local origin and keep the existing production `img-src`.
The loopback validation and script policy remain in `next.config.ts` / [ADR 0028](../adr/0028-web-edge-hardening.md).

## Build and disk capacity

`local:stand` builds API's shared workspace image, RabbitMQ and Logto sequentially before starting
containers with `--no-build`. It builds a separate Web image only with `--production-web`.
Each invocation asks BuildKit to verify the current source
inputs, so cached images never bypass source validation. Production web requires a clean Git
working tree and uses its real `HEAD` SHA as the release identity; commit source edits first.
Backend and web restore installed patches from the dependency stage after source COPY. Recopying
them from source after a cached install changes their timestamps and makes pnpm attempt an unnecessary install.
If startup fails, the launcher prints up to 80 lines from each migration/seed job before shutdown
removes its containers; reading these diagnostics has a 20-second deadline.

Before building, the command measures available space on Docker's host storage filesystem. On macOS,
it locates the open Docker Desktop `Docker.raw` through `lsof` file metadata; on Linux Engine it uses
the daemon's `DockerRootDir`. It refuses an unidentified data disk. It requires 20 GiB: an 8 GiB
build ceiling, the mandatory 10 GiB host floor and 2 GiB of stop/cleanup headroom. During launch it checks both limits every 250 ms and starts
stopping its command tree 256 MiB before either limit: growth at 7.75 GiB or remaining free at 10.25 GiB. This monitors host disk consumption; it does not
increase Docker's own storage quota. A refusal leaves existing stand data intact. Arrange disk
capacity before retrying; the command never prunes caches, reports or volumes.

The 9 October cached-stand estimate rounded up 3 GiB for source/web/export growth plus two dependency
snapshots of at most 2.261 GB each to a provisional 8 GiB ceiling. On 10 October, the c0 image-only
attempt stopped at the cumulative global margin while building Web dependencies; that estimate did
not prove the whole matrix fits. Backend and Web now declare identical toolchain/dependency inputs.
Web disables Next telemetry in its development stage, inherited by Web, Storybook and production-build,
so this Web setting does not separate the dependency cache. Native reuse still needs verification;
a matching source graph is not measured capacity. Production Web keeps its separate image and build,
while development Web reuses API's workspace. The historical estimate uses retained layer/cache
measurements, not the sum of overlapping cache records. [The source data and calculation](../evidence/issue-1304/README.md)
were captured on 9 October 2026 UTC / 10 October 2026 MSK. Runtime verification must measure actual peak growth and the
remaining floor; cold caches or changed dependency inputs may exceed that estimate and stop safely.
[The refreshed inputs after main391 and the linked CSP fix](../evidence/issue-1304/resume-1318/README.md)
keep the same provisional ceiling. Those metadata sizes are not measured future build growth.
Root diagnostic `*.log` files are ignored by Git as well as the Docker context, so they do not
prevent production web's source check.

For a bounded real context check, run `bash scripts/heavy-check.sh bash scripts/local-build-context-smoke.sh`.
It builds a tiny `FROM scratch` fixture without fetching images and removes its own temporary
files. Each scratch build has a 60-second execution budget; the repository Python supervisor force-stops its command
tree on deadline and returns124. Ordinary Docker failures retain their original status. It verifies that source/evidence survive `COPY` while reports and synthetic identity are excluded.
It also exercises both development Dockerfiles' real `COPY` instructions and verifies that they
preserve patch files from the dependency stage.
The separate native cache discriminator is `python3 scripts/local-dependency-cache-smoke.py <baseline-web-Dockerfile>`
under the same guarded slot. Supply preserved pre-fix Web Dockerfile bytes. It requires the pinned Node
base already present in the `desktop-linux` Engine. Its bounded preflight requires the local Unix-socket
context and its single Engine-backed `docker` builder; every build explicitly selects that builder.
Missing base or a different builder fails before build. Each metadata command has a five-second budget
and uses the same owned-tree cleanup as the 60-second marker builds. Synthetic bytes retain the real
dependency COPY paths without running pnpm. `--network=none` isolates RUN; `--pull=false` is not a
universal registry ban. Any required base acquisition is a separate, explicitly bounded prerequisite
using the same pinned Node digest, never a fixture fallback. It checks a cold backend marker, duplicate pre-fix Web execution and fixed Web cache
reuse. This isolates the environment/cache seam; it does not measure a whole application build.

## Sign-in callbacks and ports

For `Inside Web`, bootstrap always registers the configured web callback and logout return
(defaults: `http://127.0.0.1:3000/callback` and `http://127.0.0.1:3000/`). It also retains
already registered owner preview returns at `http://127.0.0.1:4300/callback` and
`http://127.0.0.1:4300/`, including their `localhost` equivalents, on repeated runs.
It does not register these preview returns for a new application or retain other extra origins,
paths or wildcards. The authoring stand application keeps its separate bootstrap policy.

Sign-in ports are fixed at 3301 and 3302 on purpose. OIDC compares the issuer as an exact string,
so the address must be the same for the browser and for the application inside the Compose network.

## What to expect

Nothing leaves the machine: the interceptor only receives mail and has no sending node configured.
The bank double moves no money and remembers its orders across restarts.

A purchase also produces a notification: `notifications-worker` expands the audience, stages the
command and sends the letter to the same inbox, because the stand configures
`NOTIFICATIONS_PLATFORM_ORIGIN` and `NOTIFICATIONS_TELEGRAM_SECRET` next to `BILLING_CONTACT_*`.
The reader link points at the stand itself on <http://127.0.0.1:3000>.

The stand must not run on previously built images. When migrations or MCP fail with
`Migration ledger is not an exact registry prefix`, the image holds one migration fewer than the
database already applied. Rebuild the stand and **do not wipe the data volume** — it looks like a
corrupted database and is cured by a rebuild.

Wiping `logto-postgres-data` resets the sign-in tenant, and the application keeps the application
id of the tenant that is gone. Run `pnpm local:stand` again: it drops the generated values before
the bootstrap recreates the tenant, so the stand always holds the tenant it just configured.

The generated `.identity-proof/stand.env` outlives `docker compose --profile identity down`, and
`api` and `web` keep reading it. The default stack still starts and still points at the same
sign-in address, because that address is also its built-in local default and nothing answers there
without the stand either way. What the file does carry beyond the defaults are the stand's own
application id, secrets and email fingerprint key, so an Account created on the stand is not the
same Account for a stack running on the fallback values. Start the stand again to get its own back.

## Disposable production smoke from owned cache

The optional `PRODUCTION_SMOKE_CACHE_ONLY=1` mode of
`scripts/production-compose-smoke.sh` reuses supplied production images. The default CI mode
still builds images and performs its existing pinned broker/edge acquisition. Cache-only mode
does not build or pull, and it retains every migration, worker, TLS, negative and readiness
assertion. It is a runtime proof of the supplied images, not a cold-acquisition fix or a full
application-build/cache proof.

Before using this mode, obtain the shared heavy slot and freeze a clean, reviewed Source.
Build the real backend v1/v2 and Web v1 with that exact Source SHA in their release identities.
Use `v1` and `v2`: the smoke verifies both releases. Build a separate foundation image from
`infra/production/database/Dockerfile`. Record native platform, image IDs, build inputs, actual
BuildKit completion and storage/cleanup receipts. A marker fixture or an old image tag is not
that evidence. This mode grants no build, daemon startup, provider access or credential change.

Choose a unique `PRODUCTION_SMOKE_CACHE_OWNER` beginning with
`inside-platform-production-smoke-cache-`. The four existing owned tags must resolve to four
distinct full `sha256:<64 lowercase hex digits>` image IDs:

| Supplied environment variable | Required owned tag |
| --- | --- |
| `PRODUCTION_SMOKE_BACKEND_IMAGE` | `<owner>-backend:v1` |
| `PRODUCTION_SMOKE_NEXT_BACKEND_IMAGE` | `<owner>-backend:v2` |
| `PRODUCTION_SMOKE_WEB_IMAGE` | `<owner>-web:v1` |
| `PRODUCTION_SMOKE_FOUNDATION_IMAGE` | `<owner>-foundation:local` |

Set `PRODUCTION_SMOKE_SOURCE_SHA` to the exact 40-character lowercase Source SHA.
Set `PRODUCTION_SMOKE_FOUNDATION_OVERRIDE` to a file containing exactly these entries, with
each `<foundation-ID>` replaced by the supplied immutable foundation image ID:

```yaml
services:
  postgres:
    image: <foundation-ID>
    pull_policy: never
  pgbackrest:
    image: <foundation-ID>
    pull_policy: never
  restore:
    image: <foundation-ID>
    pull_policy: never
```

The smoke copies and validates the override before using it. Extra volume, network,
environment or build authority is rejected. It also checks that both pinned broker/edge
references from the current Compose graph exist locally before any container starts.
Missing or mismatched inputs fail without build, pull, startup or anonymous fallback.

After admission, run the script under the checked-in shared heavy and owned-process wrappers,
with an enclosing deadline and filesystem monitor. Supply free
`PRODUCTION_SMOKE_API_PORT`, `PRODUCTION_SMOKE_MCP_PORT`, `PRODUCTION_SMOKE_WEB_PORT`,
`PRODUCTION_SMOKE_HTTP_PORT` and `PRODUCTION_SMOKE_HTTPS_PORT`; defaults may already belong
to another stand. `PRODUCTION_SMOKE_ARTIFACT_DIR` holds failure diagnostics.
The script creates separate application/foundation projects and temporary synthetic configuration.
It starts Compose with `--no-build --pull never` and direct image probes with `--pull=never`.
It never writes or removes existing shared foundation image tags in this mode.
The singleton `local:stand`, owner pages, identities and volumes are not used.

Shutdown removes only the smoke's containers, networks, volumes and temporary configuration.
Supplied images remain owned by the caller, who checks consumers before removing its own tags.
Record primary exit and cleanup exit separately, plus actual owned PID/kernel absence and Docker
resource inventory. A successful CLI exit or an EXIT trap alone does not prove complete closure.
If admission, deadline, storage or cleanup fails, retain the failure and request a new scope;
do not retry, enlarge budgets or prune shared cache to obtain green.
