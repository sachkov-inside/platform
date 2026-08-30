# Production delivery baseline

The production stack is a single-server Docker Compose runtime for the current `main` revision. It
is deliberately separate from `compose.yaml`, which remains the source-mounted development stack.

## Runtime topology

`compose.production.yaml` accepts prebuilt API and web image references, runs migrations once,
waits for healthy application processes, and exposes only Caddy on ports 80 and 443. PostgreSQL,
API, and web stay on the private Compose network. Caddy owns TLS certificates and proxies requests
to web.

Application images must be supplied through `PLATFORM_API_IMAGE` and `PLATFORM_WEB_IMAGE` as
immutable registry references, preferably digest references. The base production file has no
`build` section, so a server deployment does not need the Git repository or a build toolchain.
`compose.production.build.yaml` is a local and CI build override; it is not part of the server
runtime command.

## Runtime configuration

Copy `.env.production.example` to a server-only `.env.production`, replace every placeholder, and
restrict the file to the deployment user:

```bash
install -m 600 .env.production.example .env.production
```

Never commit `.env.production`. The tracked example documents names only. Identity secrets,
cookie encryption material, the email fingerprint key, and the database password must come from
the deployment environment. URL-encode the database password in `DATABASE_URL`; PostgreSQL itself
receives the original value from `POSTGRES_PASSWORD`. Image references are release inputs, not
long-lived secrets.

Validate a candidate configuration without starting containers:

```bash
docker compose --env-file .env.production -f compose.production.yaml config --quiet
```

## Local production smoke

The smoke builds the same final image targets used by CI, starts an isolated production-like stack
on ports 38080 and 38443, checks migrations, API health, web through HTTPS Caddy, the non-root image
user, production-only API entrypoints, and OCI revision labels, then removes only its own containers
and volumes. Every invocation uses a unique Compose project and local image tags; occupied smoke
ports fail the new invocation without modifying the existing owner.

```bash
pnpm compose:production:smoke
```

The smoke uses synthetic identity endpoints because it does not execute an interactive login. It
does not touch the normal development Compose project or its PostgreSQL volume.

## Release boundary

The next CI/CD task will build both image targets once for an accepted `main` revision, push them to
GHCR, resolve immutable digests, and deploy those exact references over an authenticated server
channel. A release is successful only after the remote health check proves the expected revision.
Rollback means selecting a previously published image pair and redeploying it; database rollback
remains a separate compatibility decision because migrations are forward-only.
