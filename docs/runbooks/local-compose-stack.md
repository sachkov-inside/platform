# Compose stack contents

What the repository Compose stack runs and how its images and configuration are built. Start, stop and ownership rules live in the [local stand runbook](local-stand.md).

## What Compose runs

The default stack contains:

- PostgreSQL 18.4 with a persistent named volume;
- RustFS with separate public-delivery, protected and quarantine buckets; its S3-compatible API is
  on <http://127.0.0.1:9000> and console is on <http://127.0.0.1:9001>. Services reach it as
  `object-storage:9000`, while `OBJECT_STORAGE_SIGNED_GET_ENDPOINT` signs protected browser links for
  the published `127.0.0.1:9000`;
- one `migrations` job that applies the schema and one `seed` job that adds deterministic
  development data;
- Nest API on <http://127.0.0.1:3001> with health and OpenAPI endpoints;
- the long-running MCP process at <http://127.0.0.1:3002/mcp> over the same application and database
  lifecycle;
- `material-assets-worker`, which consumes the durable `pg-boss` cleanup queue for Material Assets
  and detached Content Covers and has no HTTP listener;
- `profile-avatars-worker`, which consumes the independent durable ProfileAvatar cleanup queue and
  has no HTTP listener;
- `video-deletions-worker`, which owns explicit Platform-uploaded Kinescope Video deletion,
  reference rechecks and bounded retry and has no HTTP listener;
- `billing-worker`, which reconciles saved bank attempts and projects confirmed payments into access grants;
- `bank-double`, the stand's payment provider on <http://127.0.0.1:8090>, where a human chooses the
  outcome of every payment, renewal charge, refund and card binding;
- `logto` and its own PostgreSQL behind the `identity` profile: the stand's sign-in, absent from the
  default stack and started by `pnpm local:stand`;
- `mailpit`, the stand's mail interceptor: SMTP on `mailpit:1025` inside the Compose network, its
  inbox on <http://127.0.0.1:8025>, and no delivery outside the machine;
- RabbitMQ with local TLS, bounded quorum queues and `notifications-worker` for durable transport;
  see [Notifications transport](notification-transport.md) for recovery and the production boundary;
- Next.js web on <http://127.0.0.1:3000>.

The stand runs web in development mode with the Next.js development indicator hidden:
`config/compose/local/web.env` sets `HIDE_DEV_INDICATOR=true`, and `pnpm test:e2e` sets the same
variable for its own server. The indicator would otherwise take taps meant for the mobile dock on a
narrow screen, and no corner it can move to is free; `apps/web/next.config.ts` owns that reasoning.
The host `pnpm dev` fallback sets no such variable, so it keeps both the indicator and that
overlap; on a narrow screen prefer the stand when checking the dock or the authoring navigation.

The optional Logto email-code proof is a separate, disposable Compose project with isolated ports
and volumes. Its pinned build, automated Management API bootstrap and Mailpit capture are
documented in [`infra/identity/logto/README.md`](../../infra/identity/logto/README.md). Run
`pnpm identity:proof:start`; it starts the shared Platform PostgreSQL, applies normal repository
migrations and runs the application without Logto Console setup. The launcher claims the same
machine-wide ownership lock as `local:setup`, refuses an already running Platform or proof Compose
project, and stops only the environments it claimed when the process exits.

For the destructive, clean-volume #116 security corpus use `pnpm identity:proof:hardening` instead.
It owns different Compose project names and ports, proves the pinned Logto recipient cap, callback
and dependency recovery behavior, verifies one local `Account` and no Platform session table, then
removes only its disposable volumes.

API and web expose real healthchecks. API, MCP and capability workers wait for healthy PostgreSQL
and a successful seed; web waits for healthy API. Storybook is
an optional profile on <http://127.0.0.1:6006>. Integration tests continue to use their own
temporary PostgreSQL and RustFS through Testcontainers and never share the Compose data services.

