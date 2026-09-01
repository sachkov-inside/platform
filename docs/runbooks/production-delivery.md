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

The [runtime configuration contract](runtime-configuration.md) defines application ownership,
validation, env-file precedence, and how Compose passes values without baking them into images.

The server has two environment files with different lifecycles:

- `shared/runtime.env` contains database, Logto, cookie, identity and Telegram secrets plus stable
  runtime configuration. It is created and edited only on the server and persists across releases.
- `releases/<sha>/release.env` contains only the full source revision, canonical GHCR repositories
  and immutable image digests. The installer never mutates committed release metadata; rollback
  uses a short-lived candidate env file for the older API/Web pair.
- `shared/latest-workflow-run-number`, `shared/latest-migration.env`, and the atomically selected
  `shared/release-states/` entries are server-owned deployment state. They are updated only while
  the deployment lock is held and must not be edited manually.

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
Python 3.9 or newer, OpenSSH server, `curl`, Docker Engine with Compose, outbound HTTPS to
GHCR/identity/Telegram dependencies, and inbound 80/443. The deployment identity must have access
to Docker. Docker documents that membership in the daemon `docker` group grants root-level
privileges, so choose that access or rootless Docker as an explicit owner decision; the repository
does not silently modify it.

Deployment automation uses four separate data classes:

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

## Automated deployment and rollback

The `deploy-production` job in `.github/workflows/production-images.yml` needs the successful image
publication job and runs in the `production` Environment. The whole publish-to-deploy workflow uses
the non-cancelling `platform-production` concurrency group with `queue: max`, so pending runs are
queued instead of replaced (up to GitHub's 100-run concurrency-group limit). GitHub does not
guarantee queued-run ordering, so the server also records the greatest accepted
monotonic `github.run_number` under the deployment lock and rejects any lower stale run before
validation or pull. A rerun of the same workflow run remains allowed. Deployment is intentionally
skipped until the repository variable `PLATFORM_PRODUCTION_DEPLOY_ENABLED` is exactly `true`.
Enable that variable only after the owner has completed all of these one-time actions:

1. bootstrap `/opt/sachkov-inside/platform`, replace every runtime placeholder on the server, and
   validate `shared/runtime.env`;
2. authenticate the deployment user to GHCR with a server-side read-only package credential;
3. capture and independently verify the SSH host key;
4. create the protected GitHub Environment `production` with
   `PLATFORM_DEPLOY_HOST`, `PLATFORM_DEPLOY_USER`, `PLATFORM_DEPLOY_SSH_PRIVATE_KEY`, and
   `PLATFORM_DEPLOY_SSH_KNOWN_HOSTS`;
5. optionally require owner approval on that Environment, then set the repository enable variable.

The runner renders public `release.env` from the exact publish outputs and transfers only the
allowlisted Compose, Caddy, provisioning, validation and deployment files. The SSH client uses
`BatchMode=yes`, `IdentitiesOnly=yes`, `StrictHostKeyChecking=yes`, and the owner-provided
known-hosts file. It never reads or uploads `shared/runtime.env`.

On the server, the Python `fcntl` wrapper holds the exclusive `shared/deploy.lock` across each
deployment or rollback, and every operation verifies the inherited locked file descriptor. An
environment variable alone cannot bypass the lock. Validation and every Compose/Docker command run
through the same clean environment, preserving only the explicit Docker transport/configuration
variables needed to reach the daemon; ambient Compose or `PLATFORM_*` values cannot override the
validated env files.

The installer rejects unexpected bundle entries, durably commits the immutable release directory, pulls
by digest, and executes database roles, migrations and application grants before replacing API,
Web or Caddy. Immediately before invoking migrations it durably records the newest accepted
migration repository/digest. If the process stops before or during the command, rollback reruns
that exact migrator against the database ledger before starting the older API; if migrations had
already completed, the same rerun is a no-op. API health, both image revision labels and the public
HTTPS home response must pass before release state changes.
`current` and `previous` are stable anchors into one durably and atomically replaced
`release-state` selector, so a crash cannot expose a half-swapped pair. State files, their parent
directories, and each newly installed release tree are `fsync`ed before success is reported. A
failed validation, pull, migration, health, smoke, or selector replacement therefore leaves both
successful-release pointers unchanged; if candidate containers were already started, the owner
evaluates schema compatibility and runs the explicit rollback rather than reversing migrations.

Rollback always targets `previous`, combines that immutable release's API/Web values with
`shared/latest-migration.env`, repeats the complete deployment proof, and atomically selects the
new current/previous pair only after success. The acknowledgement is deliberately verbose because
forward schema compatibility is an owner decision:

```bash
bash /opt/sachkov-inside/platform/current/scripts/rollback-production-release.sh \
  /opt/sachkov-inside/platform \
  --acknowledge-forward-schema-compatible
```

Do not use rollback when the previous API/Web release is incompatible with the current forward-only
schema. Restore from the database recovery procedure instead; this repository does not automate
reverse migrations.

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

The gated deployment job packages the tracked server files, creates `release.env` from the digest
outputs, transfers both over the authenticated channel and deploys without rebuilding source. A
release is successful only after remote health and revision checks pass. Rollback selects the
previous API/Web image pair while keeping the newest migration image digest. The migration runner
validates the already-applied ledger and becomes a no-op before the older API starts. This is
allowed only when that API release is declared compatible with the current forward-only schema;
reversing database migrations remains a separate recovery operation.
