# Production delivery baseline

The production stack is a single-server Docker Compose runtime for the current `main` revision. It
is deliberately separate from `compose.yaml`, which remains the source-mounted development stack.

## Runtime topology

`compose.production.yaml` accepts prebuilt API and web image references, provisions separate
non-superuser migration and runtime database roles, runs migrations once, waits for healthy
application processes, and exposes only Caddy on ports 80 and 443. Separate edge, application and
internal data networks keep Caddy and web away from PostgreSQL while preserving the outbound
identity-provider access needed by web and API. Caddy owns TLS certificates and proxies requests
to web.

Application and migration image repositories and SHA-256 digests must be supplied separately
through the `PLATFORM_*_IMAGE_REPOSITORY` and `PLATFORM_*_IMAGE_DIGEST` variables. Compose
constructs an `@sha256:` reference, so a mutable tag cannot accidentally become a release input.
The API and migration inputs may initially reference the same published image, but they remain
independent deployment inputs so an API rollback can keep the newest migration registry. The base
production file has no `build` section, so a server deployment does not need the source tree or a
build toolchain; it needs only the checked deployment configuration and provisioning script.
`compose.production.build.yaml` is a local and CI build override; it is not part of the server
runtime command.

## Runtime configuration

Copy `.env.production.example` to a server-only `.env.production`, replace every placeholder, and
restrict the file to the deployment user:

```bash
install -m 600 .env.production.example .env.production
```

Never commit `.env.production`. The tracked example documents names only. Identity secrets,
cookie encryption material, the email fingerprint key, Telegram linking/evidence credentials, and
database passwords must come from the deployment environment. Telegram linking uses the dedicated
provider endpoint and bot start URL; its two directional credentials are not interchangeable. The
PostgreSQL bootstrap administrator, migration owner and long-running application use different
roles and passwords. Migrations receive `MIGRATION_DATABASE_URL`; API
receives only the restricted `DATABASE_URL`. URL-encode passwords in both URLs; the short-lived
role-provisioning containers receive their original values. The application access step is tied
to the migration digest, so it reruns after every schema release, verifies that both connection
URLs authenticate as the expected roles, and grants new migration-owned objects before API starts.
Changing `POSTGRES_PASSWORD` does not rotate the administrator password inside an existing
PostgreSQL volume; perform that rotation explicitly in PostgreSQL. Image repositories and digests
are release inputs, not long-lived secrets.

Validate a candidate configuration without starting containers:

```bash
docker compose --env-file .env.production -f compose.production.yaml config --quiet
```

## Local production smoke

The smoke builds the same final image targets used by CI, starts an isolated production-like stack
on ports 38080 and 38443, checks migrations, the restricted database role, API health, web through
HTTPS Caddy, the non-root image user, production-only API entrypoints, and OCI revision labels,
then removes its own containers, volumes and temporary image tags. Every invocation uses a unique
Compose project and local image tags; occupied smoke ports fail the new invocation without
modifying the existing owner.

```bash
pnpm compose:production:smoke
```

The smoke uses synthetic identity endpoints because it does not execute an interactive login. It
does not touch the normal development Compose project or its PostgreSQL volume.

## Release boundary

Every push to `main` runs `.github/workflows/production-images.yml`. The workflow builds the
`api-production` and `web-production` targets from that exact revision, labels them with the full
commit SHA, and publishes `ghcr.io/sachkov-inside/platform-api:<sha>` and
`ghcr.io/sachkov-inside/platform-web:<sha>`. It authenticates with the repository `GITHUB_TOKEN`
and grants the publishing job only `contents: read` and `packages: write`. The job exposes both
content digests for a downstream deployment job; there is no mutable `latest` release input.

The next CI/CD task will deploy those exact digest references over an authenticated server channel
without rebuilding source. A release is successful only after the remote health check proves the
expected revision. Rollback means selecting a previously published API/web image pair while
keeping the newest migration image digest. The current migration runner validates the
already-applied ledger and becomes a no-op before the older API starts. This is allowed only when
that API release is declared compatible with the current forward-only schema; reversing database
migrations remains a separate recovery operation.