The production API exposes health, OpenAPI, the published catalog and the Material Reader endpoint.
The local MCP adapter exposes delegated Material, Topic, Series, ordered-composition authoring and
[communications management](../integrations/communications-v1.md)
over production application interfaces;
production Logto client setup and public routing remain separate deployment work.

## Images, configuration and storage

`docker compose up --build` builds exact Node/pnpm development images. For a faster edit loop, use
the [host Node.js fallback](local-host-fallback.md).

The ten backend roles and development `web` share one workspace image. Only `api` builds it;
each role declares its own command and retains its readiness/dependency contract. The workspace
contains both applications and their dependencies, so development Web needs no second install or
image export. Rebuild `api` after backend or Web source changes, then recreate affected roles to use
that image. Local diagnostic `.reports` files are excluded
from the root Docker context; tracked source and `docs/evidence` remain available. The host-generated
Prisma client is excluded too: dependency installation generates it from the image's own schema.

The checked-in `config/compose/local/*.env` files contain safe container-only development values.
A root `.env` copied from `.env.example` is optional for host-process overrides and Compose host
ports; already exported variables take precedence. Next.js host fallback uses the same checked-in
defaults or variables exported by its launcher shell. Inside the Compose network, applications use
`postgres` and `api` service DNS.
Browser-facing URLs remain on `127.0.0.1`. See the
[runtime configuration contract](runtime-configuration.md) for ownership, precedence, validation,
and the production env-file boundary.

The API creates only the three named local buckets in development mode. Objects use random,
immutable keys and are never written over. The persistent `object-storage-rustfs-data` volume follows
the same ownership and non-destructive restart rules as PostgreSQL. The stand's former MinIO volume
`object-storage-data` is no longer mounted; [Former MinIO objects](local-minio-transfer.md#former-minio-objects) copies its
objects into RustFS.

RabbitMQ's official base and Testcontainers image use the public organization GHCR mirror;
the versions, index digests and platforms follow the
[RabbitMQ mirror contract](continuous-integration.md#rabbitmq-mirror).

The local stand and its object-storage integration test acquire RustFS from the publisher's GHCR
repository (#1310). `compose.yaml` pins the same OCI index digest as the former Docker Hub input;
the source change preserves the image bytes and version. The [publisher workflow](https://github.com/rustfs/rustfs/blob/main/.github/workflows/docker.yml)
publishes one build to both registries. The offline toolchain contract checks the exact source and
digest; acquisition and runtime checks require Docker execution separately.
The integration test also uses the [shared Testcontainers acquisition contract](continuous-integration.md#integration-suites)
from #1315.

Local development uses `KINESCOPE_PROVIDER_MODE=test`. It creates deterministic provider facts for
upload-init, attach, processing reconciliation and playback without a real credential or outbound
Kinescope call; its reserved `.invalid` upload endpoint makes the browser complete the simulated
transfer immediately. Exact Tus and provider callback behavior is covered at the adapter boundary; real
upload/playback acceptance still requires the owner-gated contour described in issue #183. Switch
to `real` only in a private environment with the full Kinescope configuration from
[the runtime contract](runtime-configuration.md); never paste credentials into the repository or
issue evidence.

The test provider also exercises deletion without outbound calls. Operational states and safe
production recovery are documented in the
[Video deletion runbook](video-deletion.md).

## What the guarded smoke proves

The [guarded smoke](local-stand.md#guarded-compose-smoke) proves the live web server adapter can reach API and PostgreSQL, MCP reported
database-backed readiness, one stable free `kak-ustroen-inside-platform` Material with current
stored content, one safe closed catalog Material, and the three seeded offers on the public
storefront. Repeating `docker compose down` and the detached startup preserves the database volume
and proves the development seed remains stable.

## Optional Storybook profile

Start the default stack plus Storybook:

```bash
docker compose --profile storybook up --build
```

The profile uses the same frozen container dependencies as the default stack.
