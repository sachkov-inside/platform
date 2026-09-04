# Production delivery

Platform separates immutable release publication from production deployment. The release workflow
publishes a small manifest and two digest-addressed images. The runtime consumes only those exact
digests; it does not build from a server checkout and does not select a moving tag. Host transport,
deployment serialization and rollback automation belong to the later deployment ticket.

The [production VPS preparation kit](production-foundation.md) owns the long-lived PostgreSQL,
Logto, backup and system Caddy foundation. This runbook owns the application runtime layered on top
of that foundation. Running its local smoke does not contact or mutate production.

## Runtime topology

`compose.production.yaml` contains exactly seven application processes:

1. `migrations` applies the append-only Platform registry and converges the `pg-boss` schema.
2. `api` serves application HTTP and private operational health.
3. `mcp` serves Streamable HTTP MCP and private operational health.
4. `material-assets-worker` consumes Material Asset cleanup jobs.
5. `profile-avatars-worker` consumes Profile Avatar cleanup jobs.
6. `video-deletions-worker` consumes explicit Kinescope deletion jobs.
7. `web` serves the Next.js application and verifies API readiness.

All seven use the backend or web image digest selected from one `release-manifest.json`. The backend
image is multi-command: its command selects migrations, API, MCP or one worker. PostgreSQL and Caddy
are deliberately absent from application Compose because the foundation owns their lifecycle.

The stack connects three explicit networks:

- `edge` joins the loopback application listeners to the system Caddy;
- internal `application` carries web-to-API traffic;
- external `database` resolves to `FOUNDATION_DATABASE_NETWORK` from the foundation stack.

PostgreSQL is not published. API, MCP and web bind only to `127.0.0.1` on the host. Migrations and
every runtime process use the same non-superuser `platform` database credential. The application
runtime does not create another database role.

## Select and configure a release

Download the immutable release's `release-manifest.json`, then validate and inspect it:

```bash
pnpm runtime:plan --manifest /path/to/release-manifest.json > runtime-plan.json
```

The command accepts only the closed release-manifest schema and emits the version, source SHA and
two exact `name@sha256:...` references. Copy the emitted repository and 64-character digest parts
into `compose.env`, and the two release values into `runtime.env`; never derive them from `main`,
an ordinal image tag or a local checkout. Compose inserts the literal `@sha256:` separator, so a
moving tag cannot satisfy its image reference.

Create each ignored server-owned file from its tracked template before first use, replace every
placeholder, and keep it mode `0600`:

```bash
for template in config/compose/production/*.env.example; do
  install -m 600 "$template" "${template%.example}"
done
```

`compose.env` contains Compose interpolation only: exact backend/web images, project/network names
and loopback ports. `runtime.env` contains the selected release ordinal and source SHA. The other
files are delivered only to their named processes:

| File | Required configuration |
|---|---|
| `migrations.env` | shared `platform` database URL |
| `api.env` | database, Logto verifier, Telegram, Object Storage and Kinescope |
| `mcp.env` | database, MCP listener/public URL, Logto verifier, content access, storage and Kinescope |
| `material-assets-worker.env` | database and Object Storage |
| `profile-avatars-worker.env` | database and Object Storage |
| `video-deletions-worker.env` | database and Kinescope |
| `web.env` | internal API URL and Logto BFF |

Each process validates only the groups it owns. Missing owned values stop startup. Provider
reachability is not a global readiness dependency: an external outage degrades its affected flow
without taking unrelated reads or pages out of service.

The release ordinal and source SHA are also embedded in each image at build time as a read-only
`release-identity.json` beside that image's application entrypoint. Startup compares the runtime
values with that file and exits on any mismatch. The image identity is not read from overridable
container environment. Runtime secrets are never image build arguments.

## Validate and start

Pull the exact digests explicitly, then validate Compose without printing expanded secrets:

```bash
set -a
. config/compose/production/compose.env
set +a
backend_image="${PLATFORM_BACKEND_IMAGE_REPOSITORY}@sha256:${PLATFORM_BACKEND_IMAGE_DIGEST}"
web_image="${PLATFORM_WEB_IMAGE_REPOSITORY}@sha256:${PLATFORM_WEB_IMAGE_DIGEST}"
docker pull "$backend_image"
docker pull "$web_image"
docker compose \
  --env-file config/compose/production/compose.env \
  --file compose.production.yaml \
  config --quiet
```

