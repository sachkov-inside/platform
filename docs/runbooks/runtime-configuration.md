# Runtime configuration contract

Platform has two deployment environments: local development and production. `NODE_ENV=test` is a
process mode used by automated tests, not a deployed environment. CI validates and builds the same
artifacts; it is not a third runtime environment.

Both applications expose one typed, immutable configuration object to application code:

- NestJS loads the optional repository `.env` through `@nestjs/config`, validates the complete
  process environment with Zod, and provides one `PlatformConfig` through dependency injection.
- Next.js reads only server-side runtime variables, validates one `WebRuntimeConfig` during Node.js
  server startup, and derives the backend transport and Logto BFF configuration from it.

Application modules do not read variable names through `ConfigService` or `process.env`. Pure
parsers remain available for tests, migrations, seeds, and other command-line entrypoints. Invalid
production configuration stops a process before it can report ready.

## Sources and precedence

An already exported process or container variable wins over a value from an env file. Local
defaults apply only when `NODE_ENV` is `development` or `test`. Missing `NODE_ENV` is treated as
`production`, so a production process cannot silently start with local credentials or endpoints.

| Source | Tracked | Contains | Consumer and lifecycle |
| --- | --- | --- | --- |
| `.env.example` | yes | safe local values and override names | Reference for local development. Copy to ignored `.env` only when overriding defaults. |
| `.env` | no | developer-specific local overrides | Docker Compose interpolation and NestJS host fallback. Next.js host fallback uses its local defaults or variables exported by the launcher shell. |
| `.env.production.example` | yes | placeholders for stable production runtime values and secrets | Bootstrap template for server-owned `shared/runtime.env`; it is never an application input directly. |
| `shared/runtime.env` | no, server only | database credentials, identity and Telegram secrets, stable origins and domain | Persists across releases, mode `0600`, edited only in an owner-controlled server session. |
| `.env.release.example` | yes | public release metadata placeholders | Contract for generated per-release metadata. |
| `releases/<sha>/release.env` | no, generated | source SHA, image repositories, immutable image digests | Created for one release and safe to regenerate from build outputs. |

Do not add `.env.development` or `.env.test`. Local defaults and explicit test fixtures keep those
modes deterministic. Do not put application runtime secrets in GitHub Actions: deployment
transport credentials and the server runtime configuration are different security boundaries.

## Docker Compose flow

Development uses `compose.yaml`. Docker Compose loads the root `.env` for `${VARIABLE}`
interpolation, applies the checked-in local fallback values, and passes an explicit `environment`
map to each service. For example, web receives `BACKEND_BASE_URL=http://api:3001` because `api` is
the service DNS name inside the Compose network; a browser still opens
`http://127.0.0.1:3000`. Values that are not listed for a service are not copied into its
container.

Production uses `compose.production.yaml` with both server files:

```bash
docker compose \
  --env-file /opt/sachkov-inside/platform/shared/runtime.env \
  --env-file /opt/sachkov-inside/platform/releases/<sha>/release.env \
  -f compose.production.yaml config --quiet
```

Compose resolves required `${VARIABLE:?message}` expressions before containers start and passes
only each service's explicit configuration. NestJS and Next.js then perform application-level
validation, including URL protocols, secret lengths, port ranges, and production-only HTTPS
requirements.

The Dockerfile does not accept application runtime values as build arguments. Next.js has no
`NEXT_PUBLIC_*` runtime configuration: those variables would be frozen into browser assets during
the image build. The web image instead reads server-only values when the container starts. One API
image and one web image can therefore be promoted unchanged; only the runtime and release env files
select their production configuration and exact digests.

## Configuration ownership

| Group | Examples | Owner |
| --- | --- | --- |
| Backend application | `DATABASE_URL`, `API_HOST`, Logto verifier, content access, Telegram membership | `PlatformConfig` |
| Web server/BFF | `BACKEND_BASE_URL`, Logto app and cookie values, `WEB_BASE_URL` | `WebRuntimeConfig` |
| Database bootstrap | `POSTGRES_*`, migration/application role credentials | production Compose provisioning services |
| Release identity | `SOURCE_REVISION`, `PLATFORM_*_IMAGE_*` | generated `release.env` |
| Deployment transport | SSH host, user, key, known hosts; server GHCR login | protected delivery infrastructure, not application config |

When introducing a new variable, add it to the owning Zod schema, its typed config object, focused
parser tests, the relevant Compose service, and the appropriate tracked example. A production
secret belongs only in `shared/runtime.env`; public immutable build or release identity belongs in
`release.env`.
