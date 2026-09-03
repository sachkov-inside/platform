# Production delivery

The repository contains two delivery seams: an immutable release pipeline that publishes verified
artifacts, and a deliberately small single-server Compose baseline that still builds those
artifacts from a checkout. Deployment automation will connect the seams later; creating a release
does not contact the production server.

## What runs

`compose.production.yaml` starts seven services in order:

1. PostgreSQL becomes healthy.
2. `migrations` builds the backend production target and applies the schema once.
3. `api` builds the same backend production target and becomes healthy.
4. `profile-avatars-worker` builds the backend target and starts bounded orphan cleanup.
5. `video-deletions-worker` builds the backend target and processes explicit, reference-safe
   Kinescope deletion requests.
6. `web` builds the Next.js production target and becomes healthy.
7. Caddy exposes web over HTTP and HTTPS.

The application images are built directly from the checked-out source with Compose. The release
pipeline publishes digest-addressable images, but this temporary runtime baseline does not consume
them yet. There is no GitHub Actions deployment workflow, SSH deployment, server-side release
selector or automated rollback. Compose also uses its default network and one database account.
These missing pieces are intentional: the lessons add them one at a time and explain the problem
each one solves.

The Material Asset worker remains part of the application and local development stack, but it is
not started by this temporary production baseline. Orphaned Material Asset cleanup therefore does
not run here until the worker is added back during production hardening.

Profile Avatar cleanup is part of the feature's safe storage lifecycle, so its dedicated worker is
present even in this small baseline. Configure its retention window with
`PROFILE_AVATAR_ORPHAN_GRACE_SECONDS`.

Explicit owned Video deletion is also part of the safe provider lifecycle, so its dedicated worker
ships with the Kinescope deletion capability. See the [Video deletion runbook](video-deletion.md).

## Runtime configuration

Create the ignored server-owned env files from the tracked templates and replace every placeholder.
Each service receives only its own runtime configuration and secrets.
The API and Video deletion worker files own the Kinescope values needed by their processes; the
browser and web container do not receive them. Production startup rejects the test adapter and
equal public/member project IDs.

```bash
for template in config/compose/production/*.env.example; do
  install -m 600 "$template" "${template%.example}"
done
```

`compose.env` controls Compose itself: project name and published ports. The other files are passed
to their named containers through `env_file`. Validate the result without printing the expanded
configuration:

```bash
docker compose \
  --env-file config/compose/production/compose.env \
  --file compose.production.yaml \
  config --quiet
```

Start the stack and build the application images from the current checkout:

```bash
docker compose \
  --env-file config/compose/production/compose.env \
  --file compose.production.yaml \
  up --detach --build --wait
```

This manual command is intentionally not the final deployment method. A later CI/CD stage will
make the server run an already-published manifest's exact image digests without rebuilding source.

## Publish the next ordinal release

`.github/workflows/release.yml` is the sole release entry point. One manual dispatch captures the
selected commit, requires it still to be current `main`, runs the same CI contract used by pull
requests, builds the backend and web production targets, and publishes only the requested `vN`
tags. Release consumers must use the manifest's `name@sha256:...` identities; the ordinal tags are
human-readable release names, not moving runtime selectors.

Before the first release, an owner must enable immutable releases in the repository settings and
bootstrap the `platform-backend` and `platform-web` container packages as public. GitHub creates a
new container package as private, while package visibility is an owner-managed setting. The
workflow deliberately does not accept a package-visibility credential: after pushing, it logs out
of GHCR and requires both exact digests to be anonymously readable before it can finalize a
release. The owner-approved bootstrap publication and visibility change are one-time setup; after
that setup, each ordinal release uses the single command below.

The workflow checks release immutability both before building and immediately before finalization.
It also requires each ordinal tag to belong to a published immutable Release containing its
manifest. Those retained Releases must form a contiguous `v1` through `vN-1` history; a bare tag,
mutable/missing record, duplicate or skipped ordinal fails closed. The workflow rechecks the same
state and confirms that `main` has not moved before publishing.

From a clean `main`, publish the next ordinal with exactly one manual command:

```bash
gh workflow run release.yml --ref main --field version=vN
```

The completed immutable GitHub Release contains only `release-manifest.json`. The manifest binds the
ordinal version and source SHA to two deployable public GHCR `name@sha256:...` references. The source
SHA already identifies the checked-in migrations and configuration, so the manifest does not
duplicate their hashes. The image build job logs out of GHCR and proves both exact digests
anonymously readable before finalization.

The small manifest contract is owned by `release/contract-schema.mjs`, while ordinal and manifest
validation live in `scripts/release-contract.mjs`. To exercise the complete local release contract
without publishing packages or a GitHub Release, run:

```bash
pnpm release:dry-run
```

The image smoke builds both clean production targets and asserts that their runtime files do not
depend on the source checkout. It uses temporary local image names and removes them on exit.

## Local production smoke

The isolated smoke uses synthetic runtime values, builds the current production targets, applies
all migrations, verifies the Profile Avatar and Video deletion worker readiness logs and API
health, and checks the home and Library pages through Caddy. It removes its containers, volumes and
Compose-built images after the run.

```bash
pnpm compose:production:smoke
```

## Hardening that comes later

The next delivery stages will extend this baseline with:

- separate database migration and runtime roles;
- explicit network boundaries;
- the Material Asset background worker;
- server-side secret delivery;
- manifest-selected deployment, health proof and rollback.

Keeping these concerns out of the starting point makes every later change visible and testable.