Before changing a release, stop and drain all old workers. This is a required handoff boundary:

```bash
docker compose \
  --env-file config/compose/production/compose.env \
  --file compose.production.yaml \
  stop --timeout 20 \
  material-assets-worker profile-avatars-worker video-deletions-worker
```

Only after all three old containers have stopped may the candidate stack start:

```bash
docker compose \
  --env-file config/compose/production/compose.env \
  --file compose.production.yaml \
  up --detach --wait
```

Compose runs migrations before starting dependent processes. Worker shutdown removes readiness,
stops `pg-boss` gracefully and releases its process-specific PostgreSQL advisory lease. A concurrent
generation cannot acquire that lease and exits; it does not create overlapping consumers.

## Readiness and routing

API and MCP expose separate liveness and readiness endpoints on their private listeners. Web
exposes the same under `/_health`. Liveness proves the process and release identity. Readiness also
proves the exact ordered/checksummed Platform migration registry; web requires the same ready API
release. Worker Compose healthchecks validate an equivalent private tmpfs marker and re-query the
current database schema on every probe.

Useful loopback checks on the host are:

```bash
curl --fail --silent http://127.0.0.1:13001/health/live
curl --fail --silent http://127.0.0.1:13001/health/ready
curl --fail --silent http://127.0.0.1:13000/_health/ready
```

Every successful report includes the selected `release`, full `sourceSha` and expected schema
identity. A missing, edited, reordered or newer-than-runtime Platform migration makes readiness fail
closed. The migration job separately converges the library-owned `pg-boss` schema.

The system Caddy imports `infra/production/runtime/platform.caddy`. It publishes only:

- web at `inside.sachkov.dev`;
- `/integrations/telegram/v1/membership-evidence`;
- `/integrations/kinescope/v1/webhook`;
- `/integrations/kinescope/v1/authorize`;
- `/mcp` and `/.well-known/oauth-protected-resource/mcp`.

Unknown `/integrations/*` paths and `/health`, `/health/*`, `/_health/*` return 404 at the public
edge. PostgreSQL and direct service ports remain private. A wrong TLS hostname must fail certificate
validation.

## Migrations, failure and rollback

Schema evolution is forward-only: expand, deploy/backfill while N-1 remains compatible, then remove
old shape in a later release. The test matrix proves a fresh database, upgrade from the previous
schema prefix, a frozen N-1 application query contract against the candidate schema and resume when
execution stops after Platform migrations but before `pg-boss` finishes. Re-running migrations is
the repair path.

Never run an automatic down migration or database restore after a failed application deploy. If
migrations have completed, return to the previous application manifest only when its recorded N-1
compatibility evidence is green. Otherwise keep the database and repair forward. Provider failure
uses the affected feature's disable/recovery path, not a global application rollback.

## Local production proof

The isolated proof builds candidate images once with embedded synthetic identity, then supplies
their exact local image IDs to production Compose. It uses the real foundation PostgreSQL topology
and proves fresh/upgrade/N-1 migrations, `pg-boss` resume, seven-process readiness, no worker
overlap, completion of a controlled in-flight job during graceful drain, trusted TLS, the
positive/negative route matrix and wrong release/schema failure. A before/after database digest
proves that page, route and health smoke creates no application data or provider writes.

```bash
pnpm compose:production:smoke
```

The proof owns unique Compose projects, networks, ports, volumes and local images and removes them
on exit. It never uses production credentials or contacts the production host.

## Publish the next ordinal release

`.github/workflows/release.yml` remains the sole publication entry point. It captures exact current
`main`, reuses application CI, embeds the ordinal and source SHA in both images, publishes their
public GHCR digests, proves anonymous digest access, then creates the immutable GitHub Release with
only `release-manifest.json`:

```bash
gh workflow run release.yml --ref main --field version=vN
```

Publishing is not deployment and does not authorize production mutation. The complete local
publication proof remains:

```bash
pnpm release:dry-run
```
