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

The server has two environment files with different lifecycles:

- `shared/runtime.env` contains database, Logto, cookie, identity and Telegram secrets plus stable
  runtime configuration. It is created and edited only on the server and persists across releases.
- `releases/<sha>/release.env` contains only the full source revision, canonical GHCR repositories
  and immutable image digests. Deployment automation may replace this file for every release.

Bootstrap the filesystem contract from a checked release bundle. The root must be absolute; the
script creates `releases/` with mode `0750`, `shared/` with mode `0700`, and copies the runtime
template to `shared/runtime.env` with mode `0600` only when that file does not already exist:

```bash
PLATFORM_INSTALL_ROOT=/opt/sachkov-inside/platform \
  bash scripts/bootstrap-production-host.sh
```

The command is idempotent and never replaces an existing runtime file. Edit that file in the owner
controlled server session and replace every tracked placeholder. Never commit or upload it to
GitHub. Identity secrets, cookie encryption material, the email fingerprint key, Telegram
linking/evidence credentials, and database passwords must come from this server-only file.
Telegram linking uses the dedicated provider endpoint and bot start URL; its two directional
credentials are not interchangeable. The PostgreSQL bootstrap administrator, migration owner and
long-running application use different roles and passwords. Migrations receive
`MIGRATION_DATABASE_URL`; API receives only the restricted `DATABASE_URL`. URL-encode passwords in
both URLs; the short-lived role-provisioning containers receive their original values. The
application access step is tied to the migration digest, so it reruns after every schema release,
verifies that both connection URLs authenticate as the expected roles, and grants new
migration-owned objects before API starts. Changing `POSTGRES_PASSWORD` does not rotate the
administrator password inside an existing PostgreSQL volume; perform that rotation explicitly in
PostgreSQL.

The image workflow emits digests as `sha256:<64 lowercase hex characters>`. Render `release.env`
from its exact SHA, API digest and Web digest outputs; the renderer strips that one prefix because
Compose adds it in the image reference, and assigns the API digest to both API and migrations:

```bash
umask 027
bash scripts/render-production-release-env.sh \
  "$SOURCE_REVISION" "$API_WORKFLOW_DIGEST" "$WEB_WORKFLOW_DIGEST" \
  > /opt/sachkov-inside/platform/releases/<sha>/release.env
```

Validate the server-only runtime file and public release metadata together without starting
containers or printing the expanded configuration:

```bash
bash scripts/validate-production-host.sh \
  /opt/sachkov-inside/platform/shared/runtime.env \
  /opt/sachkov-inside/platform/releases/<sha>/release.env
```

The validator rejects symbolic links, runtime mode other than `0600`, group/world-writable release
metadata, missing or duplicate keys, tracked placeholders, noncanonical image repositories, and
zero or malformed revision/digest values before running `docker compose config --quiet` with both
files.

## Host and credential boundary

The bootstrap deliberately does not install Docker, create users, edit firewall/DNS, authenticate
to GHCR or touch a running stack. Before the owner runs it, the Linux host must already provide
Python 3.9 or newer, Docker Engine with Compose, outbound HTTPS to GHCR/identity/Telegram
dependencies, and inbound 80/443. The deployment identity must have access to Docker. Docker
documents that membership in the daemon `docker` group grants root-level privileges, so choose
that access or rootless Docker as an explicit owner decision; the repository does not silently
modify it.

Future deployment automation uses four separate data classes:

1. GitHub Environment `production` contains SSH transport only:
   `PLATFORM_DEPLOY_HOST`, `PLATFORM_DEPLOY_USER`, `PLATFORM_DEPLOY_SSH_PRIVATE_KEY`, and
   `PLATFORM_DEPLOY_SSH_KNOWN_HOSTS`. The deployment job must reference that environment before
   these values become available.
2. The deployment identity stores a read-only GHCR credential in its server-side Docker config.
   It is not an application runtime variable and is not copied into a release directory.
3. `shared/runtime.env` remains server-only and is never generated from GitHub secrets or printed
   by deployment commands.
4. `release.env` contains public release metadata only and can be regenerated from the build job
   outputs.

Do not use `ssh-keyscan` inside the deployment job as trust-on-first-use. Capture and verify the
host key in the owner-controlled bootstrap session, then store the exact known-hosts entry in the
protected GitHub Environment. Actual Environment/secrets creation, GHCR login and server bootstrap
remain owner gates.

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

The next CI/CD task will package the tracked server files, create `release.env` from the digest
outputs, transfer both over the authenticated channel and deploy without rebuilding source. A
release is successful only after the remote health check proves the expected revision. Rollback
means selecting a previously published API/web image pair while keeping the newest migration image
digest. The current migration runner validates the already-applied ledger and becomes a no-op
before the older API starts. This is allowed only when that API release is declared compatible with
the current forward-only schema; reversing database migrations remains a separate recovery
operation.
