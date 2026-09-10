# Runtime configuration contract

Platform has two deployed environments: local development and production. `NODE_ENV=test` is a
process mode used by automated tests, not a deployed environment. CI will validate and build the
same application; it does not become another application environment.

Both applications expose one typed, immutable configuration object to application code:

- NestJS loads the optional repository `.env` through `@nestjs/config`, validates the complete
  process environment with Zod, and provides one `PlatformConfig` through dependency injection.
- Next.js reads server-side runtime variables, validates one `WebRuntimeConfig` during Node.js
  server startup, and derives backend transport and Logto BFF configuration from it.

Application modules do not read variable names through `ConfigService` or `process.env`. Pure
parsers remain available for tests, migrations, seeds and command-line entrypoints. Invalid
production configuration stops a process before it can report ready.

## Sources and precedence

An already exported process or container variable wins over a value from an env file. Local
defaults apply only when `NODE_ENV` is `development` or `test`. Missing `NODE_ENV` is treated as
`production`, so a production process cannot silently start with local credentials or endpoints.

| Source | Tracked | Contains | Consumer |
| --- | --- | --- | --- |
| `.env.example` | yes | safe local values and override names | local development reference |
| `.env` | no | developer-specific local overrides | host processes and Compose host ports |
| `config/compose/local/*.env` | yes | safe container-only development values | local Compose services |
| `config/compose/production/*.env.example` | yes | production names and placeholders by owner | server setup reference |
| `/etc/inside/runtime/*.env` | no, server only | production values and secrets by owner | production Compose services |
| `/var/lib/inside/deployments/release-environments/*.env` | no, generated | manifest-selected release and source identity | production Compose services |

The server-owned production files are copied manually before the first start, kept outside Git and
restricted to `root:root` mode `0600`. `compose.env` configures only the stable Compose project,
network names and loopback ports. The deployment state machine derives exact image digests,
release ordinal and source SHA from the verified manifest and writes a separate generated env file.
`migrations.env`, `api.env`, `mcp.env`, `material-assets-worker.env`,
`profile-avatars-worker.env`, `video-deletions-worker.env` and `web.env` are passed only to their
owning services. PostgreSQL, Logto and Caddy configuration belong to the separate production
foundation. Deployment does not rewrite or print server-owned configuration and never adds secrets
to Git, images, manifests or journals.

Do not add `.env.development` or `.env.test`. Local defaults and explicit test fixtures keep those
modes deterministic. Do not bake application runtime secrets into a Docker image or pass them as
Docker build arguments.

## Docker Compose flow

Development uses `compose.yaml`. Docker Compose loads the optional root `.env` for host-level
`${VARIABLE}` interpolation and loads each container's checked-in values from
`config/compose/local/*.env` through `env_file`.

Production uses the server-owned Compose file explicitly while service-level `env_file` entries
load the remaining files:

```bash
docker compose \
  --env-file /etc/inside/runtime/compose.env \
  --file compose.production.yaml \
  config --quiet
```

Compose resolves project, network, exact digest and host-port interpolation before containers
start. NestJS and Next.js then validate the values loaded from their env files, including URL
protocols, secret lengths, port ranges, production-only HTTPS requirements and release identity.

The application Dockerfiles accept only `INSIDE_RELEASE_VERSION` and `INSIDE_SOURCE_SHA` as
non-secret artifact identity build arguments. Runtime must independently supply the same values as
`PLATFORM_RELEASE_VERSION` and `PLATFORM_SOURCE_SHA`; a mismatch stops startup. Next.js has no
`NEXT_PUBLIC_*` runtime configuration because those values would be frozen into browser assets
during the image build. The web process reads server-only values when its container starts.

## Configuration ownership

| Group | Examples | Owner |
| --- | --- | --- |
| Release identity | `PLATFORM_RELEASE_VERSION`, `PLATFORM_SOURCE_SHA` | generated manifest environment and process startup validation |
| API | `DATABASE_URL`, Logto verifier, Telegram, Object Storage and Kinescope values | `PlatformConfig` |
| MCP | database, MCP endpoint, Logto verifier, content access, Object Storage and Kinescope values | `PlatformConfig` and `McpConfig` |
| Material/Profile workers | database and Object Storage values | per-process `PlatformConfig` validation |
| Video deletion worker | database and Kinescope values | per-process `PlatformConfig` validation |
| Web server/BFF | `BACKEND_BASE_URL`, Logto app and cookie values, `WEB_BASE_URL` | `WebRuntimeConfig` |
| Database foundation | PostgreSQL, Logto database and pgBackRest values | `config/production/foundation/` |
| Deployment transport | SSH host, restricted user/key and pinned host keys | protected GitHub Environment `Production` |

