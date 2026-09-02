# Production Compose baseline

The repository currently contains a deliberately small single-server production baseline. It is
the starting point for the CI/CD course, not a finished automated delivery system.

## What runs

`compose.production.yaml` starts six services in order:

1. PostgreSQL becomes healthy.
2. `migrations` builds the backend production target and applies the schema once.
3. `api` builds the same backend production target and becomes healthy.
4. `profile-avatars-worker` builds the backend target and starts bounded orphan cleanup.
5. `web` builds the Next.js production target and becomes healthy.
6. Caddy exposes web over HTTP and HTTPS.

The application images are built directly from the checked-out source with Compose. Pull requests
already pass the application CI contract, but there is no registry input, digest-addressed release,
GitHub Actions deployment workflow, SSH deployment, release selector or automated rollback yet.
Compose also uses its default network and one database account. These missing pieces are
intentional: the lessons add them one at a time and explain the problem each one solves.

The Material Asset worker remains part of the application and local development stack, but it is
not started by this temporary production baseline. Orphaned Material Asset cleanup therefore does
not run here until the worker is added back during production hardening.

Profile Avatar cleanup is part of the feature's safe storage lifecycle, so its dedicated worker is
present even in this small baseline. Configure its retention window with
`PROFILE_AVATAR_ORPHAN_GRACE_SECONDS`.

## Runtime configuration

Create the ignored server-owned env files from the tracked templates and replace every placeholder.
Each service receives only its own runtime configuration and secrets.
The API file also owns Kinescope API/project/callback/webhook/playback values; the browser and web
container do not receive them. Production startup rejects the test adapter and equal public/member
project IDs.

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
build once on a runner, publish immutable artifacts and make the server run those exact artifacts
without rebuilding source.

## Local production smoke

The isolated smoke uses synthetic runtime values, builds the current production targets, applies
all migrations, verifies the Profile Avatar worker readiness log and API health, and checks the home
and Library pages through Caddy. It removes its containers, volumes and Compose-built images after
the run.

```bash
pnpm compose:production:smoke
```

## Hardening that comes later

The next delivery stages will extend this baseline with:

- registry publication and immutable image identity;
- separate database migration and runtime roles;
- explicit network boundaries;
- the Material Asset background worker;
- server-side secret delivery;
- automated deployment, health proof and rollback.

Keeping these concerns out of the starting point makes every later change visible and testable.