When introducing a variable, add it to the owning Zod schema, typed config object, focused parser
tests, relevant Compose service and tracked example. Do not make an unrelated worker require that
group. Put the real production value only in the server-owned environment file; deployment consumes
that file in place and never transports it through GitHub.

Kinescope defaults to the deterministic `test` adapter only in development/test. Production
requires `KINESCOPE_PROVIDER_MODE=real`, distinct public and membership project IDs, a server-only
delete-capable API
and DRM callback credentials, separate webhook Basic credentials and a playback JWT secret. Never place any of
these values in `NEXT_PUBLIC_*`, Material JSON, screenshots, issue text or client logs. The two
integration routes are `/integrations/kinescope/v1/webhook` and
`/integrations/kinescope/v1/authorize`; expose them only through the approved HTTPS domain and copy
their exact provider-side settings during the credentialed acceptance run.

`MEMBERSHIP_SUPPORT_URL` is an optional backend-owned HTTP(S) destination for Account conflict and
unsafe Telegram-link recovery. Leave it empty when no approved support channel exists: Account then
shows owner-handoff copy without rendering a broken link. It is presentation configuration only;
it never changes link uniqueness, recovery policy or `ContentAccess`. `MEMBERSHIP_ACQUISITION_URL`
remains the independent destination for obtaining Membership.

## Optional Telegram communications

API and MCP share the opt-in communications configuration and author permission contract in
[Platform communications integration](../integrations/communications-v1.md#configuration-and-owner-bootstrap).
All four settings are absent by default; partial configuration fails startup. Configure service
credentials only in the owning private runtime environment files.

## Optional community entitlements

The Platform producer of the shared community right is opt-in. Its three settings and the dispatch
callback contract are described in
[Community entitlements](../integrations/community-entitlements-v1.md#configuration). They are
absent by default; without them `billing-worker` registers no community pass and the dispatch
endpoint answers `401`. Each Telegram direction keeps its own credential and startup rejects a
reused secret. Configure them only in the owning private runtime environment files.

## Domain Material formats

Materials defines exactly `video` (Видео), `guide` (Гайд), and `note` (Заметка).
The authoring `formatId` field contains this domain code, not a UUID. A draft may store
null; publishing requires a format. Authoring references are available on an empty
production database without running the development seed.

Migration `0035_domain_material_formats` converts existing UUID references to their
codes in both current and published Materials, maps legacy `text` to `note`, refreshes
public search metadata, and removes `materials.formats`. Referenced legacy formats
with other slugs stop the migration transaction and require an explicit conversion
before retry. Unused dictionary entries are removed with the dictionary. Database
CHECK constraints reject values outside the domain. The old application is incompatible
with the new schema; use the normal release recovery procedure, not an old image on
the migrated database.

## Kinescope upload authorization

The production Kinescope token needs both the existing API permissions and an `upload` scope
with `read`, `write`, and `delete` permissions limited to the configured public and Membership
projects. Project entity restrictions also affect video lookup: a write-only entity grant can
initialize and transfer a video while its direct API lookup returns 403, even though the project
and video list are readable. Verify both upload authorization and direct lookup of the same
agreed video. API read success alone does not prove upload authorization: the uploader rejects
an API-only token with HTTP 401.

An explicit uploader 401/403 records a `rejected` upload attempt and returns
`upload_not_authorized`. The same idempotency key replays that rejection; after the credential is
repaired, the browser starts a new attempt. Network errors and ambiguous provider responses retain
an unresolved attempt and return `upload_outcome_unknown`; check the provider before recovery.
Never reset such attempts merely because the browser offers a retry.

## Notifications transport

The optional `PlatformConfig.notifications` group belongs to `notifications-worker`. Its URL map,
CA, prefetch and quarantine limits are defined in the [transport runbook](notification-transport.md).
The local Compose env file uses disposable scoped principals; production activation remains separate.
